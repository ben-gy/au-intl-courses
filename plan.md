# Site Plan: International Student Courses

## Overview
- **Name:** International Student Courses
- **Repo name:** au-intl-courses
- **Tagline:** Compare what every CRICOS course costs per teaching week — including the hundreds of qualifications that are legally identical whoever you buy them from.

### Naming
Plain topic name, no country in it. The country lives in the index entry's `country: "AU"` field, which lab.benrichardson.dev renders as a flag.

## Target Audience
A prospective international student — in Delhi, Manila, Bogotá, Kathmandu — holding an offer letter or an agent's quote, on a phone, in their second language, with A$15,000–40,000 on the line. Secondarily: education agents checking a provider is real, and the reporters and policy analysts working the private-college integrity story during an active fight over student caps and ESOS reform.

## Value Proposition
CRICOS is the register the law requires every provider to appear on, and the official site lets you look up **one course at a time and shows no price at all on its results**. The register itself already holds the tuition fee, the non-tuition fee, the estimated total and the duration on every single row.

This site loads the whole register and derives the one column that makes it comparable: **dollars per teaching week**. For the 10,301 courses carrying a VET national code, the qualification is nationally defined — same units, same training package, same certificate — so the price is a genuine like-for-like comparison. Nothing else on the open web publishes it.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth? |
|---|---|---|---|---|
| CRICOS bulk export | data.gov.au dataset `cricos` (ZIP of 4 CSVs) | 26,738 courses, 1,552 providers, 3,927 campuses, 47,917 course-at-campus edges, all fees and durations | monthly | No |
| CRICOS monthly snapshots | same package, 60 dated XLSX resources | Jul 2021 → present, for arrivals and departures | monthly | No |
| ABS ASGS 2021 Postal Areas | abs.gov.au digital boundary files | real postcode polygons for the map | 5-yearly | No |
| matthewproctor/australianpostcodes | raw.githubusercontent.com | postcode → centroid (CRICOS has no coordinates) | continuous | No |

Licence: **CC BY 2.5 Australia** (Department of Education), confirmed live on the CKAN record. Boundaries CC BY 4.0.

## Key Features
1. **Same Qualification** — every registered offering of one nationally coded qualification as a beeswarm on a $/teaching-week axis, with a decile fan and a private "what were you quoted?" marker.
2. **Compare Qualifications** — all 355 comparable qualifications as range bars on one shared axis, sorted by how much providers disagree, with a duration sparkbar beside each.
3. **Find a Course** — the whole register, searchable and filterable, every row carrying a peer-percentile bar.
4. **Where** — Leaflet over real ABS postcode boundaries; campus markers, four metrics, per-postcode drill-down.
5. **Cost and Time** — all 26,574 priced courses as a hexbin with iso-rate rays, which makes the duration confound visible instead of asserted.
6. **Fields and Levels** — 12 broad fields × 8 AQF bands, three encodings per cell so price and volume can never be confused.
7. **Providers** — the whole population on two log axes of registry fact, plus per-provider percentile profiles.
8. **Shared Addresses** — a pre-settled graph of providers listing a campus at the same street address.
9. **Arrivals and Departures** — 60 monthly snapshots; the one thing here that cannot be read off the official register.

## Style Direction
**Tone:** calm, civic, trustworthy — a public register, not a dashboard and not a marketing site.
**Palette:** warm paper `#FBFAF7`, deep teal `#0F6E6E` for interaction, a six-step teal→navy price ramp on fixed printed breaks, slate for duration (so it can never read as price), muted brick reserved solely for suspected misreporting, and one warm orange used **only** for the reader's own numbers.
**UI density:** balanced. Generous type (16px minimum), tabular figures on every number.
**Theme:** light, committed — no dark branch.
**Reference sites for tone:** the ABS's own release pages; fuelaustralia.org for practical-utility framing.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite 6 (no framework; nine views, no routing library needed beyond a 55-line hash router)
- **Data strategy:** pipeline, monthly cron (matches the source: a new dated extract lands about the 1st of each month)
- **Key libraries:** Leaflet only. Every chart is hand-rolled SVG.

## Layout
Sticky header (brand, provider search, About) over a sticky nav strip; content in a 1,680px-max column; sticky footer carrying the source, licence and attribution. Below 760px the matrix reflows to one block per field, percentile tracks stack, and the beeswarm switches to a near-1:1 viewBox so its dots stay tappable.

## Visualization Strategy
Nine views, each answering a question none of the others do:

- **Beeswarm** (Same Qualification) — density, not rank. A sorted bar chart of 452 providers is unreadable on a phone and reads as a league table this register cannot support.
- **Range bars on a shared axis** (Compare Qualifications) — makes *disagreement* the primary visual quantity.
- **Hexbin + iso-rate rays** (Cost and Time) — 26,574 points without an ink blob, and the only view where the misreporting story is visible rather than asserted.
- **Matrix** (Fields and Levels) — three separate channels per cell (fill = median price, whisker = spread on the global scale, corner wedge = how many courses it rests on).
- **Choropleth + markers** (Where) — real ABS geometry, log-spaced breaks.
- **Force graph** (Shared Addresses) — pre-settled synchronously, motionless from the first frame.
- **Log-log scatter** (Providers) — two axes that deliberately refuse to collapse into one ranking.
- **Diverging bars + broken line** (Arrivals and Departures) — arrivals above, departures below, never netted; gaps drawn as gaps.
- **Virtualised table** (Find a Course) — the drill destination five other views hand off to.

## What the data cannot do (enforced, not just noted)
- **No enrolments exist anywhere in CRICOS.** Course count is catalogue breadth; registered capacity is a legal ceiling. A hygiene test fails the build if the interface starts implying otherwise.
- **Whole-of-course cost is duration-confounded** — the same code runs 31 to 130 weeks. $/week is the default everywhere; the toggle warns.
- **94 registered fees are below $60/week** and are almost certainly data-entry errors. Drawn hollow, counted in every percentile, barred from every "cheapest" claim, never deleted.
- **The register never says why a provider left.** No departure is called a closure.
