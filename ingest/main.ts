/**
 * Weekly ingest: FIVB VIS -> static JSON under `web/public/v1/`, committed to
 * this repo rather than published as a build artifact.
 *
 * The whole archive is reachable in three bulk list requests, so there is no
 * per-tournament fan-out, no rate-limit dance and no incremental cache to go
 * stale. A full rebuild takes about a minute and is self-healing: any bug or
 * upstream correction is washed out by the next run.
 *
 * `web/public/v1/` is deliberately tracked in git, not gitignored: it is this
 * project's only durable copy of the dataset. FIVB is a free third-party
 * service with no uptime or continuity guarantee, and the previous design —
 * regenerate from scratch every run, publish only as a 1-day CI artifact —
 * meant a FIVB outage or shutdown could take the whole site down with it, and
 * a code-only change (a CSS fix, nothing data-related) couldn't deploy without
 * a successful fetch it didn't need. Committing the data means a fresh clone
 * can build immediately, a code push doesn't require FIVB to be reachable, and
 * the commit history is an actual changelog of the archive over time. It also
 * changes the bar for what "safe to write" means here: this now runs against
 * files real history is going to remember, not a throwaway temp directory —
 * hence pretty-printing (readable diffs), sorting by id rather than a mutable
 * field (stable diffs), and `regression.ts` (refusing to commit a fetch that
 * came back broken).
 *
 * Publishing is atomic. Everything is written to a temp directory and only
 * swapped into place once every file has been generated and passed the checks
 * below, so a failed run leaves last week's data being served rather than a
 * half-published state.
 */

import { mkdir, rm, writeFile, rename, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchList } from './vis.js';
import { fetchFederations, countryName, countryIso2 } from './countries.js';
import { TIER_LABEL, INCLUDE_AGE_GROUP } from './tiers.js';
import {
  aggregatePartnerships,
  normalisePlayers,
  normaliseTournaments,
  sliceByCountryAndGender,
} from './build.js';
import { checkForRegression, type DatasetTotals } from './regression.js';
import type { Manifest, ManifestCountry, Gender, PlayersFile, GraphFile } from '../web/src/schema.js';
import { DATA_VERSION } from '../web/src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../web/public');
const OUT_DIR = path.join(PUBLIC_DIR, DATA_VERSION);
const TMP_DIR = path.join(PUBLIC_DIR, `${DATA_VERSION}.tmp`);
/** Where the previous tree is parked during the swap. See the publish step. */
const OLD_DIR = path.join(PUBLIC_DIR, `${DATA_VERSION}.old`);

/** Slices smaller than this have no graph worth drawing. */
const MIN_NODES = 2;

function log(step: string, detail: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${step.padEnd(12)} ${detail}`);
}

/**
 * Recover from a run that was killed mid-swap.
 *
 * The publish step parks the previous tree at `OLD_DIR` for the instant it
 * takes to rename the new one into place. A SIGKILL in that window (a
 * cancelled CI job, an OOM) leaves no `OUT_DIR` and a complete `OLD_DIR`, and
 * the process is gone before any handler can put it back — so the next run has
 * to, before its own swap reaches for `OLD_DIR` and deletes the only copy.
 */
async function recoverInterruptedSwap() {
  if (existsSync(OUT_DIR) || !existsSync(OLD_DIR)) return;
  await rename(OLD_DIR, OUT_DIR);
  console.warn('  ! restored data left behind by an interrupted publish');
}

async function main() {
  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();

  await recoverInterruptedSwap();

  // Read before anything below touches OUT_DIR, so this is genuinely last
  // week's data — not a `null` because we deleted it ourselves in the
  // meantime. Missing or unreadable (the very first run, or a corrupt file)
  // both mean "nothing to compare against"; the absolute floor check further
  // down is what protects that cold-start case instead.
  let previousTotals: DatasetTotals | null = null;
  try {
    const previous = JSON.parse(await readFile(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
    previousTotals = previous.totals;
  } catch {
    /* no previous manifest to compare against */
  }

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
    const iso2 = countryIso2(federations, slice.country);
    const name = countryName(federations, slice.country);
    const graph: GraphFile = {
      country: slice.country,
      countryName: name,
      gender: slice.gender,
      // No per-file `generatedAt`: nothing reads it (`manifest.generatedAt`
      // is the one freshness marker the app and prerender actually use), and
      // a value that changes on every single run regardless of whether this
      // slice's real content did would touch all 575 files every week.
      nodes: slice.nodes,
      edges: slice.edges,
    };
    // Pretty-printed, like manifest.json already was: these files are meant
    // to be committed (see the publish step below), and a diff is only
    // useful — to a human, or to git's own delta compression — at line
    // granularity. A single minified line makes any change, however small,
    // look like the entire file was rewritten.
    await writeFile(
      path.join(TMP_DIR, 'graphs', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(graph, null, 2),
    );

    const detail: PlayersFile = {
      country: slice.country,
      gender: slice.gender,
      players: slice.nodes.map((node) => {
        const p = players.get(node.id)!;
        return {
          id: node.id,
          name: p.name,
          dob: p.dob,
          height: p.height,
          weight: p.weight,
        };
      }),
    };
    await writeFile(
      path.join(TMP_DIR, 'players', `${slice.country}-${slice.gender}.json`),
      JSON.stringify(detail, null, 2),
    );

    let entry = byCountry.get(slice.country);
    if (!entry) {
      byCountry.set(
        slice.country,
        (entry = { code: slice.country, name, iso2, genders: {} }),
      );
    }
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

  // A rebuild that lost most of its data looks the same, from these numbers
  // alone, whether that's a real correction or FIVB silently handing back an
  // empty or truncated response. See regression.ts for why scale is the only
  // signal available to tell them apart.
  const regressions = checkForRegression(previousTotals, manifest.totals);
  if (regressions.length > 0) {
    throw new Error(
      `Refusing to publish — this looks like a broken fetch, not a real change:\n  ${regressions.join('\n  ')}`,
    );
  }

  // Swap the new tree in, then delete the old one — never the other way round.
  // `rm` the live directory first and the window between the two calls is a
  // window with no data at all: interrupt the process there (CI cancelled, disk
  // full, Ctrl-C) and what is left is not "last week's data", it is nothing,
  // with the freshly built replacement still sitting under a name nothing
  // serves. Renaming the old tree aside keeps a complete directory at OUT_DIR
  // at every instant except the moment of the rename itself, which is atomic
  // within a filesystem.
  await rm(OLD_DIR, { recursive: true, force: true });
  const hadPrevious = existsSync(OUT_DIR);
  if (hadPrevious) await rename(OUT_DIR, OLD_DIR);
  try {
    await rename(TMP_DIR, OUT_DIR);
  } catch (err) {
    // Put the previous data back rather than leaving the site with none.
    if (hadPrevious) await rename(OLD_DIR, OUT_DIR).catch(() => {});
    throw err;
  }
  await rm(OLD_DIR, { recursive: true, force: true });

  log('published', `${OUT_DIR} (${written * 2 + 1} files) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log('config', `age-group world championships ${INCLUDE_AGE_GROUP ? 'included' : 'excluded'}`);
}

main().catch(async (err) => {
  // Leave whatever is already published untouched. If the failure landed
  // mid-swap, the previous tree is parked at OLD_DIR — put it back rather than
  // discarding it, so a failed run still leaves the site with data to serve.
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  await recoverInterruptedSwap().catch(() => {});
  await rm(OLD_DIR, { recursive: true, force: true }).catch(() => {});
  console.error('\nIngest failed — existing data left in place.');
  console.error(err);
  process.exit(1);
});
