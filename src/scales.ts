// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every colour scale on this site, in one place, and every one of them on
// EXPLICIT hand-set breaks that are printed in their own legend.
//
// There are no quantile scales here, deliberately. Course prices run from $115
// to $5,863 per teaching week and provider counts per postcode run from 1 to
// 291; quantile bins on either distribution put the Melbourne CBD and a single
// suburban campus in the same darkest bucket and delete the only thing the
// chart exists to show. A quantile scale on skewed data is a documented defect
// in this fleet, not a styling preference.

export interface Ramp {
  /** Upper bound of each bucket; the last is Infinity. */
  breaks: number[];
  colours: string[];
  labels: string[];
  title: string;
  unit: string;
}

const PRICE_COLOURS = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--p5)', 'var(--p6)'];

/** Dollars per teaching week. Breaks chosen on the VET/degree split, not on quantiles. */
export const PRICE_RAMP: Ramp = {
  breaks: [200, 300, 450, 700, 1100, Infinity],
  colours: PRICE_COLOURS,
  labels: ['under $200', '$200–299', '$300–449', '$450–699', '$700–1,099', '$1,100+'],
  title: 'Median tuition',
  unit: 'per teaching week',
};

/** Distinct providers with a campus in a postcode. Log-spaced: 1 → 291. */
export const PROVIDER_RAMP: Ramp = {
  breaks: [1, 3, 7, 19, 79, Infinity],
  colours: PRICE_COLOURS,
  labels: ['1', '2–3', '4–7', '8–19', '20–79', '80+'],
  title: 'Providers with a campus here',
  unit: 'distinct providers',
};

export const CAMPUS_RAMP: Ramp = {
  breaks: [1, 4, 10, 30, 120, Infinity],
  colours: PRICE_COLOURS,
  labels: ['1', '2–4', '5–10', '11–30', '31–120', '121+'],
  title: 'Campuses here',
  unit: 'campuses',
};

export const COURSE_RAMP: Ramp = {
  breaks: [25, 100, 400, 1500, 6000, Infinity],
  colours: PRICE_COLOURS,
  labels: ['under 25', '25–99', '100–399', '400–1,499', '1,500–5,999', '6,000+'],
  title: 'Courses taught here',
  unit: 'course–campus records',
};

export const WEEKS_RAMP: Ramp = {
  breaks: [26, 52, 78, 104, 156, Infinity],
  colours: PRICE_COLOURS,
  labels: ['under 26', '26–51', '52–77', '78–103', '104–155', '156+'],
  title: 'Median duration',
  unit: 'weeks',
};

export const SHARE_RAMP: Ramp = {
  breaks: [1, 10, 25, 50, 75, Infinity],
  colours: PRICE_COLOURS,
  labels: ['under 1%', '1–9%', '10–24%', '25–49%', '50–74%', '75–100%'],
  title: 'Share with a national code',
  unit: 'per cent of courses',
};

export const DENSITY_RAMP: Ramp = {
  breaks: [1, 4, 9, 24, 99, Infinity],
  colours: PRICE_COLOURS,
  labels: ['1', '2–4', '5–9', '10–24', '25–99', '100+'],
  title: 'Courses in this bin',
  unit: 'courses',
};

/** The bucket index for a value, or −1 when there is no value to bucket. */
export function bucket(ramp: Ramp, value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return -1;
  for (let i = 0; i < ramp.breaks.length; i++) if (value <= ramp.breaks[i]) return i;
  return ramp.breaks.length - 1;
}

/**
 * The fill for a value.
 *
 * Absence returns the hatch token, never the lightest ramp step. Drawing "no
 * data" as "the smallest amount of data" is how a map invents a finding.
 */
export function rampFill(ramp: Ramp, value: number | null | undefined): string {
  const b = bucket(ramp, value);
  return b < 0 ? 'var(--absent)' : ramp.colours[b];
}

/** White on the two darkest steps, ink on the rest. */
export function rampInk(ramp: Ramp, value: number | null | undefined): string {
  const b = bucket(ramp, value);
  return b >= 4 ? '#ffffff' : 'var(--ink)';
}

/** Duration terciles, within a group's OWN duration distribution. */
export const DURATION_COLOURS = ['var(--d-short)', 'var(--d-mid)', 'var(--d-long)'];
export const DURATION_LABELS = ['shorter than most', 'typical', 'longer than most'];

export function tercile(value: number, sortedAsc: number[]): number {
  if (!sortedAsc.length) return 1;
  const at = (f: number) => sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * f))];
  if (value <= at(1 / 3)) return 0;
  if (value <= at(2 / 3)) return 1;
  return 2;
}

/** Linear-interpolated quantile over an ascending array. Null, never NaN. */
export function quantile(sortedAsc: number[], f: number): number | null {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * Math.min(1, Math.max(0, f));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** The share of `sortedAsc` at or below `value`, as a percentage. */
export function percentileOf(value: number, sortedAsc: number[]): number {
  if (!sortedAsc.length) return 0;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sortedAsc.length) * 100;
}

/**
 * The threshold below which a registered fee is not believable.
 *
 * The register-wide 1st percentile is about $118 per teaching week, so $60 is
 * comfortably below anything genuinely cheap and only catches rows like $1,600
 * spread over 104 weeks. Flagged rows are drawn differently and barred from
 * every "cheapest" claim — they are never deleted.
 */
export const SUSPECT_PER_WEEK = 60;
