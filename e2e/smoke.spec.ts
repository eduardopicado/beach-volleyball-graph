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

import type { Page } from '@playwright/test';
import { test, expect, manifest, graph, players, strandedPlayer } from './fixtures.js';
import { sliceSlug } from '../web/src/lib/slug.js';
import { CONTACT_EMAIL } from '../web/src/site.js';

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

test.describe('partners from other federations', () => {
  const sliceFor = (code: string, gender: string) => {
    const entry = manifest().countries.find((c) => c.code === code);
    if (!entry) throw new Error(`${code} missing from the manifest`);
    return `${sliceSlug(entry.name, gender as 'M' | 'W')}/`;
  };

  test('a player with only foreign partners still shows a career', async ({ page }) => {
    const target = strandedPlayer();
    // If the archive ever contains none, the feature has nothing to prove and
    // the test should say so rather than pass silently.
    expect(target, 'no player in the published data has only away partners').not.toBeNull();

    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);
    const card = page.locator('.player-card');
    await expect(card).toBeVisible();

    // The graph genuinely has no edge for them...
    await expect(card.locator('.partners > ul > li')).toHaveCount(0);
    // ...and without this feature that was the whole story. Now it is not.
    await expect(card.locator('.away li')).toHaveCount(target!.away);
    await expect(card.locator('.partners .empty')).toContainText('same federation');

    // The vitals describe the player, not the graph. Counting only the edges
    // put "0 partners" directly above a list of them.
    const partners = card.locator('.vitals div', { has: page.getByText('Partners', { exact: true }) });
    await expect(partners.locator('dd')).toHaveText(String(target!.away));
  });

  test('the away list does not spill over the card below it', async ({ page }) => {
    // The card is capped at the graph's height, and this section used to be
    // allowed to shrink below its own contents — which painted the away rows
    // straight through the FIVB profile link underneath.
    const target = strandedPlayer();
    expect(target).not.toBeNull();
    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);
    await expect(page.locator('.player-card')).toBeVisible();

    const gap = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      const section = box('.partners');
      const link = box('.profile-link');
      return section && link ? link.top - section.bottom : null;
    });
    expect(gap, 'the partners section overlaps the profile link').toBeGreaterThanOrEqual(0);
  });

  test('following an away partner lands on their own country page', async ({ page }) => {
    const target = strandedPlayer();
    expect(target).not.toBeNull();
    await page.goto(`./${sliceFor(target!.code, target!.gender)}?player=${target!.id}`);

    const first = page.locator('.away li button').first();
    const name = (await first.locator('.name').innerText()).trim();
    const startedAt = new URL(page.url()).pathname;
    await first.click();

    // The card now belongs to the partner, in a different slice.
    await expect(page.locator('.player-card h2')).toHaveText(name);
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(startedAt);
  });
});

test.describe('timeline view', () => {
  // Scoped to the switch: the sortable table below the graph has its own
  // "Partners" column-header button, so an unscoped role query is ambiguous.
  const tab = (page: Page, name: 'Partners' | 'Timeline') =>
    page.getByRole('group', { name: 'Partner view' }).getByRole('button', { name, exact: true });

  /** The player in this slice with the most seasons that had two partners. */
  const busiest = () => {
    const data = graph(COUNTRY, GENDER);
    const byPlayer = new Map<number, Map<number, number>>();
    for (const e of data.edges) {
      for (const id of [e.a, e.b]) {
        let seasons = byPlayer.get(id);
        if (!seasons) byPlayer.set(id, (seasons = new Map()));
        for (const [season] of e.s ?? []) seasons.set(season, (seasons.get(season) ?? 0) + 1);
      }
    }
    let best = { id: 0, shared: -1, seasons: 0 };
    for (const [id, seasons] of byPlayer) {
      const shared = [...seasons.values()].filter((n) => n > 1).length;
      if (shared > best.shared) best = { id, shared, seasons: seasons.size };
    }
    return best;
  };

  test('groups a career by season and matches the graph file', async ({ page }) => {
    const target = busiest();
    // Guards the guard: if the published data ever loses its per-season field
    // this test would otherwise pass vacuously against an empty timeline.
    expect(target.shared, 'no player in this slice shares a season').toBeGreaterThan(0);

    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    // One group per season the player actually competed in — derived from the
    // same edges the page was built from, so this stays true as data changes.
    await expect(page.locator('.timeline > li')).toHaveCount(target.seasons);

    // Seasons run newest first.
    const years = await page.locator('.timeline .year').allInnerTexts();
    const numbers = years.map(Number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

    // And the thing the partner list structurally cannot show: one year with
    // more than one name against it.
    const shared = page.locator('.timeline > li').filter({ has: page.locator('ul > li:nth-child(2)') });
    await expect(shared).toHaveCount(target.shared);
  });

  test('switches back to the partner list', async ({ page }) => {
    const target = busiest();
    await page.goto(`./${slicePath()}?player=${target.id}`);

    await expect(tab(page, 'Partners')).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'Timeline').click();
    await expect(tab(page, 'Timeline')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.timeline')).toBeVisible();

    await tab(page, 'Partners').click();
    await expect(page.locator('.timeline')).toHaveCount(0);
    await expect(page.locator('.partners > ul > li').first()).toBeVisible();
  });

  test('a partner in the timeline opens that partner', async ({ page }) => {
    const target = busiest();
    await page.goto(`./${slicePath()}?player=${target.id}`);
    await tab(page, 'Timeline').click();

    const firstPartner = page.locator('.timeline ul li button').first();
    const name = (await firstPartner.locator('.name').innerText()).trim();
    // The timeline is its own scroll container inside a card that is itself
    // sized to the graph, so the first row is not necessarily in view.
    await firstPartner.scrollIntoViewIfNeeded();
    await firstPartner.click();

    await expect(page.locator('.player-card').getByRole('heading', { level: 2 })).toHaveText(name);
    // The view is a reading mode, not a per-player setting: someone working
    // through a career year by year should stay in it as they click through.
    await expect(tab(page, 'Timeline')).toHaveAttribute('aria-pressed', 'true');
  });
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

test.describe('/about/', () => {
  // The one page here that is not the app. Every other document is
  // prerendered markup that React replaces on mount; this one deliberately
  // ships without the module script, because booting the app on a path that
  // matches no country slice would fall back to the default country and swap
  // the text for the Brazil graph. That failure is invisible to a build —
  // the page compiles, deploys and 200s, it just isn't the page any more.
  test('is a standalone document the app never takes over', async ({ page }) => {
    await page.goto('./about/');

    await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
    // The mechanism, asserted directly: no script, nothing to mount.
    await expect(page.locator('script[type="module"]')).toHaveCount(0);
    await expect(page.locator('#root')).toHaveCount(0);
    // And still the About page a beat later, not a graph.
    await expect(page.locator('svg.graph')).toHaveCount(0);
  });

  test('carries the contact address and a way back', async ({ page, baseURL }) => {
    await page.goto('./about/');

    // The address is the reason the page exists — for FIVB, and for anyone
    // with a correction. A broken mailto here is the whole feature failing.
    await expect(page.locator(`a[href="mailto:${CONTACT_EMAIL}"]`).first()).toBeVisible();

    const back = page.getByRole('link', { name: /Back to the graph/ });
    await expect(back).toHaveAttribute('href', new URL('./', baseURL).pathname);
  });

  test('is reachable from the footer of a country page', async ({ page }) => {
    await page.goto(`./${slicePath()}`);
    await page.getByRole('link', { name: 'About this project' }).click();
    await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the prerendered footer carries the contact address', async ({ page }) => {
    // The crawler and no-JS path has its own footer, written by prerender.ts
    // rather than React. It is also the version most likely to be read by the
    // two audiences the address exists for, so it is worth its own check.
    await page.goto(`./${slicePath()}`);
    await expect(page.locator(`footer a[href="mailto:${CONTACT_EMAIL}"]`)).toBeVisible();
  });

  // Canonical tags are the one part of the build that names a URL nobody
  // visits during the test — they describe where the page is *published*, not
  // where it is being served from right now. Which is exactly why they rot
  // silently: SITE_URL and BASE_PATH are set separately by the workflow, and
  // a canonical assembled from a custom origin and a project-Pages base
  // points at a path that exists on neither host. Nothing else in the suite
  // would notice, and the first symptom is Google indexing 265 dead URLs.
  test('the canonical URL describes where the page is published', async ({ page, baseURL }) => {
    const here = `./${slicePath()}`;
    await page.goto(here);

    const href = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(href, 'the prerendered page declares no canonical URL').toBeTruthy();
    const canonical = new URL(href!);

    // Checkable anywhere: the path has to be the path this page is served
    // from, base included. A base that only half made it into the prerender
    // shows up here.
    expect(canonical.pathname).toBe(new URL(here, baseURL).pathname);

    // The origin is only knowable when the build was told one. Locally it
    // isn't, and the placeholder origin is not worth asserting on.
    if (process.env.SITE_URL) {
      expect(canonical.origin).toBe(new URL(process.env.SITE_URL).origin);
    }
  });

  test('the prerendered page still carries the full player table', async ({ page }) => {
    // The crawler path. React never mounts here, so anything visible is what
    // ingest/prerender.ts wrote at build time.
    await page.goto(`./${slicePath()}`);
    const expected = graph(COUNTRY, GENDER).nodes.length;
    await expect(page.locator('table tbody tr')).toHaveCount(expected);
    await expect(page.locator('nav[aria-label="Other countries"] a').first()).toBeVisible();
  });
});
