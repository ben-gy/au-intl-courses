// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every pure function the pipeline needs, in one dependency-free module.
//
// This file is dependency-free ON PURPOSE. The test suite imports it directly,
// and a pipeline whose parsing logic can only be exercised by running the whole
// download is a pipeline whose parsing logic is never tested — a lesson this
// fleet has already paid for twice.
//
// Nothing here touches the network or the filesystem.

/* ────────────────────────────── CSV ────────────────────────────── */

/**
 * A real RFC 4180 parser, and it is not optional.
 *
 * "CRICOS Locations.csv" carries embedded commas inside quoted name and address
 * fields — `"Level 2, 120 Spencer Street"`. Splitting on commas shifts every
 * later column on those rows, which silently moves the postcode out of the
 * postcode column. The resulting state counts still look completely plausible;
 * they are simply wrong by around ten per cent. That is the exact failure that
 * produced an 89% undercount on a sibling site, so the postcode column is
 * gated at 100% numeric downstream precisely to catch a regression here.
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 BOM
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Rows → objects keyed by the header, dropping any row of the wrong width. */
export function toObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length === head.length)
    .map((r) => {
      const o = {};
      for (let j = 0; j < head.length; j++) o[head[j]] = r[j];
      return o;
    });
}

/* ───────────────────────────── numbers ───────────────────────────── */

/** `"$13,300.00"` → 13300. Blank, zero and unparseable all become null. */
export function money(s) {
  const n = Number(String(s ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Like `money`, but a genuine zero is a value — non-tuition fees often are 0.
 *
 * The blank guard is load-bearing: `Number('')` is 0, not NaN, so without it an
 * unrecorded fee becomes a recorded fee of nothing, and "this course has no
 * non-tuition charges" gets printed where the register actually said nothing at
 * all.
 */
export function money0(s) {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Same blank guard, same reason: an unrecorded duration is not a duration of 0. */
export function int(s) {
  const t = String(s ?? '').replace(/[,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Linear-interpolated quantile over an array sorted ascending.
 * Returns null for an empty array rather than NaN — a NaN reaches the SVG as
 * `cx="NaN"` and the mark simply vanishes with no error anywhere.
 */
export function quantile(sorted, f) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, f));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/* ─────────────────────── the comparison itself ─────────────────────── */

/**
 * THE central normalisation of this whole site.
 *
 * Whole-of-course tuition is not comparable across providers, because the same
 * nationally-identical qualification is delivered over wildly different course
 * lengths — BSB80120 runs anywhere from 31 to 130 weeks. Ranking on the sticker
 * price therefore ranks course LENGTH as much as price, and produces a headline
 * ("29x for the same piece of paper") that is arithmetically true and
 * substantively false. Dollars per week is the honest default; the sticker price
 * stays one toggle away and is always labelled.
 */
export function perWeek(tuition, weeks) {
  if (tuition == null || weeks == null || !(weeks > 0)) return null;
  return tuition / weeks;
}

/**
 * Prices too low to be real.
 *
 * A $1,600 fee across 104 weeks is $15/week — roughly a fifteenth of the
 * cheapest plausible offering of the same qualification, and almost certainly a
 * provider entering an instalment or a deposit into the whole-of-course field.
 * These rows are NEVER deleted (deleting an inconvenient row is how a dataset
 * becomes a story) and never allowed to win a "cheapest provider" ranking. They
 * are drawn differently and labelled.
 */
// Kept identical to SUSPECT_PER_WEEK in src/scales.ts, and a hygiene test
// asserts they have not drifted apart. Two thresholds would mean the pipeline
// excluded one set of rows from its medians while the interface flagged
// another, and every percentile on the site would be quietly wrong.
export const SUSPECT_PER_WEEK = 60;

export function isSuspect(perWk) {
  return perWk != null && perWk < SUSPECT_PER_WEEK;
}

/* ──────────────────────────── tidying ──────────────────────────── */

/** `"08 - Management and Commerce"` → `{ code: '08', label: 'Management and Commerce' }`. */
export function splitField(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(\d+)\s*-\s*(.+)$/.exec(s);
  if (m) return { code: m[1], label: m[2].trim() };
  return { code: '', label: s };
}

export function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Postcodes arrive as `"3000"` and occasionally as `"800"`; both are real. */
export function normPostcode(s) {
  const t = String(s ?? '').trim();
  return /^\d{3,4}$/.test(t) ? t.padStart(4, '0') : null;
}

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export function normState(s) {
  const t = String(s ?? '').trim().toUpperCase();
  return STATES.includes(t) ? t : null;
}

export { STATES };

/**
 * Title Case for a SHOUTED or inconsistently-cased proper name, preserving the
 * small words and the acronyms that a naive `toLowerCase` would ruin.
 */
const SMALL = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'on', 'to', 'a', 'an', 'de', 'von']);
const KEEP = new Set(['TAFE', 'RMIT', 'QUT', 'UNSW', 'UTS', 'ANU', 'UWA', 'CQU', 'ACU', 'AIT', 'ICT', 'IT', 'AU', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'CIT', 'AMC', 'JMC', 'SAE', 'IELTS', 'ELICOS', 'MBA', 'PTY', 'LTD']);

export function titleCase(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Leave anything already mixed-case alone — it is almost certainly correct.
  if (s !== s.toUpperCase()) return s;
  return s.split(/(\s+|[-/])/).map((tok, i) => {
    if (/^\s+$/.test(tok) || tok === '-' || tok === '/') return tok;
    const bare = tok.replace(/[^A-Za-z]/g, '');
    if (KEEP.has(bare)) return tok;
    const lower = tok.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.replace(/^[a-z]/, (c) => c.toUpperCase());
  }).join('');
}

/* ───────────────────────── address matching ───────────────────────── */

const STREET_TYPES = new Map(Object.entries({
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue', pde: 'parade',
  hwy: 'highway', hwe: 'highway', cres: 'crescent', cr: 'crescent', ct: 'court', cl: 'close',
  dr: 'drive', drv: 'drive', pl: 'place', tce: 'terrace', ter: 'terrace', bvd: 'boulevard',
  blvd: 'boulevard', esp: 'esplanade', ln: 'lane', sq: 'square', cct: 'circuit', wy: 'way',
  n: 'north', s: 'south', e: 'east', w: 'west', nth: 'north', sth: 'south', est: 'east', wst: 'west',
}));

// The expanded street types, plus the ones already written in full. An address
// is truncated at the first of these, so a differing suburb suffix cannot stop
// two records at one address from matching.
const STREET_TYPE_WORDS = new Set([
  ...STREET_TYPES.values(),
  'street', 'road', 'avenue', 'parade', 'highway', 'crescent', 'court', 'close', 'drive',
  'place', 'terrace', 'boulevard', 'esplanade', 'lane', 'square', 'circuit', 'way', 'walk',
  'mall', 'arcade', 'quay', 'grove', 'rise', 'loop', 'link', 'promenade', 'concourse',
]);

// Sub-premise prefixes. "Level 2, 120 Spencer Street" and "120 Spencer Street"
// are the same building, and a colocation graph that treats them as two
// buildings finds nothing. Everything up to and including the last sub-premise
// token is dropped.
const SUBPREMISE = /^(?:level|lvl|l|suite|ste|unit|shop|floor|fl|office|room|rm|tower|building|bldg|podium|ground)\b[\s.]*[a-z0-9-]*[\s,]*/;

/**
 * A conservative key for "these two campuses are in the same building".
 *
 * Textual matching only — it will MISS pairs written differently ("120 Spencer
 * St" vs "120 Spencer Street, Docklands") and it will never invent one. The
 * interface says so, because a co-location graph is read as an allegation and
 * must under-claim rather than over-claim.
 */
export function addressKey(lines, postcode) {
  const pc = normPostcode(postcode);
  if (!pc) return null;
  let s = lines.filter(Boolean).join(' ').toLowerCase();
  s = s.replace(/[.,/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip repeated sub-premise prefixes ("Level 2 Suite 4 120 Spencer Street").
  let before;
  do { before = s; s = s.replace(SUBPREMISE, '').trim(); } while (s !== before && s);
  // Drop a leading unit range or letter ("12-14 ", "a/", "3 ") ONLY when what
  // follows still starts with a street number — otherwise the street number
  // itself would be eaten.
  s = s.replace(/^\d+[a-z]?\s*[-–]\s*(?=\d+[a-z]?\s+\d)/, '');
  const tokens = s.split(' ').filter(Boolean).map((t) => STREET_TYPES.get(t) ?? t);
  if (!tokens.length) return null;
  const numIdx = tokens.findIndex((t) => /^\d/.test(t));
  if (numIdx < 0) return null; // no street number — too weak to assert a match
  // Truncate at the street TYPE, inclusive. One provider writes "120 Spencer
  // Street" and the one upstairs writes "120 Spencer Street, Docklands"; a
  // fixed token window keeps the suburb on one and not the other and the two
  // never match. Truncating on "street" is also what keeps "55 King Street"
  // and "55 King Road" apart, which a shorter fixed window would merge.
  const tail = tokens.slice(numIdx);
  const typeAt = tail.findIndex((t, i) => i > 0 && STREET_TYPE_WORDS.has(t));
  const core = (typeAt > 0 ? tail.slice(0, typeAt + 1) : tail.slice(0, 4)).join(' ');
  if (core.replace(/[^a-z]/g, '').length < 3) return null;
  return `${pc}|${core}`;
}

/* ─────────────────────────── zip reading ─────────────────────────── */

/**
 * A minimal ZIP central-directory reader.
 *
 * Both the bulk CSV export and every monthly XLSX snapshot are ZIP containers,
 * and shelling out to `unzip` makes the pipeline depend on a binary that is
 * present on this laptop and merely probably present on a runner. Reading the
 * central directory ourselves is forty lines and removes the question.
 *
 * `inflate` is injected so this module stays free of even node: imports and can
 * be exercised from a test without one.
 */
export function zipEntries(buf, inflateRaw) {
  // End of central directory: scan backwards for the signature. The comment
  // field is at most 65,535 bytes, so the search window is bounded.
  const MAX_COMMENT = 0xffff;
  let eocd = -1;
  const start = Math.max(0, buf.length - MAX_COMMENT - 22);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file — no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // The local header repeats the name/extra lengths, and its extra field is
    // frequently a DIFFERENT length from the central one. Read it, never assume.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataOff, dataOff + compSize);
    out.set(name, () => (method === 0 ? raw : inflateRaw(raw)));
  }
  return out;
}

/* ─────────────────────────── xlsx reading ─────────────────────────── */

const XML_ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENT[e] ?? m;
  });
}

/** `xl/sharedStrings.xml` → a plain array of strings, in index order. */
export function parseSharedStrings(xml) {
  const out = [];
  // Each <si> may hold one <t>, or several inside <r> runs — concatenate them.
  for (const si of xml.split('<si>').slice(1)) {
    const end = si.indexOf('</si>');
    const body = end >= 0 ? si.slice(0, end) : si;
    let s = '';
    for (const m of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += m[1];
    out.push(unescapeXml(s));
  }
  return out;
}

/** `"BC12"` → 54 (0-based column index). */
export function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * A worksheet XML → rows of strings.
 *
 * Cells are addressed, not positional: an empty cell is simply absent from the
 * XML. Reading cells in document order and pushing them into an array shifts
 * every value after the first blank into the wrong column — which for this
 * dataset would silently move tuition fees into the duration column. Every cell
 * is therefore placed by its own `r` attribute.
 */
export function parseSheet(xml, shared) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? '';
      const body = c[2] ?? '';
      const ref = /\sr="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\st="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += t[1];
        value = unescapeXml(value);
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        value = type === 's' ? (shared[Number(v)] ?? '') : unescapeXml(v);
      }
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/* ──────────────────── snapshot date from the NAME ──────────────────── */

/**
 * The resource FILENAMES are inconsistent across the sixty monthly snapshots —
 * some carry a timestamp, one has `.xlsx.xlsx`, one is served with format
 * `XLS`. The resource NAMES all begin with an ISO-ish date. Parse the name.
 *
 * Filtering these resources by `format == "XLSX"` (the obvious thing to do)
 * drops six months of 2021-22 that are published as `excel (.xlsx)` and one as
 * `XLS`, and invents a six-month hole in the register's history that never
 * happened. Select by "does the name contain a date" instead.
 */
export function snapshotDate(name) {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(name ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y); const month = Number(mo); const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Every calendar month between two `YYYY-MM` keys, inclusive. */
export function monthRange(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
