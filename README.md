# Beach Volleyball Partnership Graph

Pick a country and gender, and see every player who has competed in FIVB
international beach volleyball, linked to the partners they have played with.

Data comes from the official [FIVB VIS Web Service][vis] and is rebuilt weekly.

[vis]: https://www.fivb.org/VisSDK/VisWebService/

![Partnership graph for Brazil, men, filtered to pairs with 3+ shared tournaments](docs/screenshot.png)

---

## What counts as a tournament

Only **FIVB-organised international** competition:

| Tier | Events |
|---|---:|
| FIVB World Tour (1987–2021) | ~1,200 |
| Beach Pro Tour (2022–) | ~500 |
| Age-group World Championships | ~90 |
| World Championships | ~30 |
| Olympic Games | ~15 |

Continental tours and championships (CEV, AVC, NORCECA, CSV, CAVB), national
tours, snow volleyball, multi-sport games and King of the Court are all
excluded. So are two events that sound like they belong in that last row and
do not:

- The **Youth Olympic Games** are an age-group event. Counting them as Olympic
  would put U19 competition in the senior graph, and — because VIS does not
  tag them as an age-group championship — `INCLUDE_AGE_GROUP` could not reach
  them.
- The **Olympic Qualification Tournament** hands out Games berths rather than
  crowning a winner, so several teams "win" it: the 2019 edition records two
  teams at Rank 1 and two more at Rank 3 in each draw. That is not what `Rank`
  means anywhere else here.

**Cancelled events are excluded too.** VIS has no status field for them — the
word goes in the tournament's display name, as in "Hamburg (canceled)" — so
they used to be counted as tournaments that happened. Around 130 of them are
in the archive, roughly half from 2020.

> Every count in this README is **approximate and rounded**, and drifts as the
> archive is rebuilt each week. The exact current figures are always in
> [`/v1/manifest.json`](web/public/v1/manifest.json) — precise numbers written
> into prose here have gone stale twice already, so they are not repeated.

VIS records an `OrganizerType` and a `Type` per tournament. `OrganizerType = 1`
(FIVB) is necessary but **not** sufficient — FIVB is listed as organiser for a
number of continental championships, zonal tours, seminars and test events. So
the filter is `OrganizerType = 1` *and* an explicit allowlist of `Type` values.
Every kept tournament carries its tier through to `manifest.json`, so the filter
is auditable from the published output.

See [`ingest/tiers.ts`](ingest/tiers.ts) — the allowlist is one table, and
everything deliberately excluded is listed there with a reason.

> **Age-group world championships** (U17–U23) are included by default: they are
> FIVB world-level events. Set `INCLUDE_AGE_GROUP=false` to restrict the graph
> to the senior game.

## How a graph is built

1. **Tournaments** — one `GetBeachTournamentList` call, filtered to the tier
   allowlist and to events that were not cancelled.
2. **Players** — one `GetPlayerList` call. Deliberately *unfiltered*: several
   thousand players who entered FIVB beach events are not flagged `PlaysBeach`
   in VIS, and filtering on it silently drops their partnerships.
3. **Entries** — one `GetBeachTeamList` call returns every team entry on
   record, a little over 200,000 of them.
4. **Aggregate** — collapse entries into weighted edges keyed by a canonical
   unordered pair, `min(id):max(id)`.
5. **Slice** — group by country × gender and write one file per slice.

The entire FIVB archive is reachable in **three bulk requests** (~36 MB, about
11 seconds). There is no per-tournament fan-out, no rate-limit pacing and no
incremental cache — a full rebuild every week is cheap and self-healing.

### Counting rules

- One team entry = one tournament for that pair. A pair that appears in both
  the qualification and the main draw of the same event counts **once** (edges
  hold a set of tournament numbers, not a counter).
- Self-pairs, entries with a missing second player (withdrawals and
  placeholders) and entries referencing unknown players are dropped and counted
  in the ingest log.
- **A team that registered but never played does not count.** VIS keeps a
  registration row after it has been superseded — a pair enters, one side
  re-pairs with somebody else before the event, and the original row stays
  behind with `Rank` 0, which FIVB defines as "team has not played the
  tournament". Those rows are dropped. The same rule handles tournaments that
  have not happened yet: FIVB publishes entry lists in advance, and every one
  of those rows is `Rank` 0 too.
- A player's country is their **current** federation. No federation history is
  kept.
- **Both endpoints must be in the slice.** A partnership between a Brazilian and
  an Argentine appears in neither country's graph. Measured against the live
  archive that is ~1% of all partnerships.

### Why the default graph looks so sparse

Across the whole dataset the mean is barely two partners per player — but the
**median player has one partner and one tournament**, because the archive is
dominated by one-off entrants:

| Population | Players | Mean partners | Median |
|---|---:|---:|---:|
| Everyone | ~12,000 | 2.3 | 1 |
| ≥3 tournaments | ~5,500 | 3.6 | 3 |
| ≥10 tournaments | ~2,700 | 5.0 | 5 |
| ≥50 tournaments | ~700 | 6.7 | 6 |

Roughly **half** of all players have exactly one partner and around **four in
ten** entered exactly one tournament, ever. Career players behave the way you
would expect — about five partners — and the **Min. events together** filter is
the quickest way to see only them.

The medians are the stable part of that table; the counts move every week and
the means drift slowly. `llms.txt` carries the same shape figures computed at
build time, so those are exact.

## Published data contract

Everything under `/v1/` is static JSON:

```
/v1/manifest.json            index: countries, node counts, tiers, freshness
/v1/graphs/{CC}-{G}.json     nodes + edges for one country × gender
/v1/players/{CC}-{G}.json    height, weight, date of birth and any medals
```

Edge keys are terse (`a`, `b`, `t`, `f`, `l`) because edges dominate file size.
Player detail is a **separate file per slice**, not per player: it loads once
alongside the graph, so opening a profile costs no network request. Even the
largest country's pair of files comes to well under 200 KB uncompressed.

The schema is [`web/src/schema.ts`](web/src/schema.ts), shared verbatim by the
ingest pipeline and the app so the two cannot drift.

Breaking the schema means writing `/v2/` and cutting the frontend over — no
coordinated deploy.

## Reading the graph

- **Circle size** — tournaments that player entered, area-proportional. (Not
  their partner count — that is in the tooltip and the table.)
- **Line thickness** — events that pair played together.
- **Min. events together** — hides partnerships below the threshold, and the
  players left with no remaining partnership. Node size still reflects each
  player's full career, because that is a property of the player rather than of
  the edges on screen.
- **Hover or focus a player** to highlight their partners; **click** for the
  full profile.
- Drag to pan, scroll to zoom, `Fit` to reframe.
- The **table below the graph** is the accessible twin: every value the graph
  encodes visually is sortable text there, with no pointer required.

Graph labels use the name a player actually competes under ("Emanuel",
"Alison") rather than their full legal name, and are thinned by collision so
they stay readable.

Photos come straight from FIVB's image service and simply do not exist for many
players; those fall back to an initials avatar. Always request them with a
`width` — without one FIVB serves the 2–3 MB original, with one you get a
resized WebP of about 10 KB. Photo and profile URLs are derived from the player
id in `schema.ts` rather than stored per player, which keeps the slice files
roughly 60% smaller.

## Running it

```bash
npm install
npm run ingest     # ~11s: fetches FIVB data into web/public/v1/
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test              # unit tests
npm run test:e2e      # browser smoke tests against the built site
npm run test:coverage # unit tests with a coverage report
npm run typecheck
npm run lint
npm run build         # production build + prerender into dist/
```

`test:e2e` needs a browser and a build to point at, once per machine:

```bash
npx playwright install chromium
BASE_PATH=/beach-volleyball-graph/ npm run build
BASE_PATH=/beach-volleyball-graph/ npm run test:e2e
```

`BASE_PATH` has to match between the two — `vite preview` serves at the base the
site was built with, so a mismatch just 404s.

Unit tests cover the pure logic — tier filtering, pair aggregation and dedupe,
medal counting, country-name resolution, the VIS attribute scanner and unit
conversions, graph layout maths (fit-to-view, label collision, radius scaling),
slug round-trips and HTML escaping.

`npm run test:e2e` is the other half: a Playwright smoke suite against the
*built* site served by `vite preview`, at the same `BASE_PATH` the deploy uses,
so what it exercises is what ships — prerendered HTML and asset URLs included.
It asserts the page renders, that nothing throws, that the graph draws exactly
the nodes and edges in the JSON, and that the no-JavaScript path still carries
the full player table. Every assertion is checked against the data files rather
than a number written into the test, so it survives the weekly rebuild. It runs
on every pull request and again before the deploy uploads anything.

It catches *broken*, not *wrong*: a page can render perfectly with bad numbers
in it. That failure mode is what the data invariants and `ingest/regression.ts`
are for.

Generated data under `web/public/v1/` **is committed**. It is this project's
only durable copy of the dataset — FIVB is a free third-party service with no
continuity guarantee — so a fresh clone can build without a successful fetch,
a code-only change can deploy while VIS is down, and the commit history doubles
as a changelog of the archive. See the header comment in
[`ingest/main.ts`](ingest/main.ts) for the full reasoning, and why the files are
pretty-printed and sorted by immutable keys.

## SEO

A client-rendered SPA with everything behind `?country=BRA` gives crawlers one
URL and an empty `<div id="root">`. Every graph already exists as JSON at build
time, so `npm run build` also prerenders **one real HTML page per country ×
gender** (one per published slice, ~265 pages) via `ingest/prerender.ts`:

- `/brazil-men/`, `/norway-women/`, … each a static document containing the
  complete player table, an `h1`/`h2`, and internal links to other countries.
  With JavaScript disabled you get the complete table — a couple of hundred
  player rows for Brazil — not a blank page.
- Per-page `<title>`, meta description, `rel=canonical`, Open Graph and Twitter
  cards.
- JSON-LD: `WebPage` + `BreadcrumbList` + `ItemList` of `Person` per slice, and
  `WebSite` + `Dataset` on the home page.
- `sitemap.xml` (every page, `lastmod` from the data) and `robots.txt`.
- `llms.txt` ([llmstxt.org](https://llmstxt.org/)) — a markdown briefing for
  language models: the totals, what is deliberately excluded, the counting
  rules they would otherwise guess wrong (edge weights, one-off entrants,
  same-federation slicing) and links to the raw JSON so they read that rather
  than scrape the HTML.

React replaces the static markup on mount, so this is not a second
implementation to maintain — it is the same data rendered once at build time.
The app then keeps the URL, title and canonical in sync as you navigate, and
still accepts the old `?country=&gender=` links.

**`SITE_URL` must be set at build time** — canonical tags, Open Graph URLs and
the sitemap are absolute and baked in, so a wrong value publishes wrong
canonicals:

```bash
SITE_URL=https://your-domain.example npm run build
```

## Deployment

`.github/workflows/deploy.yml` runs weekly (Sundays 03:17 UTC), on pushes to
`main`, and on demand via *Run workflow*. It lints, typechecks, unit-tests,
ingests, builds, smoke-tests the built site in a browser, and only then deploys
to GitHub Pages. On a plain code push the ingest job is skipped entirely, so
shipping a CSS fix does not require FIVB to be reachable.

The workflow enables Pages itself (`configure-pages` with `enablement: true`),
so there is nothing to click first. If your organisation restricts who may turn
Pages on, the API call is refused and you will need **Settings → Pages → Source
→ GitHub Actions** once, by hand.

If the ingest step fails the job stops before deploying, so the previously
published site keeps serving last week's data — the failure notification from
Actions is the whole monitoring story.

The ingest also refuses to publish if the data looks wrong (no qualifying
tournaments, or fewer than 1,000 aggregated partnerships), and writes to a temp
directory that is only swapped into place once every file exists — so a
half-published state is not reachable.

### Cloudflare Pages + a custom domain

`.github/workflows/deploy-cloudflare.yml` is the alternative to GitHub Pages.
Disable whichever one you are not using so they do not both rebuild weekly.

1. Point the domain's nameservers at Cloudflare (at registro.br: *Alterar
   servidores DNS*). Propagation is usually under an hour.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Direct Upload**,
   project name `beachvolleyballgraph`. The workflow uploads to it; there is no
   need to connect the Git repo, and connecting it would build the site a second
   time without the FIVB data.
3. Add the repository secrets `CLOUDFLARE_API_TOKEN` (permission: *Cloudflare
   Pages → Edit*) and `CLOUDFLARE_ACCOUNT_ID`, and the repository **variable**
   `SITE_URL` (e.g. `https://beachvolley.com.br`, no trailing slash).
4. Pages → your project → **Custom domains** → add the domain. Cloudflare adds
   the CNAME itself when it is the authoritative DNS.

`BASE_PATH` is `/` there (domain root), versus `/<repo>/` on project Pages —
which is exactly why the base is configurable rather than hard-coded.

### Being a good citizen of the API

VIS is free and unmetered. This project sends three requests a week. If you fork
it, set a real contact address in `VIS_USER_AGENT` and request an application
identifier from `vis.sdk@fivb.org`.

## Upstream data quirks

The FIVB archive has a number of surprises that cost real debugging time —
`Type` 15 being National Tour rather than "1-star", `Rank` 0 meaning
"registered but never played", future tournaments arriving with full entry
lists, test records in production player data. They are catalogued, with the
evidence and where each is handled, in
[`docs/fivb-data-quirks.md`](docs/fivb-data-quirks.md).

Read it before changing anything in `ingest/tiers.ts` or the filters in
`ingest/build.ts` — most of those rules look arbitrary until you know what
they are defending against.

## Layout

```
ingest/     the weekly pipeline (VIS client, tier allowlist, aggregation)
web/src/    the app (schema, force layout, components)
e2e/        browser smoke tests, run against the built site
docs/       notes worth keeping (see the data quirks catalogue above)
```
