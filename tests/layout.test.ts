// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// POSITIONAL assertions for every hand-rolled layout on the site.
//
// Area-only tests pass on visually broken layouts: a layout that stacks every
// mark at one origin conserves area perfectly and renders as garbage. So these
// assert what actually determines whether the reader can see anything — that
// nothing overlaps, nothing escapes the canvas, and no coordinate is NaN.

import { describe, expect, it } from 'vitest';
import { beeswarm, boundsOf, hexPath, hexbin, packBoxes } from '../src/utils/layout';
import { clampViewBox, zoomViewBox } from '../src/utils/svgZoom';
import { components, forceLayout, mulberry32 } from '../src/utils/forceLayout';
import { linear, log10Scale, ticks } from '../src/components/svg';
import { percentileOf, quantile, tercile, bucket, rampFill, PRICE_RAMP } from '../src/scales';

describe('beeswarm packing', () => {
  const R = 4;
  const values = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i * 1.7) * 40 + i * 0.4);
  const scale = linear([0, 400], [0, 800]);
  const packed = beeswarm(values, scale, R, 60);

  it('returns one position per value, in the order they came in', () => {
    expect(packed).toHaveLength(values.length);
    packed.forEach((p, i) => expect(p.i).toBe(i));
  });

  it('never produces a NaN coordinate — a NaN becomes cx="NaN" and the dot vanishes silently', () => {
    for (const p of packed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('stays inside the vertical budget', () => {
    for (const p of packed) expect(Math.abs(p.y)).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('does not let two dots cover each other', () => {
    // The whole point of a swarm is that every dot is separately hoverable.
    let overlaps = 0;
    for (let i = 0; i < packed.length; i++) {
      for (let j = i + 1; j < packed.length; j++) {
        const dx = Math.abs(packed[i].x - packed[j].x);
        const dy = Math.abs(packed[i].y - packed[j].y);
        if (dx < R * 2 - 0.01 && dy < R * 1.8 - 0.01) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('is deterministic — the same input gives byte-identical positions', () => {
    const again = beeswarm(values, scale, R, 60);
    expect(again).toEqual(packed);
  });

  it('places a single value on the baseline', () => {
    const one = beeswarm([50], scale, R, 60);
    expect(one[0].y).toBe(0);
    expect(one[0].x).toBeCloseTo(scale(50));
  });

  it('handles an empty input', () => {
    expect(beeswarm([], scale, R, 60)).toEqual([]);
  });
});

describe('hexbin', () => {
  const pts = Array.from({ length: 2000 }, (_, i) => ({
    x: (i * 37) % 600, y: (i * 53) % 400, i,
  }));
  const bins = hexbin(pts, 7);

  it('assigns every point to exactly one bin', () => {
    expect(bins.reduce((n, b) => n + b.n, 0)).toBe(pts.length);
  });

  it('produces only finite centres', () => {
    for (const b of bins) {
      expect(Number.isFinite(b.cx)).toBe(true);
      expect(Number.isFinite(b.cy)).toBe(true);
    }
  });

  it('emits no zero-count bins — absence is absent from the DOM, not drawn as a tile', () => {
    expect(bins.every((b) => b.n > 0)).toBe(true);
  });

  it('keeps bins inside the point cloud\'s own extent, within one radius', () => {
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    for (const b of bins) {
      expect(b.cx).toBeGreaterThanOrEqual(-7);
      expect(b.cx).toBeLessThanOrEqual(maxX + 7);
      expect(b.cy).toBeGreaterThanOrEqual(-7);
      expect(b.cy).toBeLessThanOrEqual(maxY + 7);
    }
  });

  it('drops a non-finite point rather than producing a NaN bin', () => {
    const withNaN = hexbin([{ x: NaN, y: 3, i: 0 }, { x: 1, y: 2, i: 1 }], 7);
    expect(withNaN.reduce((n, b) => n + b.n, 0)).toBe(1);
  });

  it('caps the retained sample so a dense bin cannot hold 26,000 indexes', () => {
    const dense = hexbin(Array.from({ length: 5000 }, (_, i) => ({ x: 10, y: 10, i })), 7);
    expect(dense[0].items.length).toBeLessThanOrEqual(400);
    expect(dense[0].n).toBe(5000);
  });

  it('draws a closed six-sided path', () => {
    const d = hexPath(7);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.split('L')).toHaveLength(6);
  });
});

describe('force layout', () => {
  it('settles synchronously and leaves every node in bounds', () => {
    const rnd = mulberry32(1);
    const nodes = Array.from({ length: 120 }, () => ({ x: rnd() * 400, y: rnd() * 400, r: 5 }));
    const links = Array.from({ length: 200 }, (_, i) => ({ source: i % 120, target: (i * 7) % 120 }))
      .filter((l) => l.source !== l.target);
    forceLayout(nodes, links, { width: 400, height: 400, timeBudgetMs: 400 });
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(n.r - 1e-6);
      expect(n.x).toBeLessThanOrEqual(400 - n.r + 1e-6);
      expect(n.y).toBeGreaterThanOrEqual(n.r - 1e-6);
      expect(n.y).toBeLessThanOrEqual(400 - n.r + 1e-6);
    }
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const rnd = mulberry32(42);
      const nodes = Array.from({ length: 40 }, () => ({ x: rnd() * 200, y: rnd() * 200, r: 4 }));
      forceLayout(nodes, [{ source: 0, target: 1 }], { width: 200, height: 200, timeBudgetMs: 100 });
      return nodes.map((n) => [Math.round(n.x * 1000), Math.round(n.y * 1000)]);
    };
    expect(run()).toEqual(run());
  });

  it('separates coincident nodes rather than leaving them stacked', () => {
    const nodes = [{ x: 50, y: 50, r: 5 }, { x: 50, y: 50, r: 5 }];
    forceLayout(nodes, [], { width: 100, height: 100, timeBudgetMs: 100 });
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeGreaterThan(1);
  });

  it('returns immediately for an empty graph', () => {
    expect(forceLayout([], [], { width: 10, height: 10 }).iterations).toBe(0);
  });

  it('finds connected components, largest first', () => {
    const comps = components(6, [{ source: 0, target: 1 }, { source: 1, target: 2 }, { source: 4, target: 5 }]);
    expect(comps.map((c) => c.length)).toEqual([3, 2, 1]);
  });
});

describe('component packing', () => {
  it('never overlaps two boxes', () => {
    const boxes = [{ w: 200, h: 120 }, { w: 180, h: 90 }, { w: 90, h: 60 }, { w: 400, h: 200 }, { w: 40, h: 40 }];
    const pos = packBoxes(boxes, 500, 10);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = { ...pos[i], ...boxes[i] };
        const b = { ...pos[j], ...boxes[j] };
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('places everything at a finite, non-negative position', () => {
    const pos = packBoxes([{ w: 10, h: 10 }, { w: 10, h: 10 }], 15, 4);
    for (const p of pos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('bounds an empty node list without returning Infinity', () => {
    expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('scales', () => {
  it('maps a linear domain onto its range', () => {
    const s = linear([0, 100], [0, 500]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(250);
    expect(s(100)).toBe(500);
  });

  it('never returns NaN for a degenerate domain', () => {
    const s = linear([5, 5], [0, 100]);
    expect(Number.isFinite(s(5))).toBe(true);
  });

  it('handles zero and negatives on a log scale without returning -Infinity', () => {
    const s = log10Scale([100, 100000], [400, 0]);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(Number.isFinite(s(-5))).toBe(true);
    expect(s(100)).toBeCloseTo(400);
    expect(s(100000)).toBeCloseTo(0);
  });

  it('produces round ticks inside the domain', () => {
    const t = ticks(0, 1200, 6);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(1200);
    expect(t.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('does not loop forever on an inverted domain', () => {
    expect(ticks(10, 5)).toEqual([10]);
  });
});

describe('statistics used in the copy', () => {
  it('places a value at its true percentile', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileOf(10, sorted)).toBeCloseTo(10);
    expect(percentileOf(50, sorted)).toBeCloseTo(50);
    expect(percentileOf(100, sorted)).toBeCloseTo(100);
    expect(percentileOf(0, sorted)).toBe(0);
  });

  it('returns null quantiles for an empty array rather than NaN', () => {
    expect(quantile([], 0.5)).toBeNull();
  });

  it('splits terciles inside the group\'s OWN distribution', () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    expect(tercile(10, durations)).toBe(0);
    expect(tercile(50, durations)).toBe(1);
    expect(tercile(90, durations)).toBe(2);
  });
});

describe('the colour ramps', () => {
  it('buckets on the printed breaks, never on quantiles', () => {
    // A quantile scale on a $115–$5,863 distribution puts the CBD and a single
    // suburban campus in the same darkest bucket. These breaks are fixed.
    expect(bucket(PRICE_RAMP, 150)).toBe(0);
    expect(bucket(PRICE_RAMP, 260)).toBe(1);
    expect(bucket(PRICE_RAMP, 5000)).toBe(PRICE_RAMP.breaks.length - 1);
  });

  it('draws absence with its own token, never with the lightest ramp step', () => {
    expect(rampFill(PRICE_RAMP, null)).toBe('var(--absent)');
    expect(rampFill(PRICE_RAMP, NaN)).toBe('var(--absent)');
    expect(rampFill(PRICE_RAMP, 150)).toBe(PRICE_RAMP.colours[0]);
  });

  it('has one label per break', () => {
    expect(PRICE_RAMP.labels).toHaveLength(PRICE_RAMP.breaks.length);
    expect(PRICE_RAMP.colours).toHaveLength(PRICE_RAMP.breaks.length);
  });
});

describe('svg zoom maths', () => {
  it('keeps the view inside its base box', () => {
    const base = { x: 0, y: 0, w: 100, h: 100 };
    const out = clampViewBox({ x: -50, y: 200, w: 50, h: 50 }, base);
    expect(out.x).toBe(0);
    expect(out.y).toBe(50);
  });

  it('zooms about the cursor and refuses to go below 1×', () => {
    const base = { x: 0, y: 0, w: 100, h: 100 };
    const zoomed = zoomViewBox(base, base, 2, 50, 50);
    expect(zoomed.w).toBeCloseTo(50);
    const out = zoomViewBox(zoomed, base, 0.01, 50, 50);
    expect(out.w).toBeCloseTo(100);
  });
});
