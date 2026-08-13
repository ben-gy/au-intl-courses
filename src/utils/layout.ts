// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure layout geometry — beeswarm packing and hexagonal binning.
//
// Both are deterministic: no Math.random anywhere, so a position is
// reproducible and therefore assertable. The test suite checks these where the
// failure actually lives — that no two beeswarm dots overlap, and that no hex
// centre escapes the plot — rather than checking only that the totals add up.
// An area-conserving layout that stacks every mark at one origin passes an
// area test perfectly and renders as garbage.

export interface Packed { x: number; y: number; i: number }

/**
 * Place one dot per value along x, nudged off the baseline only as far as it
 * must go to avoid covering a neighbour.
 *
 * Candidate offsets alternate above and below the baseline (0, +s, −s, +2s, …)
 * so the swarm stays visually centred instead of growing in one direction.
 */
export function beeswarm(
  values: number[],
  scaleX: (v: number) => number,
  r: number,
  maxHalfHeight: number,
): Packed[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const placed: Packed[] = [];
  const out: Packed[] = new Array(values.length);
  const step = r * 1.85;
  const xGap = r * 2;
  const yGap = r * 1.8;

  for (const { v, i } of order) {
    const x = scaleX(v);
    let y = 0;
    for (let k = 0; k < 400; k++) {
      // 0, +1, −1, +2, −2 … times the step.
      const level = Math.ceil(k / 2);
      const sign = k % 2 === 1 ? 1 : -1;
      const candidate = level === 0 ? 0 : sign * level * step;
      if (Math.abs(candidate) > maxHalfHeight) continue;
      const clash = placed.some((p) => Math.abs(p.x - x) < xGap && Math.abs(p.y - candidate) < yGap);
      if (!clash) { y = candidate; break; }
      // If nothing fits inside the budget, the last candidate stands: a dot
      // that overlaps is still better than a dot silently dropped.
      y = candidate;
    }
    const p = { x, y, i };
    placed.push(p);
    out[i] = p;
  }
  return out;
}

export interface Hex { cx: number; cy: number; n: number; items: number[] }

/**
 * Hexagonal binning in SCREEN space.
 *
 * Binning in data space and then projecting gives a mesh that is regular in the
 * data and irregular on screen, which looks like a rendering bug — especially
 * with a log axis on one side, where the cells would visibly stretch.
 */
export function hexbin(points: { x: number; y: number; i: number }[], radius: number): Hex[] {
  const dx = radius * Math.sqrt(3);
  const dy = radius * 1.5;
  const bins = new Map<string, Hex>();

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    // Two candidate lattices (offset rows); the nearer centre wins.
    const py = p.y / dy;
    const pj = Math.round(py);
    const px = p.x / dx - (pj & 1 ? 0.5 : 0);
    const pi = Math.round(px);
    const py1 = py - pj;
    let i = pi;
    let j = pj;
    if (Math.abs(py1) * 3 > 1) {
      const px1 = px - pi;
      const j2 = pj + (py1 < 0 ? -1 : 1);
      const px2 = px - (j2 & 1 ? 0.5 : -0.5);
      const pi2 = Math.round(px2);
      const py2 = py - j2;
      if (px1 * px1 + py1 * py1 > (px2 - pi2) ** 2 + py2 * py2) { i = pi2 + (j2 & 1 ? 1 : -1) / 2; j = j2; }
    }
    const key = `${i}|${j}`;
    let bin = bins.get(key);
    if (!bin) {
      bin = { cx: (i + (j & 1 ? 0.5 : 0)) * dx, cy: j * dy, n: 0, items: [] };
      bins.set(key, bin);
    }
    bin.n++;
    // Keep a bounded sample: the tooltip needs a few examples, not all 26,000.
    if (bin.items.length < 400) bin.items.push(p.i);
  }
  return [...bins.values()];
}

/** The six corners of a flat-topped hexagon, as an SVG path. */
export function hexPath(radius: number): string {
  const pts: string[] = [];
  for (let a = 0; a < 6; a++) {
    const angle = (Math.PI / 180) * (60 * a - 30);
    pts.push(`${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * Pack laid-out component bounding boxes into a single field, largest first.
 *
 * Without this, a graph with one big cluster and forty pairs lays the pairs out
 * in the same field and pure repulsion pushes them to the far corners, leaving
 * the interesting cluster crushed into the middle of an otherwise empty canvas.
 */
export function packBoxes(
  boxes: { w: number; h: number }[],
  fieldWidth: number,
  gap = 16,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > fieldWidth) { x = 0; y += rowHeight + gap; rowHeight = 0; }
    out.push({ x, y });
    x += b.w + gap;
    rowHeight = Math.max(rowHeight, b.h);
  }
  return out;
}

export function boundsOf(nodes: { x: number; y: number; r: number }[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
