// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

export const F_DUAL = 1;
export const F_WORK = 2;
export const F_FOUNDATION = 4;
export const F_EXPIRED = 8;
export const F_SUSPECT = 16;

export interface Meta {
  asAt: string;
  generated: string;
  snapshotMonths: number;
  firstMonth: string | null;
  lastMonth: string | null;
  gaps: string[];
  counts: {
    providerCount: number; campusCount: number; courseCount: number; edgeCount: number;
    orphanEdges: number; duplicateCampusRows: number;
    sourceLocationRows: number; sourceCourseRows: number; sourceInstitutionRows: number;
    pricedCount: number; natCodeCount: number; natCodedCourses: number;
    comparable2: number; comparable5: number; comparable10: number;
    suspectCount: number; expiredCount: number; geocodedCampuses: number;
    sharedBuildings: number; providersSharing: number; thirdPartyCampuses: number;
    privateProviders: number; govProviders: number;
  };
  boundaries: { matched: number; wanted: number };
  priceQuantiles: { p1: number; p10: number; p50: number; p90: number; p99: number; max: number; n: number };
  headline: {
    nat: string; title: string; providers: number;
    p10: number; med: number; p90: number;
    minWeeks: number; maxWeeks: number; ratio: number;
  } | null;
  source: {
    name: string; publisher: string; landing: string;
    licence: string; licenceUrl: string; modified: string; register: string;
  };
}

export interface Provider {
  i: number; code: string; name: string; trading: string; slug: string;
  type: 'P' | 'G' | '';
  capacity: number | null; website: string; city: string; state: string | null;
  courses: number; live: number; campuses: number; states: string[];
  levels: Record<string, number>; fields: Record<string, number>;
  med: number | null; min: number | null; max: number | null;
  peerPct: number | null; peerN: number; nat: string[];
}

export interface Dicts {
  levels: string[]; broadFields: string[]; narrowFields: string[];
  locationTypes: string[]; languages: string[];
}

export interface ProvidersPayload {
  dicts: Dicts;
  levelOrder: number[];
  vetLevels: number[];
  byState: Record<string, { campuses: number; providers: number; courses: number; med: number | null }>;
  providers: Provider[];
}

export interface Campus {
  i: number; p: number; name: string; t: number; addr: string;
  city: string; state: string | null; pc: string | null;
  lat: number | null; lon: number | null; locality: string | null;
  courses: number; b: string | null;
}

export interface Building {
  key: string; addr: string; pc: string | null; state: string | null; locality: string | null;
  lat: number | null; lon: number | null;
  campuses: number; courses: number; third: number; providers: number[];
}

export interface MatrixCell { bf: number; level: number; n: number; med: number | null; priced: number }

export interface GeoRow {
  pc: string; state: string | null; locality: string | null;
  lat: number | null; lon: number | null;
  campuses: number; providers: number; courses: number; med: number | null;
}

export interface PlacesPayload {
  campuses: Campus[];
  buildings: Building[];
  matrix: MatrixCell[];
  geo: GeoRow[];
}

export interface CoursesPayload {
  n: number;
  code: string[]; name: string[]; p: number[]; nat: string[];
  level: number[]; bf: number[]; nf: number[]; lang: number[];
  weeks: (number | null)[];
  tuition: (number | null)[]; nonTuition: (number | null)[]; total: (number | null)[];
  pw: (number | null)[];
  flags: number[];
  locs: number[][];
}

export interface CompareRow {
  c: string; p: number; w: number | null; t: number; nt: number | null;
  pw: number; s: 0 | 1; st: string[];
}

export interface CompareCode {
  nat: string; title: string; level: number; bf: number;
  providers: number; offers: number; suspect: number;
  pw: { min: number | null; p10: number | null; p25: number | null; med: number | null; p75: number | null; p90: number | null; max: number | null };
  tuition: { min: number | null; med: number | null; max: number | null };
  weeks: { min: number | null; med: number | null; max: number | null };
  rows: CompareRow[];
}

export interface ComparePayload { codes: CompareCode[] }

export interface ChurnPoint {
  m: string; date?: string;
  providers: number | null; courses: number | null; campuses: number | null;
  priced?: number;
  entered: number | null; exited: number | null;
  byType?: Record<string, number>;
  byState?: Record<string, number>;
  gap: boolean;
}

export interface ChurnPayload {
  months: string[];
  series: ChurnPoint[];
  nat: Record<string, Record<string, number>>;
  gaps: string[];
  snapshotCount: number;
}
