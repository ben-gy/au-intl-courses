// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

const NF = new Intl.NumberFormat('en-AU');

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return NF.format(Math.round(n));
}

/** Whole dollars. Fees are registered as whole dollars; cents would be noise. */
export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n < 0 ? '-' : ''}$${NF.format(Math.abs(Math.round(n)))}`;
}

/**
 * The site's unit, and it always carries its unit.
 *
 * A bare "260" next to a "$20,400" invites the reader to compare them, and the
 * whole argument of this site is that those two numbers answer different
 * questions. Every per-week figure is printed with "/wk" attached.
 */
export function perWeek(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${NF.format(Math.round(n))}/wk`;
}

export function weeks(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${NF.format(Math.round(n))} ${Math.round(n) === 1 ? 'week' : 'weeks'}`;
}

export function pct(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(dp)}%`;
}

/** 1st, 2nd, 3rd … for percentile prose. */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[mo - 1]} ${y}`;
}

export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Truncate on a word boundary, THEN escape. Never truncate escaped text. */
export function truncEsc(s: string | null | undefined, max: number): string {
  const raw = String(s ?? '');
  if (raw.length <= max) return esc(raw);
  const cut = raw.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${esc(sp > max * 0.6 ? cut.slice(0, sp) : cut)}…`;
}

/**
 * Text for the `data-tip` ATTRIBUTE, set with setAttribute.
 *
 * setAttribute takes RAW newlines — the tooltip's `white-space: pre-line`
 * renders them. Passing `&#10;` here prints the literal characters "&#10;" to
 * the reader; that escape is only correct when building an HTML string.
 */
export function tip(...lines: (string | null | undefined | false)[]): string {
  return lines.filter(Boolean).join('\n');
}

/** The same tooltip text, for embedding inside an innerHTML string. */
export function tipAttr(...lines: (string | null | undefined | false)[]): string {
  return esc(lines.filter(Boolean).join('\n')).replace(/\n/g, '&#10;');
}

export function slug(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** A provider's display name — the trading name if it has one, else the legal one. */
export function providerLabel(p: { name: string; trading: string }): string {
  return p.trading && p.trading !== p.name ? p.trading : p.name;
}
