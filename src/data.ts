// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Loading, caching and the handful of indexes every view wants.
//
// Payloads are split by WHEN they are needed. meta + providers load at boot;
// everything else is fetched the first time a view asks for it and then held.
// A reader who only ever looks at one qualification never downloads the map.

import type {
  ChurnPayload, ComparePayload, CoursesPayload, Meta, PlacesPayload, Provider, ProvidersPayload,
} from './types';

const BASE = `${import.meta.env.BASE_URL ?? '/'}data/`.replace(/\/{2,}/g, '/');

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name} could not be loaded (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/** One in-flight promise per file, so two views asking at once fetch once. */
function once<T>(loader: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= loader());
}

export const loadMeta = once(() => fetchJson<Meta>('meta.json'));
export const loadProviders = once(() => fetchJson<ProvidersPayload>('providers.json'));
export const loadPlaces = once(() => fetchJson<PlacesPayload>('places.json'));
export const loadCourses = once(() => fetchJson<CoursesPayload>('courses.json'));
export const loadCompare = once(() => fetchJson<ComparePayload>('compare.json'));
export const loadChurn = once(() => fetchJson<ChurnPayload>('churn.json'));
export const loadBoundaries = once(() => fetchJson<GeoJSON.FeatureCollection>('poa.geojson'));

/* ── synchronous accessors, valid once boot has awaited the two core files ── */

let META: Meta | null = null;
let PROV: ProvidersPayload | null = null;

export function primeCore(meta: Meta, providers: ProvidersPayload): void {
  META = meta;
  PROV = providers;
}

export function meta(): Meta {
  if (!META) throw new Error('meta requested before boot completed');
  return META;
}

export function core(): ProvidersPayload {
  if (!PROV) throw new Error('providers requested before boot completed');
  return PROV;
}

export function providers(): Provider[] { return core().providers; }
export function provider(i: number): Provider { return core().providers[i]; }
export function dicts() { return core().dicts; }

export function levelName(i: number): string { return dicts().levels[i] ?? 'Unknown'; }
export function fieldName(i: number): string { return dicts().broadFields[i] ?? 'Unknown'; }
export function narrowName(i: number): string { return dicts().narrowFields[i] ?? 'Unknown'; }
export function locationTypeName(i: number): string { return dicts().locationTypes[i] ?? 'Unknown'; }
export function languageName(i: number): string { return dicts().languages[i] ?? 'Unknown'; }

let bySlug: Map<string, Provider> | null = null;
export function providerBySlug(s: string): Provider | undefined {
  bySlug ??= new Map(providers().map((p) => [p.slug, p]));
  return bySlug.get(s);
}

let byCode: Map<string, Provider> | null = null;
export function providerByCode(code: string): Provider | undefined {
  byCode ??= new Map(providers().map((p) => [p.code, p]));
  return byCode.get(code);
}

/**
 * AQF-ordered level bands.
 *
 * The register's 21 levels put a doctorate and a primary-school year on the
 * same list. Eight bands make a readable matrix; the five levels that are not
 * priced on the same logic — school years, non-AQF awards, short courses — are
 * held OUT of the main grid rather than folded in, because putting school fees
 * and doctoral fees on one colour ramp makes both meaningless.
 */
export const LEVEL_BANDS: { id: string; label: string; short: string; levels: string[] }[] = [
  { id: 'cert12', label: 'Certificate I–II', short: 'I–II', levels: ['Certificate I', 'Certificate II'] },
  { id: 'cert3', label: 'Certificate III', short: 'III', levels: ['Certificate III'] },
  { id: 'cert4', label: 'Certificate IV', short: 'IV', levels: ['Certificate IV'] },
  { id: 'dip', label: 'Diploma & Advanced Diploma', short: 'Dip', levels: ['Diploma', 'Advanced Diploma'] },
  { id: 'bach', label: 'Associate & Bachelor Degree', short: 'Bach', levels: ['Associate Degree', 'Bachelor Degree'] },
  { id: 'hons', label: 'Bachelor Honours', short: 'Hons', levels: ['Bachelor Honours Degree'] },
  { id: 'pg', label: 'Postgraduate coursework', short: 'PG', levels: ['Graduate Certificate', 'Graduate Diploma', 'Masters Degree (Coursework)', 'Masters Degree (Extended)'] },
  { id: 'res', label: 'Research & doctoral', short: 'Res', levels: ['Masters Degree (Research)', 'Doctoral Degree'] },
];

export const OTHER_LEVELS = [
  'Non AQF Award', 'Senior Secondary Certificate of Education',
  'Primary School Studies', 'Junior Secondary Studies', 'Vocational Short Course',
];

let bandByLevel: Map<number, string> | null = null;
export function bandOf(levelIdx: number): string | null {
  if (!bandByLevel) {
    bandByLevel = new Map();
    const levels = dicts().levels;
    for (const band of LEVEL_BANDS) {
      for (const name of band.levels) {
        const i = levels.indexOf(name);
        if (i >= 0) bandByLevel.set(i, band.id);
      }
    }
  }
  return bandByLevel.get(levelIdx) ?? null;
}

/** Training-package prefixes, expanded — "BSB" means nothing to a reader. */
const PACKAGES: Record<string, string> = {
  BSB: 'Business Services', SIT: 'Tourism, Travel and Hospitality', CHC: 'Community Services',
  ICT: 'Information and Communications Technology', CPC: 'Construction, Plumbing and Services',
  AUR: 'Automotive Retail, Service and Repair', SIS: 'Sport, Fitness and Recreation',
  AHC: 'Agriculture, Horticulture and Conservation', TLI: 'Transport and Logistics',
  MEM: 'Manufacturing and Engineering', HLT: 'Health', UEE: 'Electrotechnology',
  CUA: 'Creative Arts and Culture', FBP: 'Food, Beverage and Pharmaceutical',
  RII: 'Resources and Infrastructure', SHB: 'Hairdressing and Beauty Services',
  FNS: 'Financial Services', CPP: 'Property Services', TAE: 'Training and Education',
  MSF: 'Furnishing', MSA: 'Manufacturing', PSP: 'Public Sector', SFI: 'Seafood Industry',
  DEF: 'Defence', MAR: 'Maritime', FWP: 'Forest and Wood Products', LGA: 'Local Government',
};

export function trainingPackage(natCode: string): string | null {
  const prefix = /^([A-Z]{3})/.exec(natCode)?.[1];
  return prefix ? PACKAGES[prefix] ?? null : null;
}
