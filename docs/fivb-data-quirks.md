# FIVB VIS data quirks

Things about the upstream data that are surprising, that cost real debugging
time, or that a future change could easily get wrong again.

This is not a complaint list. VIS is a free, generous service and most of what
follows is the ordinary shape of a database that has recorded a sport since
1987 through several format changes. The point is that none of it is
documented in a way that would have saved us the discovery, so it is written
down here instead of being rediscovered.

Each entry says what the quirk is, how it showed up, and where the pipeline
deals with it. Counts are from the archive as of **2026-08-09**; they drift.

---

## 1. `Type` 15 is National Tour, not "1-star"

**What.** VIS `BeachTournament.Type` 15 is named `NationalTour` in
[FIVB's own schema](https://www.fivb.org/VisSDK/VisWebService/BeachTournamentType.html).
The real 1-star is `Type` 42. We had 15 mapped to `world-tour`.

**How it showed up.** Australia had implausibly close to Brazil's player
count. A mate's profile showed one tournament he'd never played
internationally — it was a domestic NT event.

**The nastier half.** `OrganizerType` is *not* a reliable way to filter these
out. Plenty of confirmed domestic tour stops carry `OrganizerType` 1 (FIVB) —
Australia, Argentina, Poland, New Zealand, Cameroon, Mauritius, Egypt, Kenya,
Estonia, Guinea and more, all checked directly against VIS. Filtering on the
organizer alone leaves them in.

**Handled in.** `ingest/tiers.ts` — 15 is absent from `TIER_BY_TYPE`, with a
regression test in `tiers.test.ts` asserting it stays excluded *regardless* of
what `OrganizerType` claims.

---

## 2. The "olympics" tier is three different things

`Type` 5 is the Olympic Games. But `Type` 43 is the **Youth** Olympic Games
and `Type` 49 is the Olympic **Qualification** Tournament — neither is a medal
event, and the OQT has no podium at all.

For counting tournaments that distinction is cosmetic. For counting *medals*
it is not: crediting a YOG medal as Olympic, or reading OQT qualification
standings as a podium, would both be wrong.

**Handled in.** `ingest/build.ts` — `medalTournaments()` narrows to `Type` 5
and `Type` 4 explicitly rather than reusing the tier.

---

## 3. `Rank` 0 means "registered but never played"

**What.** FIVB's field description for `BeachTeam.Rank` is literally *"team
has not played the tournament"* for 0. A blank `Rank` is the same case, and
`Number('')` is conveniently also `0`.

**Why it matters.** VIS keeps a team's registration row after it has been
superseded. A pair registers, one side pulls out before the event and
re-registers with someone else, and the original row is never deleted. Two
rows, two partners, one real appearance — inflating the departed partner's
edge and the dataset totals.

**Scale.** Excluding these dropped the published dataset by ~16% of players
and ~21% of partnerships in one go. That is not a bug in the exclusion: of
2,284 players who disappear entirely, a random sample showed *every* one had
zero rows with a real rank anywhere in their history — their whole FIVB
footprint was registrations that never became matches.

**Do not filter on `Status` instead.** It false-positives both ways.
`Status: Registered` rows still turn up with `Rank: 0`, and a genuine
in-competition retirement doesn't get marked `Withdrawn` at all if it happens
late enough to have earned a placement — a player hurt *during* a
bronze-medal match at a World Championships carries a normal `Status: 0` and a
real `Rank: 4`, because reaching that match locked the placement in. `Rank` is
what separates "never competed" from "competed and has a result".

**Negative ranks are real participation.** `<= -25` is elimination in
qualification, `-2` is elimination via a confederation/federation quota. Both
are kept.

**Handled in.** `ingest/build.ts`, the `didNotPlay` reject in
`aggregatePartnerships`.

---

## 4. Future tournaments are already in the archive, with entry lists

**What.** The tournament list includes events that have not happened. As of
2026-08-09 there are 23 qualifying tournaments whose main draw starts in the
future — 21 in season 2026, 2 in season 2027 — carrying **989 team rows**
between them. FIVB publishes entry lists ahead of the event.

**Why it is not a problem.** Every one of those 989 rows has `Rank` 0, so the
rule in §3 excludes them. Verified: zero rows from a future tournament survive
the filter, and zero season-2027 tournaments contribute a single appearance.
The rule written for withdrawn registrations turns out to cover
"hasn't been played yet" for the same underlying reason — no result, no rank.

**The catch to watch.** The pipeline does not fetch tournament dates at all
(`ingest/main.ts` requests `No, Code, Season, Gender, Type, OrganizerType,
Version`). Nothing distinguishes a scheduled event from a played one *except*
`Rank`. If `Rank` ever gets pre-populated — a seeding rank, say — unplayed
events would start generating partnerships silently. A date-based guard would
be belt and braces.

**Visible side effect.** `manifest.seasons.to` is computed over the qualifying
tournament set, not over tournaments that contributed data, so it reads 2027
while no 2027 match has been played. See §11.

---

## 5. Some World Championships awarded two bronzes

The 1997 World Championships (`MLAX1997`, `WLAX1997`) had no bronze-medal
match; both losing semi-finalists share `Rank` 3. Two teams, one rank, in both
the men's and women's events.

Any code that assumes one team per medal rank is wrong for these two
tournaments. The medal aggregation credits both, and the test fixture in
`build.test.ts` includes them deliberately.

---

## 6. A player's federation is a snapshot, with no history

`Player.FederationCode` is the player's *current* federation. There is no
record of who they represented at a given tournament — and VIS is not always
in step with reality.

**The worked example.** Chaim Schalk is a Canadian Olympian who played 55
events with Ben Saxton for Canada. VIS lists him as `USA`, and FIVB's own
public profile agrees — there is no Canadian profile for him. So on the
USA men's page his own tournament count is 115 while his partner edges sum to
48: four of his eight partners, including the biggest partnership of his
career, are tagged `CAN` and dropped by the same-federation rule.

This is accepted behaviour, not a bug to fix — but it is the reason
"tournaments" and the sum of partner entries can legitimately disagree on a
player card.

**Worth knowing.** `BeachTeam` rows carry their own `FederationCode` — the
federation the pair actually represented at that tournament. The pipeline
fetches it but does not use it. That field is the raw material for a proper
fix if this ever becomes worth doing.

---

## 7. Federation codes that aren't countries

- **`SMA`** — the player sample includes a literal `Test` / `Test` entry
  alongside otherwise unverifiable names. It reads as leftover test data.
- **`FIV`** — no discernible identity; FIVB is not a country. Most likely a
  placeholder for unaffiliated or neutral athletes.

Both are dropped outright rather than guessed at: misattributing a real
person's nationality is worse than omitting them.

**Handled in.** `EXCLUDED_FEDERATIONS` in `ingest/countries.ts`.

---

## 8. The same country under two codes

Netherlands Antilles (`AHO`) dissolved in 2010 and Curaçao's federation kept
the old code, but some player records still carry a standalone `CUR`. Without
an alias they render as two separate Curaçao entries.

**Handled in.** `FEDERATION_ALIASES` in `ingest/countries.ts`.

Related: `AHO`'s ISO code `AN` was withdrawn from ISO 3166. Building a flag
from a withdrawn code gives two boxed letters rather than one glyph, which
reads as the country appearing twice — remapped to `CW` in
`web/src/lib/format.ts`.

---

## 9. The UK home nations can't be told apart by country code

England, Scotland and Northern Ireland are separate FIVB federations that all
carry `CountryCode` `GB`; Wales carries the non-ISO value `04`. Deriving a
display name from the ISO code alone labels three different federations
"United Kingdom". Their federation *names* are organisation names
("VOLLEYBALL ENGLAND"), so neither source works alone.

Flags need Unicode tag sequences rather than regional indicators. Northern
Ireland has no equivalent — Unicode never standardised `gbnir` — so it stays
without one.

**Handled in.** `NAME_OVERRIDES` in `ingest/countries.ts`,
`SUBDIVISION_CODES` in `web/src/lib/format.ts`.

---

## 10. Units and formats that look like corruption

- **Height** is in ten-thousandths of a metre: `1930000` is 193cm.
- **Weight** is in millionths of a kilogram: `57000000` is 57kg.
- **Season** is usually a year but the earliest World Tour records use a
  range, `"1987-91"`. A plain `Number()` yields `NaN` and silently drops those
  events; the parser takes the leading year.
- **Birthdate** can be `0001-01-01` for "unknown".

**Handled in.** `toCentimetres` / `toKilograms` in `ingest/vis.ts`,
`parseSeason` and `normalisePlayers` in `ingest/build.ts`.

---

## 11. Not every qualifying tournament contributes data

Of 1,825 qualifying tournaments, only **1,595** contribute a single
appearance. The other 230 break down as:

| | count |
|---|---:|
| no team rows in VIS at all | 28 |
| team rows present, all `Rank` 0 | 202 |
| *(of those, events still in the future)* | *19* |

Season 2020 is the largest single cluster (65 tournaments) — consistent with a
season that was scheduled and then largely not played.

**Consequence.** `manifest.totals.tournaments` counts tournaments we *track*,
not tournaments the graph is *drawn from*. The published figure therefore
slightly overstates coverage, and `seasons.to` runs to 2027 on the strength of
two unplayed events. Worth aligning if the headline numbers ever need to be
precise.

---

## 12. Flags that don't mean what they say

- **`Player.IsActive`** is not beach-specific — it tracks overall FIVB
  registration across beach, indoor and snow — and is not reliably updated for
  retired athletes. Cross-checked: 66% of players it flags active have no
  qualifying beach tournament in the last five seasons. Deliberately not
  carried through.
- **`PlaysBeach`** is unreliable in the other direction: a few thousand
  players who have entered FIVB beach events are not flagged, and filtering on
  it silently drops their edges. The player list is fetched unfiltered because
  of this.

---

## 13. Responses can be large, and the shape rewards care

The player list alone is ~130,000 rows and the raw XML runs to tens of
megabytes. Two practical consequences:

- A general-purpose XML parser builds a multi-hundred-thousand-node tree and
  trips over entity-expansion limits on a document with this many accented
  names. VIS list responses are flat, attribute-only elements, so scanning
  attributes directly is both correct and an order of magnitude cheaper.
- Always send an explicit `Fields` list. The default response returns every
  attribute and is several times larger, for a service that charges nobody.

**Handled in.** `extractRows` in `ingest/vis.ts`.

---

## Reporting these upstream

Most of the above is ours to work around. Two are arguably worth raising with
FIVB if a channel opens up (see the contact address in `web/src/site.ts`):

- **§1**, National Tour events carrying `OrganizerType` 1, which looks like a
  data-entry inconsistency rather than a deliberate classification.
- **§7**, the `SMA` test records sitting in production player data.
