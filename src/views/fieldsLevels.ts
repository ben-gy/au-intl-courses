// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// What each kind of study costs, at each level, and where the register simply
// has nothing.
//
// Three separate visual channels per cell, deliberately, so "lots of courses"
// and "expensive courses" can never be read as each other: FILL is the median
// price, the WHISKER is the spread on the global scale, and the CORNER WEDGE is
// how many courses the cell rests on. A $1,400/week cell built on nine courses
// must never look as authoritative as one built on four thousand.

import { esc, num, perWeek, tipAttr } from '../format';
import { PRICE_RAMP, WEEKS_RAMP, SHARE_RAMP, bucket, quantile, rampFill, rampInk } from '../scales';
import { LEVEL_BANDS, OTHER_LEVELS, bandOf, fieldName, levelName, loadCourses, meta } from '../data';
import { navigate, setParams, currentRoute } from '../router';
import { F_EXPIRED, F_SUSPECT } from '../types';
import type { CoursesPayload } from '../types';

type Metric = 'price' | 'weeks' | 'coded';

interface Cell {
  n: number; priced: number; coded: number;
  pw: number[]; wk: number[];
}

/** Below this many priced courses, a median is not a price. */
const THIN = 10;

export async function renderFieldsLevels(host: HTMLElement): Promise<void> {
  const courses = await loadCourses();
  const route = currentRoute();
  let metric: Metric = (route.params.get('metric') as Metric) || 'price';

  host.innerHTML = `
    <div class="view-head">
      <h1>What each kind of study costs, level by level</h1>
      <p class="view-sub">Before picking a provider: what does the subject you want actually cost per teaching week, at
        what levels is it even offered, and where does the register have nothing at all? Hatched cells are absence, not
        a low value — and a cell resting on fewer than ${THIN} priced courses shows its count instead of a median,
        because a median over four courses is not a price.</p>
    </div>
    <div class="panel">
      <div class="controls" id="metric-chips"></div>
      <div class="legend" id="legend"></div>
    </div>
    <div class="panel">
      <div id="matrix"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Not on the same scale</h3>
        <span class="muted">levels the register prices on a different logic</span></div>
      <p class="small muted">School years, non-AQF awards and short courses are held out of the grid above rather than
        folded into it. Putting a primary-school fee and a doctoral fee on one colour ramp makes both meaningless.</p>
      <div id="other"></div>
    </div>`;

  const matrixHost = host.querySelector<HTMLElement>('#matrix')!;
  const otherHost = host.querySelector<HTMLElement>('#other')!;
  const legend = host.querySelector<HTMLElement>('#legend')!;
  const chips = host.querySelector<HTMLElement>('#metric-chips')!;

  const METRICS: [Metric, string][] = [
    ['price', 'median tuition per teaching week'],
    ['weeks', 'median course length'],
    ['coded', 'share that is price-comparable'],
  ];
  chips.innerHTML = '<span class="control-label">Colour by</span>' + METRICS.map(([id, label]) =>
    `<button type="button" class="chip" data-metric="${id}" aria-pressed="${metric === id}">${label}</button>`).join('');
  for (const b of chips.querySelectorAll<HTMLElement>('[data-metric]')) {
    b.addEventListener('click', () => {
      metric = b.dataset.metric as Metric;
      for (const o of chips.querySelectorAll('[data-metric]')) o.setAttribute('aria-pressed', String((o as HTMLElement).dataset.metric === metric));
      setParams({ metric: metric === 'price' ? null : metric });
      draw();
    });
  }

  // Build the grid once; only the encoding changes when the metric does.
  const fields = [...new Set(Array.from({ length: courses.n }, (_, i) => courses.bf[i]))]
    .filter((f) => fieldName(f) !== '')
    .sort((a, b) => count(b) - count(a));

  function count(f: number): number {
    let n = 0;
    for (let i = 0; i < courses.n; i++) if (courses.bf[i] === f && !(courses.flags[i] & F_EXPIRED)) n++;
    return n;
  }

  const grid = new Map<string, Cell>();
  const otherGrid = new Map<string, Cell>();
  const fieldTotals = new Map<number, number>();

  for (let i = 0; i < courses.n; i++) {
    if (courses.flags[i] & F_EXPIRED) continue;
    const band = bandOf(courses.level[i]);
    const key = band ? `${courses.bf[i]}|${band}` : `${courses.bf[i]}|${levelName(courses.level[i])}`;
    const target = band ? grid : otherGrid;
    let cell = target.get(key);
    if (!cell) { cell = { n: 0, priced: 0, coded: 0, pw: [], wk: [] }; target.set(key, cell); }
    cell.n++;
    if (courses.nat[i]) cell.coded++;
    const pw = courses.pw[i];
    if (pw != null && !(courses.flags[i] & F_SUSPECT)) { cell.priced++; cell.pw.push(pw); }
    const wk = courses.weeks[i];
    if (wk != null) cell.wk.push(wk);
    fieldTotals.set(courses.bf[i], (fieldTotals.get(courses.bf[i]) ?? 0) + 1);
  }

  // The global price scale the micro-whiskers are drawn on. Drawing each cell's
  // whisker on its OWN scale silently inverts the encoding: a tight cell would
  // read as the widest one on the page.
  const allPw = Array.from({ length: courses.n }, (_, i) => courses.pw[i])
    .filter((v, i) => v != null && !(courses.flags[i] & (F_SUSPECT | F_EXPIRED))) as number[];
  allPw.sort((a, b) => a - b);
  const globalLo = quantile(allPw, 0.02) ?? 0;
  const globalHi = quantile(allPw, 0.98) ?? 1;

  function value(cell: Cell): number | null {
    if (metric === 'coded') return cell.n ? (cell.coded / cell.n) * 100 : null;
    if (metric === 'weeks') return cell.wk.length ? quantile(cell.wk.slice().sort((a, b) => a - b), 0.5) : null;
    return cell.priced >= THIN ? quantile(cell.pw.slice().sort((a, b) => a - b), 0.5) : null;
  }

  function ramp() { return metric === 'weeks' ? WEEKS_RAMP : metric === 'coded' ? SHARE_RAMP : PRICE_RAMP; }
  function fmt(v: number | null): string {
    if (v == null) return '—';
    if (metric === 'coded') return `${Math.round(v)}%`;
    if (metric === 'weeks') return `${Math.round(v)} wk`;
    return `$${num(v)}`;
  }

  function draw(): void {
    const r = ramp();
    legend.innerHTML = `<span class="legend-title">${r.title} <span class="muted">(${r.unit})</span></span>`
      + r.labels.map((l, i) => `<span class="legend-item"><span class="legend-swatch" style="background:${r.colours[i]}"></span>${l}</span>`).join('')
      + `<span class="legend-item"><span class="legend-swatch hatched"></span>none registered, or too few to summarise</span>`;

    matrixHost.innerHTML = renderGrid(fields, LEVEL_BANDS.map((b) => ({ id: b.id, label: b.label, short: b.short })), grid);
    otherHost.innerHTML = renderGrid(fields, OTHER_LEVELS.map((l) => ({ id: l, label: l, short: l.split(' ')[0] })), otherGrid);

    for (const el of [matrixHost, otherHost].flatMap((h) => [...h.querySelectorAll<HTMLElement>('[data-cell]')])) {
      el.addEventListener('click', () => {
        const [bf, band] = el.dataset.cell!.split('|');
        const cell = (grid.get(el.dataset.cell!) ?? otherGrid.get(el.dataset.cell!))!;
        if (!cell || !cell.n) { explain(el, bf, band); return; }
        navigate('find-a-course', { field: bf, band });
      });
    }
    for (const el of [matrixHost, otherHost].flatMap((h) => [...h.querySelectorAll<HTMLElement>('[data-field-header]')])) {
      el.addEventListener('click', () => navigate('find-a-course', { field: el.dataset.fieldHeader }));
    }
    for (const el of [...matrixHost.querySelectorAll<HTMLElement>('[data-band-header]')]) {
      el.addEventListener('click', () => navigate('find-a-course', { band: el.dataset.bandHeader }));
    }
  }

  /** A hatched cell is still a live control — this is the one view whose whole
      subject is absence, so a dead click here would be the worst kind. */
  function explain(el: HTMLElement, bf: string, band: string): void {
    const bandLabel = LEVEL_BANDS.find((b) => b.id === band)?.label ?? band;
    const existing = el.parentElement?.querySelector('.cell-explain');
    existing?.remove();
    const note = document.createElement('div');
    note.className = 'cell-explain caution-note small';
    note.textContent = `The register has no ${bandLabel} course in ${fieldName(Number(bf))} open to international students. `
      + 'That is a real absence in the register, not a missing number here.';
    el.closest('.matrix-wrap')?.append(note);
  }

  function renderGrid(
    rows: number[],
    cols: { id: string; label: string; short: string }[],
    data: Map<string, Cell>,
  ): string {
    const cells = rows.map((f) => {
      const rowCells = cols.map((c) => {
        const key = `${f}|${c.id}`;
        const cell = data.get(key);
        const v = cell ? value(cell) : null;
        const thin = !cell || !cell.n || (metric === 'price' && cell.priced < THIN);
        const fill = thin ? 'var(--absent)' : rampFill(ramp(), v);
        const ink = thin ? 'var(--ink-2)' : rampInk(ramp(), v);
        const pwSorted = cell ? cell.pw.slice().sort((a, b) => a - b) : [];
        const p10 = quantile(pwSorted, 0.1);
        const p90 = quantile(pwSorted, 0.9);
        const whiskerLeft = p10 == null ? 0 : Math.max(0, Math.min(100, ((p10 - globalLo) / (globalHi - globalLo)) * 100));
        const whiskerRight = p90 == null ? 0 : Math.max(0, Math.min(100, ((p90 - globalLo) / (globalHi - globalLo)) * 100));
        const wedge = cell && cell.n ? Math.min(40, Math.sqrt(cell.n) * 2.6) : 0;
        return `<button type="button" class="mcell${thin ? ' hatched' : ''}" data-cell="${key}"
          style="background:${fill};color:${ink}"
          data-tip="${tipAttr(
            `${fieldName(f)} · ${c.label}`,
            cell && cell.n ? `${num(cell.n)} courses on the register` : 'No course registered in this combination',
            cell && cell.priced ? `${num(cell.priced)} with a believable price` : '',
            cell && cell.priced >= THIN ? `Median ${perWeek(quantile(pwSorted, 0.5))} · middle 80% ${perWeek(p10)} – ${perWeek(p90)}` : (cell && cell.n ? `Too few priced courses (${cell.priced}) to quote a median` : ''),
            cell && cell.wk.length ? `Median length ${Math.round(quantile(cell.wk.slice().sort((a, b) => a - b), 0.5) ?? 0)} weeks` : '',
            cell && cell.n ? `${Math.round((cell.coded / cell.n) * 100)}% carry a VET national code, so that share is price-comparable between providers` : '',
            cell && cell.n ? 'Click to list these courses' : 'Click for what this absence means',
          )}">
          <span class="mcell-value">${thin && cell && cell.n ? num(cell.n) : fmt(v)}</span>
          ${wedge ? `<span class="mcell-wedge" style="width:${wedge}%;height:${wedge}%"></span>` : ''}
          ${(p10 != null && p90 != null && metric === 'price' && !thin) ? `<span class="mcell-whisker" style="left:${whiskerLeft}%;right:${100 - whiskerRight}%"></span>` : ''}
        </button>`;
      }).join('');
      return `<div class="mrow">
        <button type="button" class="mrow-label" data-field-header="${f}"
          data-tip="${tipAttr(fieldName(f), `${num(fieldTotals.get(f) ?? 0)} courses on the register`, 'Click to list every course in this field')}">
          <span>${esc(fieldName(f))}</span><span class="small dim">${num(fieldTotals.get(f) ?? 0)}</span>
        </button>
        <div class="mcells">${rowCells}</div>
      </div>`;
    }).join('');

    return `<div class="matrix-wrap">
      <div class="mrow mhead">
        <div class="mrow-label"></div>
        <div class="mcells">${cols.map((c) => `<button type="button" class="mcol-label" data-band-header="${c.id}"
          data-tip="${tipAttr(c.label, 'Click to list every course at this level')}"><span class="full">${esc(c.label)}</span><span class="short">${esc(c.short)}</span></button>`).join('')}</div>
      </div>
      ${cells}
    </div>`;
  }

  draw();
  void meta;
  void bucket;
  void (courses as CoursesPayload);
}
