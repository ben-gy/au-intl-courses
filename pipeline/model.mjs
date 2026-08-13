// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The register's four flat tables → the shape the interface actually needs.
//
// Dependency-free and side-effect-free, like parse.mjs, so the whole model can
// be built and asserted in a unit test from a dozen hand-written rows.

import { STATES, addressKey, isSuspect, money, money0, int, perWeek, quantile, splitField, titleCase, normPostcode, normState, slug } from './parse.mjs';

/** Course flags, packed into one integer per course so the payload stays small. */
export const F_DUAL = 1;
export const F_WORK = 2;
export const F_FOUNDATION = 4;
export const F_EXPIRED = 8;
export const F_SUSPECT = 16;

function indexer() {
  const map = new Map();
  const list = [];
  return {
    list,
    of(value) {
      const v = String(value ?? '').trim();
      if (!map.has(v)) { map.set(v, list.length); list.push(v); }
      return map.get(v);
    },
  };
}

/**
 * Course levels sorted the way a reader thinks about them, not alphabetically.
 * Anything unrecognised sorts to the end rather than being dropped.
 */
const LEVEL_ORDER = [
  'Primary School Studies', 'Junior Secondary Studies', 'Senior Secondary Certificate of Education',
  'Non AQF Award', 'Vocational Short Course',
  'Certificate I', 'Certificate II', 'Certificate III', 'Certificate IV',
  'Diploma', 'Advanced Diploma', 'Associate Degree',
  'Bachelor Degree', 'Bachelor Honours Degree',
  'Graduate Certificate', 'Graduate Diploma',
  'Masters Degree (Coursework)', 'Masters Degree (Extended)', 'Masters Degree (Research)',
  'Doctoral Degree',
];

export function levelRank(label) {
  const i = LEVEL_ORDER.indexOf(label);
  return i < 0 ? LEVEL_ORDER.length : i;
}

/**
 * Levels awarded under a national training package, where a VET National Code
 * makes the qualification identical across providers. Used only to explain the
 * comparison to the reader — the comparison itself keys on the code's presence.
 */
export const VET_LEVELS = new Set([
  'Certificate I', 'Certificate II', 'Certificate III', 'Certificate IV',
  'Diploma', 'Advanced Diploma', 'Vocational Short Course', 'Graduate Certificate', 'Graduate Diploma',
]);

export function buildModel({ courses: rawCourses, locations: rawLocations, institutions: rawInstitutions, courseLocations: rawEdges, postcodes = new Map() }) {
  const dicts = {
    levels: indexer(),
    broadFields: indexer(),
    narrowFields: indexer(),
    locationTypes: indexer(),
    languages: indexer(),
  };

  /* ── providers ── */
  const provIdx = new Map();
  const providers = [];
  for (const r of rawInstitutions) {
    const code = String(r['CRICOS Provider Code'] ?? '').trim();
    if (!code) continue; // the register carries a couple of wholly blank rows
    if (provIdx.has(code)) continue;
    provIdx.set(code, providers.length);
    const typeRaw = String(r['Institution Type'] ?? '').trim();
    providers.push({
      i: providers.length,
      code,
      name: titleCase(r['Institution Name']),
      trading: titleCase(r['Trading Name']),
      slug: slug(`${titleCase(r['Institution Name'])} ${code}`),
      type: typeRaw === 'Government' ? 'G' : typeRaw === 'Private' ? 'P' : '',
      capacity: int(r['Institution Capacity']),
      website: String(r['Website'] ?? '').trim(),
      city: titleCase(r['Postal Address City']),
      state: normState(r['Postal Address State']),
      courses: 0,
      liveCourses: 0,
      campuses: 0,
      states: [],
      levels: {},
      fields: {},
      natCodes: [],
      medPerWeek: null,
      peerPct: null,
      peerN: 0,
      minPerWeek: null,
      maxPerWeek: null,
    });
  }

  /* ── campuses ── */
  const campusIdx = new Map(); // `${providerCode}|${locationName}` → index
  const campuses = [];
  let duplicateCampusRows = 0;
  for (const r of rawLocations) {
    const code = String(r['CRICOS Provider Code'] ?? '').trim();
    const name = String(r['Location Name'] ?? '').trim();
    if (!code || !name) continue;
    const key = `${code}|${name}`;
    // The register lists a handful of campuses twice under one provider. The
    // pair is indistinguishable on every published field, so the second is a
    // duplicate row rather than a second site — counted, not silently absorbed.
    if (campusIdx.has(key)) { duplicateCampusRows++; continue; }
    const p = provIdx.get(code);
    if (p == null) continue;
    const pc = normPostcode(r['Postcode']);
    const geo = pc ? postcodes.get(pc) : null;
    const lines = [r['Address Line 1'], r['Address Line 2'], r['Address Line 3'], r['Address Line 4']]
      .map((s) => String(s ?? '').trim()).filter(Boolean);
    campusIdx.set(key, campuses.length);
    campuses.push({
      i: campuses.length,
      p,
      name: titleCase(name),
      t: dicts.locationTypes.of(r['Location Type']),
      addr: lines.join(', '),
      akey: addressKey(lines, r['Postcode']),
      city: titleCase(r['City']),
      state: normState(r['State']),
      pc,
      lat: geo ? geo.lat : null,
      lon: geo ? geo.lon : null,
      sa4: geo ? geo.sa4 : null,
      locality: geo ? geo.locality : null,
      courses: 0,
    });
    providers[p].campuses++;
  }

  /* ── courses ── */
  const courses = [];
  const courseIdx = new Map();
  for (const r of rawCourses) {
    const ccode = String(r['CRICOS Course Code'] ?? '').trim();
    const pcode = String(r['CRICOS Provider Code'] ?? '').trim();
    if (!ccode || !pcode) continue; // the two wholly-blank rows
    const p = provIdx.get(pcode);
    if (p == null) continue;
    const bf = splitField(r['Field of Education 1 Broad Field']);
    const nf = splitField(r['Field of Education 1 Narrow Field']);
    const weeks = int(r['Duration (Weeks)']);
    const tuition = money(r['Tuition Fee']);
    const nonTuition = money0(r['Non Tuition Fee']);
    const total = money(r['Estimated Total Course Cost']);
    const pw = perWeek(tuition, weeks);
    const expired = String(r['Expired'] ?? '').trim() === 'Yes';
    let flags = 0;
    if (String(r['Dual Qualification'] ?? '').trim() === 'Yes') flags |= F_DUAL;
    if (String(r['Work Component'] ?? '').trim() === 'Yes') flags |= F_WORK;
    if (String(r['Foundation Studies'] ?? '').trim() === 'Yes') flags |= F_FOUNDATION;
    if (expired) flags |= F_EXPIRED;
    if (isSuspect(pw)) flags |= F_SUSPECT;

    const c = {
      i: courses.length,
      code: ccode,
      p,
      name: String(r['Course Name'] ?? '').trim(),
      nat: String(r['VET National Code'] ?? '').trim(),
      level: dicts.levels.of(r['Course Level']),
      bf: dicts.broadFields.of(bf.label),
      nf: dicts.narrowFields.of(nf.label),
      lang: dicts.languages.of(r['Course Language']),
      weeks,
      tuition,
      nonTuition,
      total,
      perWeek: pw,
      flags,
      locs: [],
    };
    // The register carries exactly one genuinely duplicated course code in the
    // 2026-08 snapshot. Keep both rows (they are separate offerings) but only
    // the first claims the code in the lookup index.
    if (!courseIdx.has(ccode)) courseIdx.set(ccode, courses.length);
    courses.push(c);

    const prov = providers[p];
    prov.courses++;
    if (!expired) prov.liveCourses++;
    prov.levels[c.level] = (prov.levels[c.level] ?? 0) + 1;
    prov.fields[c.bf] = (prov.fields[c.bf] ?? 0) + 1;
  }

  /* ── course ↔ campus edges ── */
  // Keyed on (provider code, location name) because location names repeat
  // across providers — "City Campus" is held by dozens of them.
  const courseByProvCode = new Map();
  for (const c of courses) courseByProvCode.set(`${providers[c.p].code}|${c.code}`, c);
  let edges = 0;
  let orphanEdges = 0;
  for (const r of rawEdges) {
    const pcode = String(r['CRICOS Provider Code'] ?? '').trim();
    const ccode = String(r['CRICOS Course Code'] ?? '').trim();
    const lname = String(r['Location Name'] ?? '').trim();
    if (!pcode || !ccode || !lname) continue;
    const c = courseByProvCode.get(`${pcode}|${ccode}`);
    const l = campusIdx.get(`${pcode}|${lname}`);
    if (c == null || l == null) { orphanEdges++; continue; }
    c.locs.push(l);
    campuses[l].courses++;
    edges++;
  }

  /* ── per-provider campus states ── */
  for (const cam of campuses) {
    const prov = providers[cam.p];
    if (cam.state && !prov.states.includes(cam.state)) prov.states.push(cam.state);
  }
  for (const prov of providers) prov.states.sort((a, b) => STATES.indexOf(a) - STATES.indexOf(b));

  /* ── the comparison spine: nationally-identical qualifications ── */
  const natGroups = new Map();
  for (const c of courses) {
    if (!c.nat || c.perWeek == null || (c.flags & F_EXPIRED)) continue;
    if (!natGroups.has(c.nat)) natGroups.set(c.nat, []);
    natGroups.get(c.nat).push(c);
  }

  const compare = [];
  for (const [nat, group] of natGroups) {
    const providerCodes = new Set(group.map((c) => providers[c.p].code));
    // The honest population for a price distribution excludes the rows we
    // already believe are misreported — but they stay in `offers` and are drawn.
    const clean = group.filter((c) => !(c.flags & F_SUSPECT));
    const pws = clean.map((c) => c.perWeek).sort((a, b) => a - b);
    const tots = clean.map((c) => c.tuition).sort((a, b) => a - b);
    const wks = group.map((c) => c.weeks).filter((w) => w != null).sort((a, b) => a - b);
    // The most common course name wins — providers spell the same national
    // qualification a dozen ways and the code is the only reliable identity.
    const nameCounts = new Map();
    for (const c of group) nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
    const title = [...nameCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const levelCounts = new Map();
    for (const c of group) levelCounts.set(c.level, (levelCounts.get(c.level) ?? 0) + 1);
    const level = [...levelCounts].sort((a, b) => b[1] - a[1])[0][0];
    const fieldCounts = new Map();
    for (const c of group) fieldCounts.set(c.bf, (fieldCounts.get(c.bf) ?? 0) + 1);
    const bf = [...fieldCounts].sort((a, b) => b[1] - a[1])[0][0];

    compare.push({
      nat,
      title,
      level,
      bf,
      providers: providerCodes.size,
      offers: group.length,
      suspect: group.length - clean.length,
      pw: {
        min: pws.length ? pws[0] : null,
        p10: quantile(pws, 0.1),
        p25: quantile(pws, 0.25),
        med: quantile(pws, 0.5),
        p75: quantile(pws, 0.75),
        p90: quantile(pws, 0.9),
        max: pws.length ? pws[pws.length - 1] : null,
      },
      tuition: {
        min: tots.length ? tots[0] : null,
        med: quantile(tots, 0.5),
        max: tots.length ? tots[tots.length - 1] : null,
      },
      weeks: { min: wks.length ? wks[0] : null, med: quantile(wks, 0.5), max: wks.length ? wks[wks.length - 1] : null },
      rows: group.map((c) => ({
        c: c.code,
        p: c.p,
        w: c.weeks,
        t: c.tuition,
        nt: c.nonTuition,
        pw: Math.round(c.perWeek * 100) / 100,
        s: (c.flags & F_SUSPECT) ? 1 : 0,
        st: [...new Set(c.locs.map((l) => campuses[l].state).filter(Boolean))],
      })).sort((a, b) => a.pw - b.pw),
    });
  }
  compare.sort((a, b) => b.providers - a.providers || a.title.localeCompare(b.title));

  /* ── where each provider sits against its peers ── */
  // Only over qualifications with at least three providers: a percentile drawn
  // from two offerings is either 0 or 100 and says nothing at all.
  const pctByProvider = new Map();
  for (const entry of compare) {
    if (entry.providers < 3) continue;
    const clean = entry.rows.filter((r) => !r.s);
    if (clean.length < 3) continue;
    clean.forEach((r, rank) => {
      const pct = (rank / (clean.length - 1)) * 100;
      if (!pctByProvider.has(r.p)) pctByProvider.set(r.p, []);
      pctByProvider.get(r.p).push(pct);
    });
  }
  for (const [p, list] of pctByProvider) {
    providers[p].peerN = list.length;
    providers[p].peerPct = list.length >= 3 ? Math.round(quantile([...list].sort((a, b) => a - b), 0.5) * 10) / 10 : null;
  }

  /* ── per-provider price summary ── */
  const provPw = new Map();
  for (const c of courses) {
    if (c.perWeek == null || (c.flags & (F_EXPIRED | F_SUSPECT))) continue;
    if (!provPw.has(c.p)) provPw.set(c.p, []);
    provPw.get(c.p).push(c.perWeek);
  }
  for (const [p, list] of provPw) {
    list.sort((a, b) => a - b);
    providers[p].medPerWeek = Math.round(quantile(list, 0.5));
    providers[p].minPerWeek = Math.round(list[0]);
    providers[p].maxPerWeek = Math.round(list[list.length - 1]);
  }
  for (const [nat, group] of natGroups) {
    for (const p of new Set(group.map((c) => c.p))) {
      if (!providers[p].natCodes.includes(nat)) providers[p].natCodes.push(nat);
    }
  }

  /* ── field × level matrix ── */
  const matrix = new Map();
  for (const c of courses) {
    if (c.flags & F_EXPIRED) continue;
    const key = `${c.bf}|${c.level}`;
    if (!matrix.has(key)) matrix.set(key, { bf: c.bf, level: c.level, n: 0, pw: [] });
    const cell = matrix.get(key);
    cell.n++;
    if (c.perWeek != null && !(c.flags & F_SUSPECT)) cell.pw.push(c.perWeek);
  }
  const matrixOut = [...matrix.values()].map((cell) => ({
    bf: cell.bf,
    level: cell.level,
    n: cell.n,
    med: cell.pw.length ? Math.round(quantile(cell.pw.sort((a, b) => a - b), 0.5)) : null,
    priced: cell.pw.length,
  }));

  /* ── geography ── */
  const byPostcode = new Map();
  for (const cam of campuses) {
    if (!cam.pc) continue;
    if (!byPostcode.has(cam.pc)) {
      byPostcode.set(cam.pc, {
        pc: cam.pc, state: cam.state, locality: cam.locality, lat: cam.lat, lon: cam.lon,
        campuses: 0, providers: new Set(), courses: 0, pw: [],
      });
    }
    const g = byPostcode.get(cam.pc);
    g.campuses++;
    g.providers.add(cam.p);
    g.courses += cam.courses;
  }
  for (const c of courses) {
    if (c.perWeek == null || (c.flags & (F_EXPIRED | F_SUSPECT))) continue;
    for (const pc of new Set(c.locs.map((l) => campuses[l].pc).filter(Boolean))) {
      byPostcode.get(pc)?.pw.push(c.perWeek);
    }
  }
  const geoOut = [...byPostcode.values()].map((g) => ({
    pc: g.pc, state: g.state, locality: g.locality, lat: g.lat, lon: g.lon,
    campuses: g.campuses, providers: g.providers.size, courses: g.courses,
    med: g.pw.length ? Math.round(quantile(g.pw.sort((a, b) => a - b), 0.5)) : null,
  })).sort((a, b) => b.providers - a.providers);

  /* ── shared buildings ── */
  // A building only enters the graph when two DIFFERENT providers list a campus
  // at the same normalised street address. Matching is textual and deliberately
  // conservative: it misses addresses written differently and never invents a
  // match, which is the right direction to be wrong in when the output reads as
  // an allegation.
  const buildingMap = new Map();
  for (const cam of campuses) {
    if (!cam.akey) continue;
    if (!buildingMap.has(cam.akey)) {
      buildingMap.set(cam.akey, {
        key: cam.akey, addr: cam.addr, pc: cam.pc, state: cam.state,
        locality: cam.locality, lat: cam.lat, lon: cam.lon,
        providers: new Set(), campuses: 0, courses: 0, third: 0,
      });
    }
    const b = buildingMap.get(cam.akey);
    b.providers.add(cam.p);
    b.campuses++;
    b.courses += cam.courses;
    // Location types 2 and 3 are delivery under arrangement with somebody else.
    if (dicts.locationTypes.list[cam.t] !== 'Location owned and operated by provider') b.third++;
  }
  const buildings = [...buildingMap.values()]
    .filter((b) => b.providers.size >= 2)
    .map((b) => ({
      key: b.key, addr: b.addr, pc: b.pc, state: b.state, locality: b.locality,
      lat: b.lat, lon: b.lon, campuses: b.campuses, courses: b.courses, third: b.third,
      providers: [...b.providers].sort((a, c) => a - c),
    }))
    .sort((a, b) => b.providers.length - a.providers.length);

  const byState = {};
  for (const st of STATES) {
    const cams = campuses.filter((c) => c.state === st);
    const provs = new Set(cams.map((c) => c.p));
    const pws = [];
    for (const c of courses) {
      if (c.perWeek == null || (c.flags & (F_EXPIRED | F_SUSPECT))) continue;
      if (c.locs.some((l) => campuses[l].state === st)) pws.push(c.perWeek);
    }
    pws.sort((a, b) => a - b);
    byState[st] = {
      campuses: cams.length,
      providers: provs.size,
      courses: pws.length,
      med: pws.length ? Math.round(quantile(pws, 0.5)) : null,
    };
  }

  return {
    dicts: {
      levels: dicts.levels.list,
      broadFields: dicts.broadFields.list,
      narrowFields: dicts.narrowFields.list,
      locationTypes: dicts.locationTypes.list,
      languages: dicts.languages.list,
    },
    providers,
    campuses,
    courses,
    compare,
    matrix: matrixOut,
    geo: geoOut,
    buildings,
    byState,
    stats: {
      providerCount: providers.length,
      campusCount: campuses.length,
      courseCount: courses.length,
      edgeCount: edges,
      orphanEdges,
      duplicateCampusRows,
      sourceLocationRows: rawLocations.filter((r) => String(r['Location Name'] ?? '').trim()).length,
      sourceCourseRows: rawCourses.filter((r) => String(r['CRICOS Course Code'] ?? '').trim()).length,
      sourceInstitutionRows: rawInstitutions.filter((r) => String(r['CRICOS Provider Code'] ?? '').trim()).length,
      pricedCount: courses.filter((c) => c.tuition != null).length,
      // Two different numbers that are easy to confuse, so both are published:
      // how many distinct nationally coded QUALIFICATIONS exist, and how many
      // COURSES carry one of them. Printing the first as the second understates
      // the comparable share of the register by a factor of about seventeen.
      natCodeCount: natGroups.size,
      natCodedCourses: courses.filter((c) => c.nat).length,
      comparable2: compare.filter((e) => e.providers >= 2).length,
      comparable5: compare.filter((e) => e.providers >= 5).length,
      comparable10: compare.filter((e) => e.providers >= 10).length,
      suspectCount: courses.filter((c) => c.flags & F_SUSPECT).length,
      expiredCount: courses.filter((c) => c.flags & F_EXPIRED).length,
      geocodedCampuses: campuses.filter((c) => c.lat != null).length,
      sharedBuildings: buildings.length,
      providersSharing: new Set(buildings.flatMap((b) => b.providers)).size,
      thirdPartyCampuses: campuses.filter((c) => dicts.locationTypes.list[c.t] !== 'Location owned and operated by provider').length,
      privateProviders: providers.filter((p) => p.type === 'P').length,
      govProviders: providers.filter((p) => p.type === 'G').length,
    },
  };
}
