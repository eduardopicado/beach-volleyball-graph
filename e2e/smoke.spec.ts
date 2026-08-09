/**
 * Does the built site actually work?
 *
 * Every assertion here is cross-checked against the JSON the page was built
 * from, rather than against a number written into the test — so these stay
 * true as the weekly ingest changes the data, and fail when the page and its
 * data stop agreeing.
 *
 * Deliberately *not* covered: anything that depends on synthetic input
 * subtleties (wheel gestures, pinch-zoom). Those are verifiable by hand but
 * measurably flaky under CDP — parking a synthetic cursor over a node makes
 * the following wheel event report `cancelable: false`, which reads as a
 * regression when nothing is wrong. A check that blocks deploys and cries
 * wolf is worse than no check.
 */

import { test, expect, manifest, graph, players } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';

/** A big, always-present slice — the densest realistic render. */
const COUNTRY = 'BRA';
const GENDER = 'M' as const;

const slicePath = () => {
  const entry = manifest().countries.find((c) => c.code === COUNTRY);
  if (!entry) throw new Error(`${COUNTRY} missing from the manifest`);
  return `${sliceSlug(entry.name, GENDER)}/`;
};

test('home page renders and lists countries', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Beach Volleyball Partnership Graph', level: 1 })).toBeVisible();

  // The country picker is populated from the manifest, so an empty one means
  // the data never loaded — the most likely shape of a "blank page" report.
  const options = page.locator('select option');
  await expect.poll(() => options.count()).toBeGreaterThan(50);
  expect(manifest().countries.length).toBeGreaterThan(50);
});

test('a country page draws every node and edge in its graph file', async ({ page }) => {
  await page.goto(`./${slicePath()}`);

  const data = graph(COUNTRY, GENDER);
  // Rendered on mount; the force simulation only moves them afterwards, so
  // this needs no wait for the layout to settle.
  await expect.poll(() => page.locator('[data-node]').count()).toBe(data.nodes.length);
  await expect(page.locator('svg.graph line')).toHaveCount(data.edges.length);
});

test('the headline player count matches the graph file', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const expected = graph(COUNTRY, GENDER).nodes.length;
  await expect(page.locator('.tile.is-hero .value')).toHaveText(expected.toLocaleString('en-US'));
});

test('selecting a player opens their card with the right numbers', async ({ page }) => {
  const data = graph(COUNTRY, GENDER);
  // The most-active player: guaranteed to have partners, so the card is fully
  // populated rather than hitting the "no partnerships" empty state.
  const target = [...data.nodes].sort((a, b) => b.tournaments - a.tournaments)[0]!;

  await page.goto(`./${slicePath()}?player=${target.id}`);

  const card = page.locator('.player-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText(target.name);

  // Tournaments on the card must equal the node's own count — the invariant
  // that surfaced the Rank-0 double-counting bug in the first place.
  const tournaments = card.locator('.vitals div', { has: page.getByText('Tournaments', { exact: true }) });
  await expect(tournaments.locator('dd')).toHaveText(String(target.tournaments));
});

test('the card renders vitals from the separate player detail file', async ({ page }) => {
  // The graph file and the player file are fetched separately and joined by
  // id in the browser. If that join breaks, the card still opens and still
  // shows the name — it just renders every vital as an em dash, which is
  // indistinguishable from "FIVB has no height on file" unless something
  // checks a player known to have one.
  const detail = players(COUNTRY, GENDER);
  const withHeight = detail.players.find((p) => p.height !== null);
  expect(withHeight, 'no player in this slice has a height to check').toBeTruthy();

  await page.goto(`./${slicePath()}?player=${withHeight!.id}`);
  const card = page.locator('.player-card');
  const height = card.locator('.vitals div', { has: page.getByText('Height', { exact: true }) });
  await expect(height.locator('dd')).toHaveText(`${withHeight!.height} cm`);
});

test('the table lists the whole slice', async ({ page }) => {
  await page.goto(`./${slicePath()}`);
  const expected = graph(COUNTRY, GENDER).nodes.length;
  await expect.poll(() => page.locator('.table-view tbody tr').count()).toBe(expected);
});

test('published JSON endpoints are reachable', async ({ page, baseURL }) => {
  for (const suffix of ['v1/manifest.json', `v1/graphs/${COUNTRY}-${GENDER}.json`, `v1/players/${COUNTRY}-${GENDER}.json`]) {
    const res = await page.request.get(new URL(suffix, baseURL).toString());
    expect(res.status(), `${suffix} should be served`).toBe(200);
    expect(() => res.json(), `${suffix} should be JSON`).not.toThrow();
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the prerendered page still carries the full player table', async ({ page }) => {
    // The crawler path. React never mounts here, so anything visible is what
    // ingest/prerender.ts wrote at build time.
    await page.goto(`./${slicePath()}`);
    const expected = graph(COUNTRY, GENDER).nodes.length;
    await expect(page.locator('table tbody tr')).toHaveCount(expected);
    await expect(page.locator('nav[aria-label="Other countries"] a').first()).toBeVisible();
  });
});
