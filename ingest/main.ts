/**
 * Weekly ingest: FIVB VIS -> static JSON under `web/public/v1/`.
 *
 * The whole archive is reachable in three bulk list requests, so there is no
 * per-tournament fan-out, no rate-limit dance and no incremental cache to go
 * stale. A full rebuild takes about a minute and is self-healing: any bug or
 * upstream correction is washed out by the next run.
 *
 * Publishing is atomic. Everything is written to a temp directory and only
 * swapped into place once every file has been generated, so a failed run leaves
 * last week's data being served rather than a half-published state.
 */

import { mkdir, rm, writeFile, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchList } from './vis.js';
import { fetchFederations, countryName } from './countries.js';
import { TIER_LABEL, INCLUDE_AGE_GROUP } from './tiers.js';
import {
  aggregatePartnerships,
  normalisePlayers,
  normaliseTournaments,
  sliceByCountryAndGender,
} from './build.js';
import type { Manifest, ManifestCountry, Gender, PlayersFile, GraphFile } from '../web/src/schema.js';
import { DATA_VERSION } from '../web/src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../web/public');
const OUT_DIR = path.join(PUBLIC_DIR, DATA_VERSION);
const TMP_DIR = path.join(PUBLIC_DIR, `${DATA_VERSION}.tmp`);

/** Slices smaller than this have no graph worth drawing. */
const MIN_NODES = 2;

function log(step: string, detail: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${step.padEnd(12)} ${detail}`);
}

async function main() {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();

  // --- Stage 0: federations (for country display names) --------------------
  const federations = await fetchFederations();
  log('federations', `${federations.size} federations`);

  // --- Stage 1: tournaments ------------------------------------------------
  const tournamentRows = await fetchList({
    type: 'GetBeachTournamentList',
    fields: ['No', 'Code', 'Season', 'Gender', 'Type', 'OrganizerType', 'Version'],
    itemTag: 'BeachTournament',
  });
  const tournaments = normaliseTournaments(tournamentRows);
  if (tournaments.size === 0) throw new Error('No qualifying tournaments — refusing to publish');

  const tierCounts: Record<string, number> = {};
  let seasonFrom = Infinity;
  let seasonTo = -Infinity;
  let sourceVersion = '0';
  for (const t of tournaments.values()) {
    const label = TIER_LABEL[t.tier];
    tierCounts[label] = (tierCounts[label] ?? 0) + 1;
    seasonFrom = Math.min(seasonFrom, t.season);
    seasonTo = Math.max(seasonTo, t.season);
    if (t.version.localeCompare(sourceVersion, undefined, { numeric: true }) > 0) {
      sourceVersion = t.version;
    }
  }
  log('tournaments', `${tournaments.size} of ${tournamentRows.length} qualify (${seasonFrom}-${seasonTo})`);

  // --- Stage 2: players ----------------------------------------------------
  // Unfiltered: a few thousand players who entered FIVB beach events are not
  // flagged PlaysBeach in VIS, and filtering on it silently drops their edges.
  const playerRows = await fetchList({
    type: 'GetPlayerList',
    fields: [
      'No',
      'FirstName',
      'LastName',
      'TeamName',
      'Gender',
      'FederationCode',
      'Birthdate',
      'Height',
      'Weight',
      'IsActive',
    ],
    itemTag: 'Player',
  });
  const players = normalisePlayers(playerRows);
  log('players', `${players.size} usable of ${playerRows.length}`);

  // --- Stage 3: team entries -> partnership edges --------------------------
  const teamRows = await fetchList({
    type: 'GetBeachTeamList',
    fields: ['No', 'NoTournament', 'NoPlayer1', 'NoPlayer2', 'FederationCode'],
    itemTag: 'BeachTeam',
  });
  log('entries', `${teamRows.length} team entries`);

  const { partnerships, appearances, rejects } = aggregatePartnerships(teamRows, tournaments, players);
  log('aggregate', `${partnerships.size} partnerships across ${appearances.size} players`);
  log('rejected', JSON.stringify(rejects));

  // A collapse in matched entries means the upstream shape changed. Better to
  // fail loudly than to publish a graph that quietly lost most of its edges.
  if (partnerships.size < 1000) {
    throw new Error(`Only ${partnerships.size} partnerships aggregated — refusing to publish`);
  }

  // --- Stage 4: slice ------------------------------------------------------
  const slices = sliceByCountryAndGender(partnerships, appearances, players, tournaments, MIN_NODES);
  log('slices', `${slices.length} country x gender slices with >=${MIN_NODES} players`);

  // --- Stage 5: write to temp, then swap -----------------------------------
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(path.join(TMP_DIR, 'graphs'), { recursive: true });
  await mkdir(path.join(TMP_DIR, 'players'), { recursive: true });

  const byCountry = new Map<string, ManifestCountry>();

  for (const slice of slices) {
    const name = countryName(federations, slice.country);
    const graph: GraphFile = {
      country: slice.country,
      countryName: name,
      gender: slice.gender,
      generatedAt,
      nodes: slice.nodes,
      edges: slice.edges,
    };
    await writeFile(
      path.join(TMP_DIR, 'graphs', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(graph),
    );

    const detail: PlayersFile = {
      country: slice.country,
      gender: slice.gender,
      generatedAt,
      players: slice.nodes.map((node) => {
        const p = players.get(node.id)!;
        return {
          id: node.id,
          name: p.name,
          dob: p.dob,
          height: p.height,
          weight: p.weight,
          active: p.active,
        };
      }),
    };
    await writeFile(
      path.join(TMP_DIR, 'players', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(detail),
    );

    let entry = byCountry.get(slice.country);
    if (!entry) byCountry.set(slice.country, (entry = { code: slice.country, name, genders: {} }));
    entry.genders[slice.gender as Gender] = { nodes: slice.nodes.length, edges: slice.edges.length };
  }

  const manifest: Manifest = {
    generatedAt,
    sourceVersion,
    seasons: { from: seasonFrom, to: seasonTo },
    totals: {
      tournaments: tournaments.size,
      players: appearances.size,
      partnerships: partnerships.size,
    },
    tiers: tierCounts,
    countries: [...byCountry.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(path.join(TMP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Sanity-check the temp tree before letting it replace live data.
  const written = (await readdir(path.join(TMP_DIR, 'graphs'))).length;
  if (written !== slices.length) {
    throw new Error(`Expected ${slices.length} graph files, wrote ${written} — refusing to publish`);
  }

  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
  await rename(TMP_DIR, OUT_DIR);

  log('published', `${OUT_DIR} (${written * 2 + 1} files) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log('config', `age-group world championships ${INCLUDE_AGE_GROUP ? 'included' : 'excluded'}`);
}

main().catch(async (err) => {
  // Leave whatever is already published untouched.
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  console.error('\nIngest failed — existing data left in place.');
  console.error(err);
  process.exit(1);
});
