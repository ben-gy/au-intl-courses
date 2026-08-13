# International Student Courses

**Every course an international student can legally enrol in inside Australia, and what each one actually costs per teaching week.**

🔗 **Live:** [https://au-intl-courses.benrichardson.dev](https://au-intl-courses.benrichardson.dev)

## What is this?

CRICOS — the Commonwealth Register of Institutions and Courses for Overseas Students — is the list the law requires an Australian provider to appear on before it can teach anyone on a student visa. It holds 26,738 courses from 1,552 providers across 3,927 campuses, and it records, on every single row, the tuition fee, the non-tuition fee, the estimated total and how many weeks the course runs.

The official register lets you look up one course at a time, and shows no price at all on its results. This site loads the whole thing and derives the one column that makes it comparable: **dollars per teaching week**.

That derivation is the entire point. 10,301 of the courses on the register carry a **VET national code**, which means the qualification is nationally defined — the same units, the same training package, the same certificate at the end, whoever you pay. So their prices are a genuine like-for-like comparison, and 355 of those qualifications are sold by more than one provider. But the same code is registered over anything from 31 to 130 weeks, so ranking on the sticker price largely ranks course *length*: the cheapest totals are often just the shortest courses. Dividing by each course's own duration is what turns a register into a comparison.

On BSB80120, the Graduate Diploma of Management (Learning), 452 registered providers sell one legally identical qualification at $192 per teaching week at the 10th percentile and $346 at the 90th.

## Who is this for?

A prospective international student holding an offer letter or an agent's quote, usually on a phone and usually in a second language, trying to work out whether the number they have been given is normal. There is a private "what were you quoted?" box that drops their figure onto the distribution — it stays in the browser, is never saved, never sent, and never appears in the page address.

It is also for education agents checking a provider is real, and for reporters and analysts who want the shape of the sector rather than a press release.

## Data Sources

| Source | What it provides | Update frequency |
|---|---|---|
| [CRICOS bulk export](https://data.gov.au/data/dataset/cricos) (Department of Education) | Every course, provider, campus and fee | Monthly |
| CRICOS monthly snapshots (same dataset, 60 dated files) | Jul 2021 → present, for arrivals and departures | Monthly |
| [ABS ASGS 2021 Postal Areas](https://www.abs.gov.au/) | Real postcode boundaries for the map | 5-yearly |
| [matthewproctor/australianpostcodes](https://github.com/matthewproctor/australianpostcodes) | Postcode centroids — CRICOS records no coordinates | Continuous |

The register is published under the **Creative Commons Attribution 2.5 Australia** licence; boundaries under CC BY 4.0.

## Features

- **Same Qualification** — every registered offering of one nationally coded qualification as a beeswarm on a $/teaching-week axis, with a decile fan, duration shading, and your own quote marked on it.
- **Compare Qualifications** — all 355 comparable qualifications as range bars on one shared axis, so the primary visual quantity is how much providers *disagree* about what the same thing is worth. A duration sparkbar beside each row shows the other half of the story.
- **Find a Course** — the whole register, searchable and filterable, every row carrying a bar showing where its price sits among its peers.
- **Where** — a Leaflet map over real ABS postcode boundaries. Postcode 3000 alone holds campuses of 291 different providers.
- **Cost and Time** — all 26,574 priced courses on one plane, with iso-rate rays. A constant price-per-week is a straight line through the origin, so the duration confound becomes something you can see.
- **Fields and Levels** — 12 fields × 8 qualification bands, with three separate encodings per cell so "lots of courses" and "expensive courses" can never be mistaken for each other.
- **Providers** — the whole population on two log axes of registry fact, plus each provider's position inside every qualification it shares with someone else.
- **Shared Addresses** — which providers list a campus at the same street address. Lawful and routine; the view names buildings, not conduct.
- **Arrivals and Departures** — 60 monthly extracts of the register. Only the current snapshot is normally published, so this is the one thing here that cannot be read off the official site.

## Tech Stack

- **Runtime:** Vanilla TypeScript — no framework
- **Build:** Vite 6 · **Testing:** Vitest (164 tests)
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, monthly
- **Libraries:** Leaflet for the map. Every chart is hand-rolled SVG; there is no charting library, and a test fails the build if one appears.

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview

# Rebuild the data from source (downloads ~300 MB the first time)
npm run data && npm run gates
```

## How it works

`pipeline/collect.mjs` resolves everything through the data.gov.au CKAN API — never a hardcoded resource id, because a new monthly snapshot arrives as a new resource — then downloads the bulk ZIP and any monthly extract it has not already digested. `pipeline/model.mjs` joins the four tables, derives per-week pricing, builds the comparison spine and the co-location graph. `pipeline/aggregate.mjs` writes the JSON the browser loads, split by *when* it is needed rather than by what it is about.

`pipeline/gates.mjs` then refuses to publish data that is wrong. It runs 21 checks in two classes: **correctness** gates assert identities that must hold whatever the register says next month (the fee arithmetic; 100% numeric postcodes, which is the tripwire for a column-shifting parse bug; zero orphan joins; every $/week independently re-derived from the raw CSV), and **plausibility** gates assert this month's numbers resemble last month's. A failure exits non-zero and nothing is committed.

Everything the reader sees is a published registry fact or an arithmetic derivation of one, and the site says which is which.

## What this data cannot tell you

- **Nothing about quality.** CRICOS records no completions, no satisfaction, no outcomes, no ratings. A cheaper provider is not a worse one.
- **Nothing about size.** There are no enrolment numbers anywhere in the register. Course count is catalogue breadth; registered capacity is a legal ceiling set by the regulator, not a headcount.
- **Nothing about why a provider left.** The monthly extracts show a provider gone; they never say whether that was a closure, a merger, a rename or a withdrawal.
- **These are registered fees, not quotes** — before scholarships, and before anything an agent tells you.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs, and their attribution requirements are rendered in the site's own footer and About panel.
