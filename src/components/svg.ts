// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Small SVG helpers. Every chart on this site is hand-rolled from these; there
// is no charting library in the dependency tree, and a hygiene test asserts it.

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | null | undefined> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Every numeric attribute goes through here.
 *
 * A NaN reaches the DOM as cx="NaN" and the mark simply vanishes: nothing
 * throws, nothing logs, and the chart is quietly missing points. Coercing to a
 * finite fallback makes the failure visible instead of invisible.
 */
export function fin(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

export interface Scale { (v: number): number; domain: [number, number]; range: [number, number] }

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((v: number) => fin(r0 + ((v - d0) / span) * (r1 - r0), r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export function log10Scale(domain: [number, number], range: [number, number]): Scale {
  const d0 = Math.max(1, domain[0]);
  const d1 = Math.max(d0 * 1.0001, domain[1]);
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const [r0, r1] = range;
  const fn = ((v: number) => {
    if (!(v > 0)) return r0;
    return fin(r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0), r0);
  }) as Scale;
  fn.domain = [d0, d1];
  fn.range = range;
  return fn;
}

/** Round, human tick values across a linear domain. */
export function ticks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function text(
  x: number, y: number, content: string,
  attrs: Record<string, string | number | null | undefined> = {},
): SVGTextElement {
  const t = svgEl('text', { x: fin(x), y: fin(y), ...attrs });
  t.textContent = content;
  return t;
}

/**
 * Attach a hover tooltip to a mark.
 *
 * setAttribute takes RAW newlines — the tooltip's `white-space: pre-line`
 * renders them. `&#10;` here would print those five literal characters.
 * `aria-label` carries the same text for assistive technology; a native SVG
 * <title> is never used, because it is slow, unstyled and invisible on touch.
 */
export function tipped<T extends Element>(el: T, lines: (string | false | null | undefined)[]): T {
  const body = lines.filter(Boolean).join('\n');
  el.setAttribute('data-tip', body);
  el.setAttribute('aria-label', body.replace(/\n/g, '. '));
  return el;
}

/** A group, translated. */
export function group(x = 0, y = 0, attrs: Record<string, string | number> = {}): SVGGElement {
  return svgEl('g', { transform: `translate(${fin(x)},${fin(y)})`, ...attrs });
}

export interface Margins { top: number; right: number; bottom: number; left: number }

export function chartSvg(width: number, height: number, label: string): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${fin(width, 1)} ${fin(height, 1)}`,
    class: 'chart',
    // role="img" is NOT used: it makes the SVG an accessibility LEAF and prunes
    // every focusable mark inside it from the tree while leaving them in the tab
    // order, so a screen-reader user tabs into things that announce nothing.
    'aria-label': label,
  });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}
