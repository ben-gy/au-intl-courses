#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// aggregate.mjs — cache → the JSON the browser actually loads.
//
// Payloads are split by WHEN they are needed, not by what they are about:
//   meta.json     tiny, first paint
//   base.json     providers, campuses, buildings, matrix, geography — every view
//   compare.json  the national-code comparison spine — the signature view
//   courses.json  all 26,738 courses, columnar — the table and the drill-downs
//   churn.json    sixty monthly digests
//   poa.geojson   only the postcode polygons that actually contain a campus

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, toObjects, monthRange, quantile } from './parse.mjs';
import { buildModel, levelRank, VET_LEVELS } from './model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'pipeline', '.cache');
const SNAPS = path.join(ROOT, 'pipeline', 'snapshots');
const OUT = path.join(ROOT, 'public', 'data');

const log = (m) => process.stdout.write(`[aggregate] ${m}\n`);

function readTable(name) {
  return toObjects(parseCsv(fs.readFileSync(path.join(CACHE, `${name}.csv`), 'utf8')));
}

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(value));
  log(`wrote ${name} (${fs.statSync(file).size.toLocaleString()} B)`);
}

/* ─────────────────── postcode → centroid reference ─────────────────── */

function postcodeIndex() {
  const rows = toObjects(parseCsv(fs.readFileSync(path.join(CACHE, 'postcodes_ref.csv'), 'utf8')));
  const map = new Map();
  for (const r of rows) {
    const pc = String(r.postcode ?? '').trim().padStart(4, '0');
    const lat = Number(r.lat);
    const lon = Number(r.long);
    if (!/^\d{4}$/.test(pc) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    // The reference has one row per locality; the first delivery-area row for a
    // postcode is the best single centroid, and "Updated" rows sort no better,
    // so keep the first and average nothing (averaging two distant localities
    // that share a postcode would place the campus in a paddock between them).
    if (map.has(pc)) continue;
    map.set(pc, {
      lat, lon,
      locality: String(r.locality ?? '').trim(),
      state: String(r.state ?? '').trim(),
      sa4: String(r.sa4name ?? '').trim(),
    });
  }
  return map;
}

/* ───────────────────────────── churn ───────────────────────────── */

function buildChurn() {
  const files = fs.existsSync(SNAPS)
    ? fs.readdirSync(SNAPS).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : [];
  const snaps = files.map((f) => JSON.parse(fs.readFileSync(path.join(SNAPS, f), 'utf8')));
  if (!snaps.length) return { months: [], series: [], nat: {}, gaps: [] };

  const byMonth = new Map();
  for (const s of snaps) byMonth.set(s.date.slice(0, 7), s);

  const months = monthRange(snaps[0].date.slice(0, 7), snaps[snaps.length - 1].date.slice(0, 7));
  const gaps = months.filter((m) => !byMonth.has(m));

  const series = [];
  let prev = null;
  for (const m of months) {
    const s = byMonth.get(m);
    if (!s) {
      // A missing month is a HOLE, published as null. Zero-filling it would
      // draw a month in which every provider in Australia deregistered.
      series.push({ m, providers: null, courses: null, campuses: null, entered: null, exited: null, gap: true });
      prev = null; // the next month's diff spans a gap and is not a monthly rate
      continue;
    }
    let entered = null;
    let exited = null;
    if (prev) {
      const before = new Set(prev.providerCodes);
      const after = new Set(s.providerCodes);
      entered = [...after].filter((c) => !before.has(c)).length;
      exited = [...before].filter((c) => !after.has(c)).length;
    }
    series.push({
      m,
      date: s.date,
      providers: s.providers,
      courses: s.courses,
      campuses: s.locations,
      priced: s.priced,
      entered,
      exited,
      byType: s.byType,
      byState: s.byState,
      gap: false,
    });
    prev = s;
  }

  // Per-qualification median price over time, for codes present in most months.
  const natMonths = new Map();
  for (const s of snaps) {
    for (const [code, v] of Object.entries(s.nat)) {
      if (!natMonths.has(code)) natMonths.set(code, {});
      natMonths.get(code)[s.date.slice(0, 7)] = v.med;
    }
  }
  const nat = {};
  const present = months.filter((m) => byMonth.has(m));
  for (const [code, obj] of natMonths) {
    // Two thirds of the observed months, or the series is too broken to plot.
    if (Object.keys(obj).length < present.length * 0.66) continue;
    nat[code] = obj;
  }

  return { months, series, nat, gaps, snapshotCount: snaps.length };
}

/* ─────────────────────────── boundaries ─────────────────────────── */

function writeBoundaries(model) {
  const src = path.join(CACHE, 'poa.geojson');
  if (!fs.existsSync(src)) throw new Error('poa.geojson missing — run collect.mjs first');
  const fc = JSON.parse(fs.readFileSync(src, 'utf8'));
  const wanted = new Set(model.geo.map((g) => g.pc));
  const features = fc.features.filter((f) => wanted.has(String(f.properties?.POA_CODE21 ?? '')));
  const out = {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: { pc: String(f.properties.POA_CODE21) },
      geometry: f.geometry,
    })),
  };
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'poa.geojson');
  fs.writeFileSync(file, JSON.stringify(out));
  log(`wrote poa.geojson (${features.length} of ${fc.features.length} postcode polygons, ${fs.statSync(file).size.toLocaleString()} B)`);
  return { matched: features.length, wanted: wanted.size };
}

/* ──────────────────────────────  main  ────────────────────────────── */

function main() {
  const source = JSON.parse(fs.readFileSync(path.join(CACHE, 'source.json'), 'utf8'));
  const model = buildModel({
    courses: readTable('courses'),
    locations: readTable('locations'),
    institutions: readTable('institutions'),
    courseLocations: readTable('courseLocations'),
    postcodes: postcodeIndex(),
  });

  const s = model.stats;
  log(`model: ${s.providerCount} providers, ${s.campusCount} campuses, ${s.courseCount} courses, ${s.edgeCount} edges`);
  log(`       ${s.natCodeCount} priced national codes, ${s.comparable2} comparable, ${s.sharedBuildings} shared buildings`);

  const boundaries = writeBoundaries(model);
  const churn = buildChurn();

  /* providers.json — loaded at boot with meta; every view needs provider names */
  write('providers.json', {
    dicts: model.dicts,
    levelOrder: model.dicts.levels.map((l, i) => [i, levelRank(l)])
      .sort((a, b) => a[1] - b[1]).map(([i]) => i),
    vetLevels: model.dicts.levels.map((l, i) => (VET_LEVELS.has(l) ? i : -1)).filter((i) => i >= 0),
    byState: model.byState,
    providers: model.providers.map((p) => ({
      i: p.i, code: p.code, name: p.name, trading: p.trading, slug: p.slug, type: p.type,
      capacity: p.capacity, website: p.website, city: p.city, state: p.state,
      courses: p.courses, live: p.liveCourses, campuses: p.campuses, states: p.states,
      levels: p.levels, fields: p.fields, med: p.medPerWeek, min: p.minPerWeek, max: p.maxPerWeek,
      peerPct: p.peerPct, peerN: p.peerN, nat: p.natCodes,
    })),
  });

  /* places.json — campuses, shared buildings, the matrix and the geography.
     Lazy: nothing on first paint needs it. */
  write('places.json', {
    campuses: model.campuses.map((c) => ({
      i: c.i, p: c.p, name: c.name, t: c.t, addr: c.addr, city: c.city, state: c.state,
      pc: c.pc, lat: c.lat, lon: c.lon, locality: c.locality, courses: c.courses, b: c.akey,
    })),
    buildings: model.buildings,
    matrix: model.matrix,
    geo: model.geo,
  });

  /* compare.json — the signature view */
  write('compare.json', {
    codes: model.compare.map((e) => ({
      nat: e.nat, title: e.title, level: e.level, bf: e.bf,
      providers: e.providers, offers: e.offers, suspect: e.suspect,
      pw: Object.fromEntries(Object.entries(e.pw).map(([k, v]) => [k, v == null ? null : Math.round(v * 100) / 100])),
      tuition: Object.fromEntries(Object.entries(e.tuition).map(([k, v]) => [k, v == null ? null : Math.round(v)])),
      weeks: e.weeks,
      rows: e.rows,
    })),
  });

  /* courses.json — columnar, because 26,738 objects with 14 keys each is
     three times the bytes of 14 arrays with 26,738 values. */
  const c = model.courses;
  write('courses.json', {
    n: c.length,
    code: c.map((x) => x.code),
    name: c.map((x) => x.name),
    p: c.map((x) => x.p),
    nat: c.map((x) => x.nat),
    level: c.map((x) => x.level),
    bf: c.map((x) => x.bf),
    nf: c.map((x) => x.nf),
    lang: c.map((x) => x.lang),
    weeks: c.map((x) => x.weeks),
    tuition: c.map((x) => x.tuition),
    nonTuition: c.map((x) => x.nonTuition),
    total: c.map((x) => x.total),
    pw: c.map((x) => (x.perWeek == null ? null : Math.round(x.perWeek * 100) / 100)),
    flags: c.map((x) => x.flags),
    locs: c.map((x) => x.locs),
  });

  write('churn.json', churn);

  /* ── the distribution facts the copy is allowed to quote ── */
  const pricedPw = model.courses
    .filter((x) => x.perWeek != null && !(x.flags & 16) && !(x.flags & 8))
    .map((x) => x.perWeek).sort((a, b) => a - b);
  const headline = model.compare[0];

  write('meta.json', {
    asAt: source.modified.slice(0, 10),
    generated: new Date().toISOString().slice(0, 19) + 'Z',
    snapshotMonths: churn.snapshotCount,
    firstMonth: churn.series.find((x) => !x.gap)?.m ?? null,
    lastMonth: [...churn.series].reverse().find((x) => !x.gap)?.m ?? null,
    gaps: churn.gaps,
    counts: s,
    boundaries,
    priceQuantiles: {
      p1: Math.round(quantile(pricedPw, 0.01)),
      p10: Math.round(quantile(pricedPw, 0.1)),
      p50: Math.round(quantile(pricedPw, 0.5)),
      p90: Math.round(quantile(pricedPw, 0.9)),
      p99: Math.round(quantile(pricedPw, 0.99)),
      max: Math.round(pricedPw[pricedPw.length - 1]),
      n: pricedPw.length,
    },
    headline: headline ? {
      nat: headline.nat, title: headline.title, providers: headline.providers,
      p10: Math.round(headline.pw.p10), med: Math.round(headline.pw.med), p90: Math.round(headline.pw.p90),
      minWeeks: headline.weeks.min, maxWeeks: headline.weeks.max,
      ratio: Math.round((headline.pw.p90 / headline.pw.p10) * 100) / 100,
    } : null,
    source: {
      name: 'Commonwealth Register of Institutions and Courses for Overseas Students (CRICOS)',
      publisher: source.publisher,
      landing: source.landing,
      licence: source.licenceTitle,
      licenceUrl: source.licenceUrl,
      modified: source.modified,
      register: 'https://cricos.education.gov.au/',
    },
  });

  log('done');
}

main();
