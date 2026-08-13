// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The four flat tables → the model, built from a dozen hand-written rows so the
// joins, the comparison spine and the refusals can be asserted exactly.

import { describe, expect, it } from 'vitest';
import { buildModel, F_EXPIRED, F_SUSPECT, F_WORK, levelRank } from '../pipeline/model.mjs';

const institutions = [
  { 'CRICOS Provider Code': '001A', 'Institution Name': 'ALPHA COLLEGE', 'Trading Name': 'Alpha', 'Institution Type': 'Private', 'Institution Capacity': '250', Website: 'https://alpha.example', 'Postal Address City': 'MELBOURNE', 'Postal Address State': 'VIC', 'Postal Address Postcode': '3000' },
  { 'CRICOS Provider Code': '002B', 'Institution Name': 'BETA INSTITUTE', 'Trading Name': '', 'Institution Type': 'Private', 'Institution Capacity': '90', Website: '', 'Postal Address City': 'SYDNEY', 'Postal Address State': 'NSW', 'Postal Address Postcode': '2000' },
  { 'CRICOS Provider Code': '003C', 'Institution Name': 'GAMMA UNIVERSITY', 'Trading Name': '', 'Institution Type': 'Government', 'Institution Capacity': '9,000', Website: '', 'Postal Address City': 'PERTH', 'Postal Address State': 'WA', 'Postal Address Postcode': '6000' },
  // The register carries wholly blank rows; they must never become a provider.
  { 'CRICOS Provider Code': '', 'Institution Name': '', 'Trading Name': '', 'Institution Type': '' },
];

const locations = [
  { 'CRICOS Provider Code': '001A', 'Location Name': 'City Campus', 'Location Type': 'Location owned and operated by provider', 'Address Line 1': 'Level 2, 120 Spencer Street', City: 'MELBOURNE', State: 'VIC', Postcode: '3000' },
  { 'CRICOS Provider Code': '002B', 'Location Name': 'City Campus', 'Location Type': 'Arrangement with Non Registered Provider', 'Address Line 1': '120 Spencer Street, Docklands', City: 'MELBOURNE', State: 'VIC', Postcode: '3000' },
  { 'CRICOS Provider Code': '003C', 'Location Name': 'Main', 'Location Type': 'Location owned and operated by provider', 'Address Line 1': '35 Stirling Highway', City: 'PERTH', State: 'WA', Postcode: '6000' },
  // An exact duplicate under one provider: counted once, and counted.
  { 'CRICOS Provider Code': '001A', 'Location Name': 'City Campus', 'Location Type': 'Location owned and operated by provider', 'Address Line 1': 'Level 2, 120 Spencer Street', City: 'MELBOURNE', State: 'VIC', Postcode: '3000' },
];

const courses = [
  // The comparison spine: one national code, three providers, wildly different
  // durations, so per-week and whole-of-course disagree about the ordering.
  { 'CRICOS Provider Code': '001A', 'CRICOS Course Code': 'C001', 'Course Name': 'Diploma of Leadership and Management', 'VET National Code': 'BSB50420', 'Course Level': 'Diploma', 'Field of Education 1 Broad Field': '08 - Management and Commerce', 'Field of Education 1 Narrow Field': '0803 - Business and Management', 'Duration (Weeks)': '52', 'Tuition Fee': '$10,400.00', 'Non Tuition Fee': '$400.00', 'Estimated Total Course Cost': '$10,800.00', Expired: 'No', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'No', 'Foundation Studies': 'No' },
  { 'CRICOS Provider Code': '002B', 'CRICOS Course Code': 'C002', 'Course Name': 'Diploma of Leadership & Management', 'VET National Code': 'BSB50420', 'Course Level': 'Diploma', 'Field of Education 1 Broad Field': '08 - Management and Commerce', 'Field of Education 1 Narrow Field': '0803 - Business and Management', 'Duration (Weeks)': '104', 'Tuition Fee': '$15,600.00', 'Non Tuition Fee': '$0.00', 'Estimated Total Course Cost': '$15,600.00', Expired: 'No', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'Yes', 'Foundation Studies': 'No' },
  { 'CRICOS Provider Code': '003C', 'CRICOS Course Code': 'C003', 'Course Name': 'Diploma of Leadership and Management', 'VET National Code': 'BSB50420', 'Course Level': 'Diploma', 'Field of Education 1 Broad Field': '08 - Management and Commerce', 'Field of Education 1 Narrow Field': '0803 - Business and Management', 'Duration (Weeks)': '26', 'Tuition Fee': '$10,400.00', 'Non Tuition Fee': '$0.00', 'Estimated Total Course Cost': '$10,400.00', Expired: 'No', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'No', 'Foundation Studies': 'No' },
  // A deposit typed into the whole-of-course field: $1,600 over 104 weeks.
  { 'CRICOS Provider Code': '002B', 'CRICOS Course Code': 'C004', 'Course Name': 'Diploma of Leadership and Management', 'VET National Code': 'BSB50420', 'Course Level': 'Diploma', 'Field of Education 1 Broad Field': '08 - Management and Commerce', 'Field of Education 1 Narrow Field': '0803 - Business and Management', 'Duration (Weeks)': '104', 'Tuition Fee': '$1,600.00', 'Non Tuition Fee': '$0.00', 'Estimated Total Course Cost': '$1,600.00', Expired: 'No', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'No', 'Foundation Studies': 'No' },
  // An expired registration, and an uncoded degree with no peer group.
  { 'CRICOS Provider Code': '001A', 'CRICOS Course Code': 'C005', 'Course Name': 'Certificate III in Cookery', 'VET National Code': 'SIT30821', 'Course Level': 'Certificate III', 'Field of Education 1 Broad Field': '11 - Food, Hospitality and Personal Services', 'Field of Education 1 Narrow Field': '1101 - Food and Hospitality', 'Duration (Weeks)': '52', 'Tuition Fee': '$14,000.00', 'Non Tuition Fee': '$0.00', 'Estimated Total Course Cost': '$14,000.00', Expired: 'Yes', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'No', 'Foundation Studies': 'No' },
  { 'CRICOS Provider Code': '003C', 'CRICOS Course Code': 'C006', 'Course Name': 'Bachelor of Science', 'VET National Code': '', 'Course Level': 'Bachelor Degree', 'Field of Education 1 Broad Field': '01 - Natural and Physical Sciences', 'Field of Education 1 Narrow Field': '0101 - Natural Sciences', 'Duration (Weeks)': '156', 'Tuition Fee': '$120,000.00', 'Non Tuition Fee': '$0.00', 'Estimated Total Course Cost': '$120,000.00', Expired: 'No', 'Course Language': 'English', 'Dual Qualification': 'No', 'Work Component': 'No', 'Foundation Studies': 'No' },
  { 'CRICOS Provider Code': '', 'CRICOS Course Code': '', 'Course Name': '', 'Course Level': '' },
];

const courseLocations = [
  { 'CRICOS Provider Code': '001A', 'CRICOS Course Code': 'C001', 'Location Name': 'City Campus' },
  { 'CRICOS Provider Code': '002B', 'CRICOS Course Code': 'C002', 'Location Name': 'City Campus' },
  { 'CRICOS Provider Code': '002B', 'CRICOS Course Code': 'C004', 'Location Name': 'City Campus' },
  { 'CRICOS Provider Code': '003C', 'CRICOS Course Code': 'C003', 'Location Name': 'Main' },
  { 'CRICOS Provider Code': '003C', 'CRICOS Course Code': 'C006', 'Location Name': 'Main' },
  { 'CRICOS Provider Code': '001A', 'CRICOS Course Code': 'C005', 'Location Name': 'City Campus' },
  // An edge pointing at a campus that does not exist — must be counted, not crash.
  { 'CRICOS Provider Code': '001A', 'CRICOS Course Code': 'C001', 'Location Name': 'Ghost Campus' },
];

const postcodes = new Map([
  ['3000', { lat: -37.81, lon: 144.96, locality: 'MELBOURNE', state: 'VIC', sa4: 'Melbourne - Inner' }],
  ['6000', { lat: -31.95, lon: 115.86, locality: 'PERTH', state: 'WA', sa4: 'Perth - Inner' }],
]);

const model = buildModel({ courses, locations, institutions, courseLocations, postcodes });

describe('the blank rows', () => {
  it('never become a provider or a course', () => {
    expect(model.providers).toHaveLength(3);
    expect(model.courses).toHaveLength(6);
  });
});

describe('joins', () => {
  it('resolves every real edge and counts the orphan rather than crashing on it', () => {
    expect(model.stats.edgeCount).toBe(6);
    expect(model.stats.orphanEdges).toBe(1);
  });
  it('counts a duplicated campus row once, and records that it did', () => {
    expect(model.campuses).toHaveLength(3);
    expect(model.stats.duplicateCampusRows).toBe(1);
  });
  it('geocodes from the postcode reference and reports what it could not place', () => {
    expect(model.stats.geocodedCampuses).toBe(3);
    expect(model.campuses[0].lat).toBeCloseTo(-37.81);
  });
});

describe('the comparison spine', () => {
  const bsb = model.compare.find((c) => c.nat === 'BSB50420')!;

  it('groups only the identical national code', () => {
    expect(bsb.offers).toBe(4);
    expect(bsb.providers).toBe(3);
    expect(bsb.rows.every((r) => r.pw > 0)).toBe(true);
  });

  it('picks the most common spelling of the qualification as its title', () => {
    expect(bsb.title).toBe('Diploma of Leadership and Management');
  });

  it('EXCLUDES the suspected-misreporting row from the quantiles but keeps it in the rows', () => {
    // The $1,600/104wk row is $15/wk. Leaving it in the percentiles would drag
    // the 10th percentile of a real market down to a typo.
    expect(bsb.suspect).toBe(1);
    expect(bsb.rows.filter((r) => r.s === 1)).toHaveLength(1);
    expect(bsb.pw.min!).toBeGreaterThan(60);
  });

  it('orders its quantiles', () => {
    const q = [bsb.pw.min!, bsb.pw.p10!, bsb.pw.p25!, bsb.pw.med!, bsb.pw.p75!, bsb.pw.p90!, bsb.pw.max!];
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeGreaterThanOrEqual(q[i - 1] - 1e-9);
  });

  it('sorts offerings cheapest-per-week first, NOT cheapest-total first', () => {
    // C001 and C003 have the identical $10,400 total; C003 runs half as long, so
    // per week it is twice the price. A total-based sort would tie them.
    const codes = bsb.rows.filter((r) => !r.s).map((r) => r.c);
    expect(codes[0]).toBe('C002'); // $150/wk
    expect(codes[codes.length - 1]).toBe('C003'); // $400/wk
  });

  it('excludes expired registrations from the spine', () => {
    expect(model.compare.find((c) => c.nat === 'SIT30821')).toBeUndefined();
  });
});

describe('flags', () => {
  it('marks work components, expiry and suspicion independently', () => {
    const byCode = new Map(model.courses.map((c) => [c.code, c]));
    expect(byCode.get('C002')!.flags & F_WORK).toBeTruthy();
    expect(byCode.get('C005')!.flags & F_EXPIRED).toBeTruthy();
    expect(byCode.get('C004')!.flags & F_SUSPECT).toBeTruthy();
    expect(byCode.get('C001')!.flags & F_SUSPECT).toBeFalsy();
  });
});

describe('shared buildings', () => {
  it('joins two providers who filed the same address differently', () => {
    // "Level 2, 120 Spencer Street" and "120 Spencer Street, Docklands".
    expect(model.buildings).toHaveLength(1);
    expect(model.buildings[0].providers).toHaveLength(2);
  });
  it('records that one of the campuses there is a third-party arrangement', () => {
    expect(model.buildings[0].third).toBe(1);
  });
  it('never lists a building with only one provider', () => {
    expect(model.buildings.every((b) => new Set(b.providers).size >= 2)).toBe(true);
  });
});

describe('provider summaries', () => {
  it('reports live courses separately from all courses', () => {
    const alpha = model.providers.find((p) => p.code === '001A')!;
    expect(alpha.courses).toBe(2);
    expect(alpha.liveCourses).toBe(1); // C005 is expired
  });
  it('never computes a peer percentile from too few peers', () => {
    // Every provider here sells at most one comparable course, which is below
    // the three needed to characterise how it prices.
    expect(model.providers.every((p) => p.peerPct === null)).toBe(true);
  });
  it('excludes suspected misreporting from a provider\'s own median', () => {
    const beta = model.providers.find((p) => p.code === '002B')!;
    expect(beta.medPerWeek).toBe(150); // C002 only; C004 is flagged out
  });
});

describe('aggregates', () => {
  it('builds a field × level matrix that only counts live courses', () => {
    const total = model.matrix.reduce((n, c) => n + c.n, 0);
    expect(total).toBe(5); // six courses, one expired
  });
  it('summarises geography by postcode', () => {
    const melb = model.geo.find((g) => g.pc === '3000')!;
    expect(melb.providers).toBe(2);
    expect(melb.campuses).toBe(2);
  });
  it('counts government and private providers', () => {
    expect(model.stats.privateProviders).toBe(2);
    expect(model.stats.govProviders).toBe(1);
  });
});

describe('levelRank', () => {
  it('orders the AQF ladder, not the alphabet', () => {
    expect(levelRank('Certificate III')).toBeLessThan(levelRank('Diploma'));
    expect(levelRank('Diploma')).toBeLessThan(levelRank('Bachelor Degree'));
    expect(levelRank('Bachelor Degree')).toBeLessThan(levelRank('Doctoral Degree'));
  });
  it('sorts an unknown level to the end rather than dropping it', () => {
    expect(levelRank('Something New')).toBeGreaterThanOrEqual(levelRank('Doctoral Degree'));
  });
});
