#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// gates.mjs — refuse to ship data that is wrong.
//
// These run against the artefacts in public/data that would actually be
// published, not against an intermediate. A failing gate exits non-zero, and
// the workflow commits nothing.
//
// Two classes of gate, deliberately kept apart:
//
//   CORRECTNESS gates assert an identity that must hold no matter what the
//   register says next month — the fee arithmetic, the joins, the postcode
//   column. A correctness failure means the PARSER is broken.
//
//   PLAUSIBILITY gates assert that this month's numbers resemble last month's.
//   A plausibility failure usually means the SOURCE changed, and it needs a
//   human. It is still a hard failure, because shipping a register that has
//   silently halved is worse than shipping nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, toObjects, money, money0, int, perWeek, normPostcode, addressKey } from './parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, 'pipeline', '.cache');

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const results = [];
function gate(kind, name, fn) {
  try {
    const detail = fn();
    results.push({ kind, name, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ kind, name, ok: false, detail: err.message });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const meta = read('meta.json');
const providers = read('providers.json');
const places = read('places.json');
const courses = read('courses.json');
const compare = read('compare.json');
const churn = read('churn.json');
const geojson = JSON.parse(fs.readFileSync(path.join(DATA, 'poa.geojson'), 'utf8'));

const rawCourses = toObjects(parseCsv(fs.readFileSync(path.join(CACHE, 'courses.csv'), 'utf8')));
const rawLocations = toObjects(parseCsv(fs.readFileSync(path.join(CACHE, 'locations.csv'), 'utf8')));

/* ─────────────────────────── CORRECTNESS ─────────────────────────── */

gate('correctness', 'the fee identity holds on every priced course', () => {
  // Estimated Total Course Cost == Tuition Fee + Non Tuition Fee. On the
  // 2026-08 snapshot this is EXACT on all 26,416 priced rows, so it is asserted
  // exactly. If the Department ever ships a rounding change this fails loudly
  // rather than the site quietly publishing a total that does not add up.
  let priced = 0; let bad = 0; const examples = [];
  for (const r of rawCourses) {
    const t = money(r['Tuition Fee']);
    if (t == null) continue;
    priced++;
    const nt = money0(r['Non Tuition Fee']) ?? 0;
    const total = money(r['Estimated Total Course Cost']);
    if (total == null || Math.abs(total - (t + nt)) > 0.5) {
      bad++;
      if (examples.length < 3) examples.push(`${r['CRICOS Course Code']} ${t}+${nt}≠${total}`);
    }
  }
  assert(priced > 20000, `only ${priced} priced courses`);
  assert(bad === 0, `${bad} of ${priced} priced courses break Total = Tuition + Non-Tuition (${examples.join('; ')})`);
  return `${priced.toLocaleString()} priced courses, 0 breaks`;
});

gate('correctness', 'every location row carries a numeric postcode', () => {
  // THE QUOTED-COMMA TRIPWIRE. Location names and addresses contain embedded
  // commas inside quoted fields. A naive split shifts the columns, which moves
  // a suburb name into the postcode column — and the resulting state counts
  // still look entirely plausible. This gate is how a parser regression is
  // caught, so it is asserted at 100%, not at "most".
  const rows = rawLocations.filter((r) => String(r['Location Name'] ?? '').trim());
  const bad = rows.filter((r) => normPostcode(r['Postcode']) == null);
  assert(rows.length > 3000, `only ${rows.length} location rows`);
  assert(bad.length === 0, `${bad.length} location rows have a non-numeric postcode, e.g. ${JSON.stringify(bad.slice(0, 3).map((r) => r['Postcode']))}`);
  return `${rows.length.toLocaleString()} rows, 100% numeric postcodes`;
});

gate('correctness', 'no orphan joins anywhere', () => {
  assert(meta.counts.orphanEdges === 0, `${meta.counts.orphanEdges} course-location edges resolve to no campus`);
  const nProv = providers.providers.length;
  const badCourse = courses.p.filter((p) => p == null || p < 0 || p >= nProv).length;
  assert(badCourse === 0, `${badCourse} courses point at a provider index that does not exist`);
  const badCampus = places.campuses.filter((c) => c.p < 0 || c.p >= nProv).length;
  assert(badCampus === 0, `${badCampus} campuses point at a provider index that does not exist`);
  const nCam = places.campuses.length;
  const badLoc = courses.locs.filter((ls) => ls.some((l) => l < 0 || l >= nCam)).length;
  assert(badLoc === 0, `${badLoc} courses reference a campus index that does not exist`);
  return `${meta.counts.edgeCount.toLocaleString()} edges, 0 orphans`;
});

gate('correctness', 'no course loses its row to the parser', () => {
  const source = meta.counts.sourceCourseRows;
  assert(courses.n === source, `${courses.n} courses shipped from ${source} source rows`);
  return `${courses.n.toLocaleString()} of ${source.toLocaleString()} source rows`;
});

gate('correctness', 'every price is a finite number or an explicit null', () => {
  // A NaN reaches an SVG as cx="NaN" and the mark simply vanishes. Nothing
  // errors and nothing is logged; the chart is just quietly missing points.
  for (const key of ['tuition', 'nonTuition', 'total', 'pw', 'weeks']) {
    const bad = courses[key].filter((v) => v !== null && !Number.isFinite(v)).length;
    assert(bad === 0, `${bad} non-finite values in courses.${key}`);
  }
  for (const e of compare.codes) {
    for (const [k, v] of Object.entries(e.pw)) {
      assert(v === null || Number.isFinite(v), `compare ${e.nat} has a non-finite ${k}`);
    }
    for (const r of e.rows) assert(Number.isFinite(r.pw), `compare ${e.nat} row ${r.c} has a non-finite $/week`);
  }
  return 'all finite';
});

gate('correctness', '$/week is tuition divided by that row\'s OWN duration', () => {
  // Re-derive independently from the raw CSV rather than trusting the model.
  const byCode = new Map();
  for (let i = 0; i < courses.n; i++) byCode.set(courses.code[i], i);
  let checked = 0;
  for (const r of rawCourses) {
    const code = String(r['CRICOS Course Code'] ?? '').trim();
    const i = byCode.get(code);
    if (i == null) continue;
    const expect = perWeek(money(r['Tuition Fee']), int(r['Duration (Weeks)']));
    const got = courses.pw[i];
    if (expect == null) { assert(got == null, `${code} should have no $/week but has ${got}`); continue; }
    assert(got != null && Math.abs(got - expect) < 0.02, `${code}: expected ${expect} $/wk, shipped ${got}`);
    checked++;
  }
  assert(checked > 20000, `only ${checked} rows re-derived`);
  return `${checked.toLocaleString()} rows independently re-derived`;
});

gate('correctness', 'the comparison spine only ever groups identical qualifications', () => {
  // Every row inside a national-code group must actually carry that code.
  const natByCode = new Map();
  for (let i = 0; i < courses.n; i++) natByCode.set(courses.code[i], courses.nat[i]);
  for (const e of compare.codes) {
    for (const r of e.rows) {
      assert(natByCode.get(r.c) === e.nat, `course ${r.c} sits in group ${e.nat} but carries national code ${natByCode.get(r.c)}`);
    }
    assert(e.rows.length === e.offers, `${e.nat} claims ${e.offers} offerings but ships ${e.rows.length}`);
    assert(e.providers <= e.offers, `${e.nat} claims more providers (${e.providers}) than offerings (${e.offers})`);
  }
  return `${compare.codes.length} qualification groups`;
});

gate('correctness', 'quantiles are ordered, in every group', () => {
  for (const e of compare.codes) {
    const q = [e.pw.min, e.pw.p10, e.pw.p25, e.pw.med, e.pw.p75, e.pw.p90, e.pw.max].filter((v) => v != null);
    for (let i = 1; i < q.length; i++) {
      assert(q[i] >= q[i - 1] - 0.011, `${e.nat} quantiles out of order: ${q.join(' ')}`);
    }
  }
  return 'monotone everywhere';
});

gate('correctness', 'suspected misreporting is flagged, never deleted', () => {
  const F_SUSPECT = 16;
  const flagged = courses.flags.filter((f) => f & F_SUSPECT).length;
  assert(flagged === meta.counts.suspectCount, 'flag count disagrees with meta');
  // Every flagged course must still be present in its comparison group.
  const flaggedCodes = new Set();
  for (let i = 0; i < courses.n; i++) if (courses.flags[i] & F_SUSPECT) flaggedCodes.add(courses.code[i]);
  let inGroups = 0;
  for (const e of compare.codes) for (const r of e.rows) if (flaggedCodes.has(r.c)) { assert(r.s === 1, `${r.c} is flagged in courses but not in compare`); inGroups++; }
  return `${flagged} flagged, ${inGroups} of them still drawn inside their qualification group`;
});

gate('correctness', 'a missing month is null, never zero', () => {
  // Zero-filling 2022-05 would draw a month in which every provider in
  // Australia deregistered and then all came back.
  for (const point of churn.series) {
    if (point.gap) {
      assert(point.providers === null && point.courses === null, `gap month ${point.m} carries numbers`);
    } else {
      assert(point.providers > 0 && point.courses > 0, `month ${point.m} has zero providers or courses`);
    }
  }
  assert(churn.gaps.length === churn.series.filter((p) => p.gap).length, 'gap list disagrees with the series');
  return `${churn.series.length} months, ${churn.gaps.length} drawn as gaps (${churn.gaps.join(', ') || 'none'})`;
});

gate('correctness', 'the first month after a gap claims no monthly churn rate', () => {
  // A diff taken across a six-month hole is not a monthly rate. It must be null.
  for (let i = 0; i < churn.series.length; i++) {
    if (i > 0 && churn.series[i - 1].gap && !churn.series[i].gap) {
      assert(churn.series[i].entered === null && churn.series[i].exited === null,
        `${churn.series[i].m} follows a gap but reports a monthly entered/exited count`);
    }
  }
  return 'post-gap months report no rate';
});

gate('correctness', 'the co-location key is conservative, not creative', () => {
  // VALIDATE THE GUARD WHERE THE FAILURE LIVES. The risk in an address matcher
  // is not that it misses — it is that it MERGES two different buildings and
  // publishes a co-location that does not exist. So the assertions below are
  // about pairs that must NOT match, using real address shapes from the file.
  const same = [
    [['Level 2, 120 Spencer Street'], ['120 Spencer Street'], '3000'],
    [['Suite 4', '120 Spencer St'], ['120 Spencer Street, Docklands'], '3000'],
    [['Ground Floor 55 Swanston Rd'], ['55 Swanston Road'], '3000'],
  ];
  for (const [a, b, pc] of same) {
    const ka = addressKey(a, pc); const kb = addressKey(b, pc);
    assert(ka && kb && ka === kb, `expected a match: ${JSON.stringify(a)} vs ${JSON.stringify(b)} → ${ka} / ${kb}`);
  }
  const different = [
    [['120 Spencer Street'], ['122 Spencer Street'], '3000'],   // different number
    [['120 Spencer Street'], ['120 Spencer Street'], '3000', '2000'], // different postcode
    [['120 King Street'], ['120 Queen Street'], '3000'],        // different street
    [['Level 2'], ['Level 3'], '3000'],                         // no street number at all
  ];
  for (const [a, b, pcA, pcB] of different) {
    const ka = addressKey(a, pcA); const kb = addressKey(b, pcB ?? pcA);
    assert(ka === null || kb === null || ka !== kb, `expected NO match: ${JSON.stringify(a)} vs ${JSON.stringify(b)} → both ${ka}`);
  }
  // And every shipped building must genuinely hold two distinct providers.
  for (const b of places.buildings) {
    assert(new Set(b.providers).size >= 2, `building ${b.key} claims co-location with ${b.providers.length} provider slots but fewer distinct providers`);
  }
  return `${places.buildings.length} shared buildings, matcher refuses ${different.length}/${different.length} near-misses`;
});

gate('correctness', 'every mapped postcode has a real ABS polygon or is honestly absent', () => {
  const have = new Set(geojson.features.map((f) => String(f.properties.pc)));
  for (const f of geojson.features) {
    assert(f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length,
      `postcode ${f.properties.pc} has an empty geometry`);
  }
  const wanted = places.geo.map((g) => g.pc);
  const missing = wanted.filter((pc) => !have.has(pc));
  // Some campus postcodes are LVR or PO-box ranges that ABS does not draw at
  // all. That is a real absence, not a parse failure — but it must stay small.
  assert(missing.length / wanted.length < 0.08,
    `${missing.length} of ${wanted.length} campus postcodes have no ABS polygon`);
  assert(meta.boundaries.matched === have.size, 'meta disagrees with the shipped geojson');
  return `${have.size} polygons for ${wanted.length} campus postcodes (${missing.length} postcodes not drawn by ABS)`;
});

gate('correctness', 'the geometry is real, not hand-drawn', () => {
  // A hand-authored "boundary" is a rectangle. Real ABS postcode polygons are
  // not, and the cheapest test for that is vertex count.
  const counts = geojson.features.map((f) => {
    const walk = (a) => (typeof a[0] === 'number' ? 1 : a.reduce((n, x) => n + walk(x), 0));
    return walk(f.geometry.coordinates);
  }).sort((a, b) => b - a);
  assert(counts[0] > 500, `the largest polygon has only ${counts[0]} vertices — that is not real boundary data`);
  const median = counts[Math.floor(counts.length / 2)];
  // Most campus postcodes are small CBD polygons, so the median is naturally
  // low — but below ~12 the simplification has started eating real corners and
  // the CBDs render as lozenges.
  assert(median > 12, `median polygon has ${median} vertices — the simplification is too aggressive`);
  return `${counts.length} polygons, largest ${counts[0]} vertices, median ${median}`;
});

/* ─────────────────────────── PLAUSIBILITY ─────────────────────────── */

gate('plausibility', 'the register is the size it has always been', () => {
  const c = meta.counts;
  assert(c.providerCount > 1200 && c.providerCount < 2200, `${c.providerCount} providers`);
  assert(c.courseCount > 20000 && c.courseCount < 40000, `${c.courseCount} courses`);
  assert(c.campusCount > 3000 && c.campusCount < 6000, `${c.campusCount} campuses`);
  assert(c.edgeCount > 35000 && c.edgeCount < 80000, `${c.edgeCount} course-campus edges`);
  return `${c.providerCount} providers · ${c.courseCount.toLocaleString()} courses · ${c.campusCount.toLocaleString()} campuses`;
});

gate('plausibility', 'the register did not lurch between the last two snapshots', () => {
  const real = churn.series.filter((p) => !p.gap);
  const last = real[real.length - 1];
  const prev = real[real.length - 2];
  assert(last && prev, 'fewer than two readable snapshots');
  const drift = Math.abs(last.providers - prev.providers) / prev.providers;
  assert(drift < 0.1, `provider count moved ${(drift * 100).toFixed(1)}% between ${prev.m} and ${last.m}`);
  return `${prev.m} → ${last.m}: ${prev.providers} → ${last.providers} providers`;
});

gate('plausibility', 'prices land where a fee should land', () => {
  const q = meta.priceQuantiles;
  assert(q.p10 > 50 && q.p10 < 600, `p10 is $${q.p10}/wk`);
  assert(q.p50 > 200 && q.p50 < 1200, `median is $${q.p50}/wk`);
  assert(q.p90 > 400 && q.p90 < 3000, `p90 is $${q.p90}/wk`);
  assert(q.n > 20000, `only ${q.n} priced, unflagged courses`);
  return `p10 $${q.p10} · median $${q.p50} · p90 $${q.p90} per teaching week, n=${q.n.toLocaleString()}`;
});

gate('plausibility', 'the comparison still has something to compare', () => {
  const c = meta.counts;
  assert(c.comparable2 > 200, `only ${c.comparable2} qualifications have two or more providers`);
  assert(c.comparable10 > 50, `only ${c.comparable10} qualifications have ten or more providers`);
  assert(meta.headline && meta.headline.providers > 100, 'the most-offered qualification has fewer than 100 providers');
  return `${c.comparable2} comparable qualifications; the largest is ${meta.headline.nat} with ${meta.headline.providers} providers`;
});

gate('plausibility', 'the headline spread is the honest per-week one', () => {
  // If this ever prints a ratio above ~4 the site is quoting a duration
  // artefact, which is precisely the chart-encoding lie this build refuses.
  const h = meta.headline;
  assert(h.ratio > 1.2 && h.ratio < 4, `p90/p10 on ${h.nat} is ${h.ratio}× — check whether durations are being divided out`);
  assert(h.maxWeeks > h.minWeeks * 1.5, `${h.nat} durations run ${h.minWeeks}–${h.maxWeeks} weeks — the duration confound should be visible`);
  return `${h.nat}: $${h.p10} → $${h.p90} per week (${h.ratio}×) over ${h.minWeeks}–${h.maxWeeks} week courses`;
});

gate('plausibility', 'nearly every campus is placed on the map', () => {
  const c = meta.counts;
  const rate = c.geocodedCampuses / c.campusCount;
  assert(rate > 0.99, `only ${(rate * 100).toFixed(1)}% of campuses have a centroid`);
  return `${c.geocodedCampuses.toLocaleString()} of ${c.campusCount.toLocaleString()} campuses placed (${(rate * 100).toFixed(1)}%)`;
});

gate('plausibility', 'the sector is still overwhelmingly private', () => {
  const c = meta.counts;
  assert(c.privateProviders + c.govProviders > c.providerCount * 0.99, 'providers are unclassified');
  assert(c.privateProviders > c.govProviders * 5, 'the private/government split has inverted — check the Institution Type column');
  return `${c.privateProviders} private, ${c.govProviders} government`;
});

/* ────────────────────────────── report ────────────────────────────── */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  process.stdout.write(`${mark} [${r.kind}] ${r.name}\n    ${r.detail}\n`);
}
process.stdout.write(`\n${results.length - failed.length}/${results.length} gates passed\n`);
if (failed.length) {
  process.stderr.write(`\n${failed.length} gate(s) FAILED — nothing will be published.\n`);
  process.exit(1);
}
