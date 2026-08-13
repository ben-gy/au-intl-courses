// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The pipeline's pure parsing layer, exercised on the exact shapes the register
// actually contains — quoted commas, blank rows, sub-premise addresses, and the
// two workbook quirks that made sixty months of history look empty.

import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import {
  addressKey, colIndex, int, money, money0, monthRange, normPostcode, normState,
  parseCsv, parseSharedStrings, parseSheet, perWeek, quantile, snapshotDate, splitField,
  titleCase, toObjects, unescapeXml, zipEntries, isSuspect, SUSPECT_PER_WEEK,
} from '../pipeline/parse.mjs';

describe('parseCsv — the quoted-comma trap', () => {
  it('keeps a comma inside a quoted field with its field', () => {
    // This is THE failure mode. Splitting on commas moves the suburb into the
    // postcode column, and the resulting state counts still look plausible.
    const rows = parseCsv('code,name,city,postcode\n00001K,"Level 2, 120 Spencer Street",Melbourne,3000\n');
    expect(rows[1]).toEqual(['00001K', 'Level 2, 120 Spencer Street', 'Melbourne', '3000']);
  });

  it('survives escaped quotes inside a quoted field', () => {
    const rows = parseCsv('a,b\n1,"He said ""hello"", loudly"\n');
    expect(rows[1][1]).toBe('He said "hello", loudly');
  });

  it('handles a newline inside a quoted field', () => {
    const rows = parseCsv('a,b\n1,"line one\nline two"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('line one\nline two');
  });

  it('strips the UTF-8 BOM the export ships with', () => {
    const rows = parseCsv('﻿code,name\n1,x\n');
    expect(rows[0][0]).toBe('code');
  });

  it('handles CRLF, a trailing empty field and no trailing newline', () => {
    const rows = parseCsv('a,b,c\r\n1,,3');
    expect(rows[1]).toEqual(['1', '', '3']);
  });

  it('returns nothing for empty input rather than throwing', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('toObjects', () => {
  it('drops a row of the wrong width instead of shifting its columns', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5\n6,7,8\n');
    expect(toObjects(rows)).toEqual([{ a: '1', b: '2', c: '3' }, { a: '6', b: '7', c: '8' }]);
  });
  it('is empty for a header-only file', () => {
    expect(toObjects(parseCsv('a,b\n'))).toEqual([]);
  });
});

describe('money', () => {
  it('parses the register\'s dollar formatting', () => {
    expect(money('$13,300.00')).toBe(13300);
    expect(money('20400')).toBe(20400);
  });
  it('treats blank, zero and rubbish as no price, not as free', () => {
    expect(money('')).toBeNull();
    expect(money('$0.00')).toBeNull();
    expect(money('n/a')).toBeNull();
    expect(money(undefined)).toBeNull();
  });
  it('money0 keeps a genuine zero, because non-tuition fees often are', () => {
    expect(money0('$0.00')).toBe(0);
    expect(money0('')).toBeNull();
  });
  it('int parses a thousands-separated capacity', () => {
    expect(int('2,610')).toBe(2610);
    expect(int('')).toBeNull();
  });
});

describe('perWeek — the central normalisation', () => {
  it('divides tuition by that row\'s own duration', () => {
    expect(perWeek(20800, 104)).toBe(200);
  });
  it('refuses a zero, negative or missing duration rather than returning Infinity', () => {
    expect(perWeek(20800, 0)).toBeNull();
    expect(perWeek(20800, -4)).toBeNull();
    expect(perWeek(20800, null)).toBeNull();
    expect(perWeek(null, 104)).toBeNull();
  });

  it('reorders the SAME courses when the unit changes — the reason per week is the default', () => {
    // Two real shapes from BSB80120: a long cheap course and a short dear one.
    const a = { total: 18000, weeks: 130 }; // $138/wk
    const b = { total: 12000, weeks: 31 };  // $387/wk
    expect(a.total).toBeGreaterThan(b.total);          // a "costs more"…
    expect(perWeek(a.total, a.weeks)!).toBeLessThan(perWeek(b.total, b.weeks)!); // …and is far cheaper
  });
});

describe('the suspected-misreporting threshold', () => {
  it('flags a deposit typed into the whole-of-course field', () => {
    // $1,600 over 104 weeks = $15.38/wk.
    expect(isSuspect(perWeek(1600, 104))).toBe(true);
  });
  it('does NOT flag genuinely cheap VET at the bottom of the real distribution', () => {
    expect(isSuspect(120)).toBe(false);
    expect(isSuspect(SUSPECT_PER_WEEK)).toBe(false);
    expect(isSuspect(SUSPECT_PER_WEEK - 0.01)).toBe(true);
  });
  it('never flags a missing price', () => {
    expect(isSuspect(null)).toBe(false);
  });
});

describe('quantile', () => {
  it('interpolates between neighbours', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('returns the ends exactly', () => {
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });
  it('returns null for an empty array rather than NaN — a NaN becomes cx="NaN" and the mark vanishes', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
  it('handles a single value', () => {
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe('addressKey — conservative by construction', () => {
  it('joins the same building written with and without a sub-premise', () => {
    expect(addressKey(['Level 2, 120 Spencer Street'], '3000'))
      .toBe(addressKey(['120 Spencer Street'], '3000'));
  });
  it('joins across a differing suburb suffix and an abbreviated street type', () => {
    expect(addressKey(['Suite 4', '120 Spencer St'], '3000'))
      .toBe(addressKey(['120 Spencer Street, Docklands'], '3000'));
  });

  // The risk in an address matcher is not that it MISSES — it is that it merges
  // two different buildings and publishes a co-location that does not exist.
  it('never joins different street numbers', () => {
    expect(addressKey(['120 Spencer Street'], '3000')).not.toBe(addressKey(['122 Spencer Street'], '3000'));
  });
  it('never joins across postcodes', () => {
    expect(addressKey(['120 Spencer Street'], '3000')).not.toBe(addressKey(['120 Spencer Street'], '2000'));
  });
  it('never joins King Street to Queen Street, or Street to Road', () => {
    expect(addressKey(['120 King Street'], '3000')).not.toBe(addressKey(['120 Queen Street'], '3000'));
    expect(addressKey(['55 King Street'], '3000')).not.toBe(addressKey(['55 King Road'], '3000'));
  });
  it('refuses an address with no street number at all', () => {
    expect(addressKey(['Level 2'], '3000')).toBeNull();
    expect(addressKey(['Ground Floor'], '3000')).toBeNull();
  });
  it('refuses an unusable postcode', () => {
    expect(addressKey(['120 Spencer Street'], '')).toBeNull();
    expect(addressKey(['120 Spencer Street'], 'MEL')).toBeNull();
  });
});

describe('normPostcode and normState', () => {
  it('pads a three-digit Northern Territory postcode', () => {
    expect(normPostcode('800')).toBe('0800');
    expect(normPostcode('3000')).toBe('3000');
  });
  it('rejects anything that is not a postcode — the parse tripwire', () => {
    expect(normPostcode('Melbourne')).toBeNull();
    expect(normPostcode('')).toBeNull();
    expect(normPostcode('30000')).toBeNull();
  });
  it('normalises state casing and rejects the rest', () => {
    expect(normState('Vic')).toBe('VIC');
    expect(normState(' nsw ')).toBe('NSW');
    expect(normState('EXT')).toBeNull();
  });
});

describe('splitField and titleCase', () => {
  it('splits the ASCED code from its label', () => {
    expect(splitField('08 - Management and Commerce')).toEqual({ code: '08', label: 'Management and Commerce' });
  });
  it('leaves an uncoded label alone', () => {
    expect(splitField('Something')).toEqual({ code: '', label: 'Something' });
  });
  it('title-cases a SHOUTED name but keeps acronyms and small words', () => {
    expect(titleCase('MELBOURNE INSTITUTE OF TAFE')).toBe('Melbourne Institute of TAFE');
  });
  it('leaves an already mixed-case name untouched', () => {
    expect(titleCase('RMIT University')).toBe('RMIT University');
  });
});

describe('snapshotDate — the sixty-month history', () => {
  it('reads the date out of the resource NAME', () => {
    expect(snapshotDate('2026-07-01 CRICOS Providers, Courses and Location.xlsx')).toBe('2026-07-01');
    expect(snapshotDate('2021-9-30 CRICOS Providers, Courses and Locations.xlsx')).toBe('2021-09-30');
  });
  it('returns null for a resource with no date', () => {
    expect(snapshotDate('CRICOS Courses.csv')).toBeNull();
    expect(snapshotDate(undefined)).toBeNull();
  });
  it('rejects an impossible month', () => {
    expect(snapshotDate('2021-13-01 something')).toBeNull();
  });
});

describe('monthRange', () => {
  it('enumerates every month inclusive, across a year boundary', () => {
    expect(monthRange('2021-11', '2022-02')).toEqual(['2021-11', '2021-12', '2022-01', '2022-02']);
  });
  it('handles a single month', () => {
    expect(monthRange('2024-06', '2024-06')).toEqual(['2024-06']);
  });
});

describe('the xlsx reader', () => {
  it('unescapes XML entities including numeric ones', () => {
    expect(unescapeXml('Fees &amp; charges &#8212; 2026')).toBe('Fees & charges — 2026');
  });

  it('reads a shared-string table, joining rich-text runs', () => {
    const xml = '<sst><si><t>Plain</t></si><si><r><t>Rich </t></r><r><t>text</t></r></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Plain', 'Rich text']);
  });

  it('converts a column reference to an index', () => {
    expect(colIndex('A1')).toBe(0);
    expect(colIndex('Z9')).toBe(25);
    expect(colIndex('AA1')).toBe(26);
    expect(colIndex('BC12')).toBe(54);
  });

  it('places cells by their OWN reference, so a blank cell does not shift the row', () => {
    // The register's workbooks omit empty cells entirely. Reading them in
    // document order would move every later value one column left — which for
    // this data moves the tuition fee into the duration column.
    const sheet = '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
      + '</sheetData></worksheet>';
    const rows = parseSheet(sheet, ['first', 'third']);
    expect(rows[0]).toEqual(['first', '', 'third']);
  });

  it('reads inline strings and raw numbers', () => {
    const sheet = '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="B1"><v>42</v></c></row>'
      + '</sheetData></worksheet>';
    expect(parseSheet(sheet, [])[0]).toEqual(['Hello', '42']);
  });
});

describe('zipEntries', () => {
  it('reads a stored (uncompressed) member back byte for byte', () => {
    expect([...zipEntries(makeZip('hello.txt', Buffer.from('hi there')), inflateRawSync).keys()])
      .toEqual(['hello.txt']);
    const entries = zipEntries(makeZip('hello.txt', Buffer.from('hi there')), inflateRawSync);
    expect(entries.get('hello.txt')!().toString('utf8')).toBe('hi there');
  });

  it('throws a legible error on something that is not a zip', () => {
    expect(() => zipEntries(Buffer.alloc(64), inflateRawSync)).toThrow(/not a zip file/);
  });
});

/** A minimal single-member STORED zip, so the reader is tested without a fixture file. */
function makeZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt32LE(0, 14); // crc, unchecked by the reader
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt32LE(0, 42);

  const localBlock = Buffer.concat([local, nameBuf, data]);
  const centralBlock = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}
