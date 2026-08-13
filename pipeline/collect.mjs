#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// collect.mjs — pull every upstream source into pipeline/.cache/.
//
// Sources, all public, all keyless, all verified working from a bare client
// with an empty User-Agent (i.e. from a GitHub Actions runner):
//   * data.gov.au CKAN package `cricos` — resolves everything else
//   * the current bulk export ZIP (4 CSVs + the field-definition PDF)
//   * 60 dated monthly snapshots, Jul 2021 → present, for the churn view
//   * ABS ASGS 2021 Postal Area boundaries (shapefile → simplified GeoJSON)
//   * matthewproctor/australianpostcodes (postcode → centroid)
//
// Downloads are cached. Snapshot DIGESTS are committed to the repository, so
// the sixty-file backfill happens exactly once and every later run fetches only
// the month that is new.

import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, parseSharedStrings, parseSheet, quantile, snapshotDate, zipEntries, money, int, perWeek, isSuspect } from './parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'pipeline', '.cache');
const SNAPS = path.join(ROOT, 'pipeline', 'snapshots');

const CKAN = 'https://data.gov.au/data/api/3/action/package_show?id=cricos';
const ABS_POA_SHP =
  'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files/POA_2021_AUST_GDA2020_SHP.zip';
const POSTCODES_REF =
  'https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.csv';

const log = (m) => process.stdout.write(`[collect] ${m}\n`);

function download(url, dest, { minBytes = 1024 } = {}) {
  if (fs.existsSync(dest) && fs.statSync(dest).size >= minBytes) {
    log(`cached  ${path.basename(dest)} (${fs.statSync(dest).size.toLocaleString()} B)`);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`fetch   ${url.slice(0, 110)}`);
  execFileSync('curl', ['-sSL', '--fail', '--retry', '4', '--retry-delay', '3', '--max-time', '600', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const size = fs.statSync(dest).size;
  if (size < minBytes) throw new Error(`${url} returned only ${size} bytes — the source has moved.`);
  log(`ok      ${path.basename(dest)} (${size.toLocaleString()} B)`);
  return dest;
}

/* ─────────────────── 1. resolve everything through CKAN ─────────────────── */

function resolvePackage() {
  const dest = path.join(CACHE, 'package.json');
  // Always re-fetch: a new monthly snapshot arrives as a NEW resource id, so a
  // cached package listing would make the pipeline permanently blind to it.
  fs.mkdirSync(CACHE, { recursive: true });
  execFileSync('curl', ['-sSL', '--fail', '--retry', '4', '--retry-delay', '3', '-o', dest, CKAN], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const pkg = JSON.parse(fs.readFileSync(dest, 'utf8')).result;

  const zip = pkg.resources.find((r) => String(r.format).toUpperCase() === 'ZIP');
  if (!zip) throw new Error('no ZIP resource on the CRICOS package — the bulk export has been withdrawn.');

  // Snapshots are selected by "the NAME contains a date", never by format.
  // Six of the sixty are published as `excel (.xlsx)` and one as `XLS`;
  // filtering on format == "XLSX" silently invents a six-month hole in 2021-22.
  const seen = new Set();
  const snapshots = [];
  for (const r of pkg.resources) {
    const date = snapshotDate(r.name);
    if (!date) continue;
    if (!/xlsx?$/i.test(r.url)) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    snapshots.push({ date, url: r.url, name: r.name, id: r.id });
  }
  snapshots.sort((a, b) => a.date.localeCompare(b.date));

  log(`package modified ${pkg.metadata_modified}, licence ${pkg.license_id}, ${snapshots.length} dated snapshots`);
  return {
    licenceId: pkg.license_id,
    licenceTitle: pkg.license_title,
    licenceUrl: pkg.license_url,
    publisher: pkg.organization?.title ?? 'Department of Education',
    modified: pkg.metadata_modified,
    landing: 'https://data.gov.au/data/dataset/cricos',
    zipUrl: zip.url,
    snapshots,
  };
}

/* ───────────────────── 2. the current bulk export ───────────────────── */

const CSV_MEMBERS = {
  courses: 'CRICOS Courses.csv',
  locations: 'CRICOS Locations.csv',
  institutions: 'CRICOS Institutions.csv',
  courseLocations: 'CRICOS Course Locations.csv',
};

function extractBulk(zipUrl) {
  const zipPath = download(zipUrl, path.join(CACHE, 'cricos.zip'), { minBytes: 500_000 });
  const entries = zipEntries(fs.readFileSync(zipPath), inflateRawSync);
  const out = {};
  for (const [key, member] of Object.entries(CSV_MEMBERS)) {
    const read = entries.get(member);
    if (!read) throw new Error(`the bulk ZIP no longer contains "${member}" — members are: ${[...entries.keys()].join(', ')}`);
    out[key] = read().toString('utf8');
    log(`unzip   ${member} (${out[key].length.toLocaleString()} B)`);
  }
  return out;
}

/* ───────────── 3. monthly snapshot digests (the churn view) ───────────── */

// Sheet names as they appear in the workbooks. Order has changed across the
// sixty files, so they are resolved by NAME out of xl/workbook.xml.
const WANT_SHEETS = ['Institutions', 'Courses', 'Locations'];

function readWorkbookSheets(buf) {
  const entries = zipEntries(buf, inflateRawSync);
  const wb = entries.get('xl/workbook.xml')?.().toString('utf8');
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.().toString('utf8');
  if (!wb || !rels) throw new Error('not an xlsx workbook');

  const relTarget = new Map();
  for (const m of rels.matchAll(/<Relationship([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }

  const sharedXml = entries.get('xl/sharedStrings.xml')?.().toString('utf8') ?? '';
  const shared = parseSharedStrings(sharedXml);

  const sheets = {};
  for (const m of wb.matchAll(/<sheet([^>]*)\/>/g)) {
    const name = /name="([^"]+)"/.exec(m[1])?.[1];
    const rid = /r:id="([^"]+)"/.exec(m[1])?.[1];
    if (!name || !rid || !WANT_SHEETS.includes(name)) continue;
    const target = relTarget.get(rid);
    const read = entries.get(`xl/${target}`);
    if (!read) continue;
    sheets[name] = parseSheet(read().toString('utf8'), shared);
  }
  return sheets;
}

/**
 * The workbooks are NOT the CSVs with a different extension.
 *
 * Each sheet opens with a title row ("Institutions") and a provenance row
 * ("Report generated Friday, 30 July 2021") before the real header. Taking
 * row 0 as the header — the obvious thing, and what the CSVs would need —
 * yields a table whose every column is named "" and whose every lookup returns
 * blank, which reads downstream as "this month the register was empty" rather
 * than as a parse failure. Find the header by looking for the key column.
 */
function rowsToObjects(rows, keyColumn) {
  const headRow = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() === keyColumn));
  if (headRow < 0) throw new Error(`no header row containing "${keyColumn}" in ${rows.length} rows`);
  const head = rows[headRow].map((h) => String(h ?? '').trim());
  return rows.slice(headRow + 1).map((r) => {
    const o = {};
    for (let j = 0; j < head.length; j++) o[head[j]] = r[j] ?? '';
    return o;
  });
}

/**
 * One month of the register, boiled down to about 30 KB.
 *
 * Committing sixty full snapshots would be 250 MB in the repository for a view
 * that only ever plots counts and medians. The digest keeps the provider CODES
 * (so entries and exits are computable exactly) and per-qualification medians
 * (so price drift is), and throws away everything else.
 */
function digestSnapshot(sheets, date) {
  const institutions = rowsToObjects(sheets.Institutions ?? [], 'CRICOS Provider Code');
  const courses = rowsToObjects(sheets.Courses ?? [], 'CRICOS Course Code');
  const locations = rowsToObjects(sheets.Locations ?? [], 'Location Name');

  const providerCodes = [...new Set(institutions
    .map((r) => String(r['CRICOS Provider Code'] ?? '').trim())
    .filter(Boolean))].sort();

  const byType = {};
  for (const r of institutions) {
    const code = String(r['CRICOS Provider Code'] ?? '').trim();
    if (!code) continue;
    const t = String(r['Institution Type'] ?? '').trim() || 'Unknown';
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const byState = {};
  for (const r of locations) {
    const st = String(r['State'] ?? '').trim().toUpperCase();
    if (!st) continue;
    byState[st] = (byState[st] ?? 0) + 1;
  }

  const byLevel = {};
  const natPw = new Map();
  let courseCount = 0;
  let pricedCount = 0;
  for (const r of courses) {
    const code = String(r['CRICOS Course Code'] ?? '').trim();
    if (!code) continue;
    courseCount++;
    const lvl = String(r['Course Level'] ?? '').trim() || 'Unknown';
    byLevel[lvl] = (byLevel[lvl] ?? 0) + 1;
    const t = money(r['Tuition Fee']);
    const w = int(r['Duration (Weeks)']);
    const pw = perWeek(t, w);
    if (t != null) pricedCount++;
    const nat = String(r['VET National Code'] ?? '').trim();
    if (!nat || pw == null || isSuspect(pw)) continue;
    if (!natPw.has(nat)) natPw.set(nat, []);
    natPw.get(nat).push(pw);
  }

  // Only qualifications with a real cross-provider market get a price series;
  // a "median" over two offerings is noise dressed as a trend.
  const nat = {};
  for (const [code, list] of natPw) {
    if (list.length < 10) continue;
    list.sort((a, b) => a - b);
    nat[code] = { n: list.length, med: Math.round(quantile(list, 0.5) * 100) / 100 };
  }

  return {
    date,
    providers: providerCodes.length,
    courses: courseCount,
    locations: locations.filter((r) => String(r['Location Name'] ?? '').trim()).length,
    priced: pricedCount,
    providerCodes,
    byType,
    byState,
    byLevel,
    nat,
  };
}

function buildSnapshots(snapshots) {
  fs.mkdirSync(SNAPS, { recursive: true });
  let built = 0;
  let failed = 0;
  for (const s of snapshots) {
    const dest = path.join(SNAPS, `${s.date}.json`);
    if (fs.existsSync(dest)) continue;
    const tmp = path.join(CACHE, `snap-${s.date}.xlsx`);
    try {
      download(s.url, tmp, { minBytes: 200_000 });
      const sheets = readWorkbookSheets(fs.readFileSync(tmp));
      if (!sheets.Courses || !sheets.Institutions) throw new Error('workbook is missing the Courses or Institutions sheet');
      const digest = digestSnapshot(sheets, s.date);
      if (digest.providers < 500 || digest.courses < 5000) {
        throw new Error(`implausible digest: ${digest.providers} providers, ${digest.courses} courses`);
      }
      fs.writeFileSync(dest, `${JSON.stringify(digest)}\n`);
      log(`digest  ${s.date} — ${digest.providers} providers, ${digest.courses.toLocaleString()} courses`);
      built++;
    } catch (err) {
      // One unreadable month must not cost the other fifty-nine. The gap is
      // recorded honestly by its ABSENCE and drawn as a gap.
      log(`SKIP    ${s.date} — ${err.message}`);
      failed++;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  log(`snapshots: ${built} new, ${failed} unreadable, ${fs.readdirSync(SNAPS).filter((f) => f.endsWith('.json')).length} on disk`);
}

/* ─────────────────────────── 4. geography ─────────────────────────── */

function buildBoundaries() {
  const geo = path.join(CACHE, 'poa.geojson');
  if (fs.existsSync(geo)) { log('cached  poa.geojson'); return geo; }
  const shpZip = download(ABS_POA_SHP, path.join(CACHE, 'poa_shp.zip'), { minBytes: 1_000_000 });
  const shpDir = path.join(CACHE, 'poa_shp');
  log('unzip   ABS POA_2021 shapefile');
  execFileSync('unzip', ['-o', '-q', shpZip, '-d', shpDir]);
  const shp = path.join(shpDir, 'POA_2021_AUST_GDA2020.shp');
  if (!fs.existsSync(shp)) throw new Error(`ABS shapefile not found at ${shp}`);
  // Never hand-author geometry, in any format. Simplify real ABS source data.
  //
  // 4%, not the 1.2% a sibling site uses. That site draws all 2,644 postcodes
  // and is read at national zoom; this one keeps only the ~770 that contain a
  // campus, and those are overwhelmingly small CBD polygons read at street
  // zoom. At 1.2% their median vertex count falls to 8 and Melbourne's CBD
  // renders as a blocky lozenge — the "map made of rectangles" failure. 4%
  // takes the median to 18 for about 165 KB gzipped.
  log('mapshaper simplify 4%');
  execFileSync('npx', ['-y', 'mapshaper', shp,
    '-filter-fields', 'POA_CODE21',
    '-simplify', '4%', 'keep-shapes',
    '-o', 'precision=0.0001', 'format=geojson', geo,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  log(`ok      poa.geojson (${fs.statSync(geo).size.toLocaleString()} B)`);
  return geo;
}

/* ──────────────────────────────  main  ────────────────────────────── */

function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const pkg = resolvePackage();
  fs.writeFileSync(path.join(CACHE, 'source.json'), JSON.stringify(pkg, null, 2));

  const csv = extractBulk(pkg.zipUrl);
  for (const [key, text] of Object.entries(csv)) {
    fs.writeFileSync(path.join(CACHE, `${key}.csv`), text);
    const rows = parseCsv(text);
    log(`parsed  ${key}: ${(rows.length - 1).toLocaleString()} rows × ${rows[0].length} cols`);
  }

  download(POSTCODES_REF, path.join(CACHE, 'postcodes_ref.csv'), { minBytes: 1_000_000 });
  buildBoundaries();
  buildSnapshots(pkg.snapshots);

  log('all sources ready');
}

main();
