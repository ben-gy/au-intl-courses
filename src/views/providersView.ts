// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The whole provider population on two axes of registry fact.
//
// Deliberately NOT a league table. CRICOS contains zero enrolments, so course
// count is catalogue breadth and nothing else, and Institution Capacity is a
// licensing ceiling. A single ranking would be read as "biggest college in
// Australia", which this register cannot support. Two axes plotted against each
// other refuse to collapse into one, and the interesting population — a tiny
// registered ceiling with a wide catalogue — is a POSITION on a plane rather
// than a rank.

import { chartSvg, group, linear, svgEl, text, tipped } from '../components/svg';
import { attachSvgZoom } from '../utils/svgZoom';
import { mulberry32 } from '../utils/forceLayout';
import { esc, num, ordinal, perWeek, providerLabel, tipAttr, truncEsc } from '../format';
import { loadCompare, meta, providers } from '../data';
import { gloss } from '../glossary';
import { openProvider } from '../components/drawers';
import { setParams, currentRoute } from '../router';
import { quantile } from '../scales';
import type { Provider } from '../types';

type Filter = 'all' | 'P' | 'G';

export async function renderProviders(host: HTMLElement): Promise<void> {
  const all = providers();
  const route = currentRoute();
  let typeFilter: Filter = (route.params.get('type') as Filter) || 'all';
  let stateFilter = route.params.get('state') ?? '';

  const m = meta();
  const states = [...new Set(all.flatMap((p) => p.states))].sort();

  host.innerHTML = `
    <div class="view-head">
      <h1>Every registered provider, on two axes of fact</h1>
      <p class="view-sub">How many places a provider teaches at, against how wide its catalogue is. Neither axis is a
        size: ${gloss('CRICOS')} publishes no enrolments at all, so a wide catalogue means a provider is registered to
        teach many things, not that many people study them.</p>
    </div>

    <div class="standing-note">
      <strong>Course count is not student count.</strong> ${gloss('Institution Capacity', 'Registered capacity')} is a
      legal ceiling set by the regulator, not a headcount. There is no ranking on this page, and there will not be one:
      the register cannot measure quality, outcomes or size.
    </div>

    <div class="panel">
      <div class="controls" id="filters"></div>
      <div class="controls">
        <label class="control-label" for="psearch">Find a provider</label>
        <input class="chip" id="psearch" type="search" placeholder="trading name or CRICOS code" style="flex:1 1 260px;max-width:420px" />
      </div>
      <div id="psearch-results"></div>
      <div class="legend">
        <span class="legend-title">Reading the plot</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--d-mid);border-radius:50%"></span>a provider — dot area is registered capacity, a legal ceiling</span>
        <span class="legend-item"><span class="legend-swatch" style="background:none;border:1.5px solid var(--ink);border-radius:50%"></span>Government (${num(m.counts.govProviders)} of ${num(m.counts.providerCount)})</span>
      </div>
    </div>
    <div class="panel"><div class="chart-host" id="scatter"></div></div>
    <div class="panel">
      <div class="panel-head"><h3>Consistently dearer, or dearer on some things?</h3>
        <span class="muted">providers with at least five comparable qualifications</span></div>
      <p class="small muted">A provider's position inside each nationally coded qualification it sells, in
        ${gloss('percentile')} space. This is the only honest way to call a provider "expensive": it uses only
        qualifications where a genuinely identical peer group exists.</p>
      <div id="ranked"></div>
    </div>`;

  const scatterHost = host.querySelector<HTMLElement>('#scatter')!;
  const filters = host.querySelector<HTMLElement>('#filters')!;
  const rankedHost = host.querySelector<HTMLElement>('#ranked')!;
  const psearch = host.querySelector<HTMLInputElement>('#psearch')!;
  const presults = host.querySelector<HTMLElement>('#psearch-results')!;

  psearch.addEventListener('input', () => {
    const q = psearch.value.trim().toLowerCase();
    if (q.length < 2) { presults.innerHTML = ''; return; }
    const hits = all.filter((p) =>
      providerLabel(p).toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 12);
    presults.innerHTML = hits.length
      ? `<div class="controls">${hits.map((p) => `<button type="button" class="chip" data-open="${p.i}">${esc(truncEsc(providerLabel(p), 40))}<span class="n">${esc(p.code)}</span></button>`).join('')}</div>`
      : `<p class="small muted">No registered provider matches “${esc(psearch.value)}”. Try the trading name from your offer letter, or its CRICOS provider code.</p>`;
    for (const b of presults.querySelectorAll<HTMLElement>('[data-open]')) {
      b.addEventListener('click', () => { void openProvider(Number(b.dataset.open)); });
    }
  });

  function drawFilters(): void {
    filters.innerHTML = '<span class="control-label">Type</span>'
      + ([['all', 'all providers'], ['P', 'private'], ['G', 'government']] as [Filter, string][])
        .map(([id, l]) => `<button type="button" class="chip" data-type="${id}" aria-pressed="${typeFilter === id}">${l}</button>`).join('')
      + '<span class="control-label">State</span>'
      + `<button type="button" class="chip" data-state="" aria-pressed="${!stateFilter}">all</button>`
      + states.map((s) => `<button type="button" class="chip" data-state="${s}" aria-pressed="${stateFilter === s}">${s}</button>`).join('');
    for (const b of filters.querySelectorAll<HTMLElement>('[data-type]')) {
      b.addEventListener('click', () => { typeFilter = b.dataset.type as Filter; sync(); drawFilters(); draw(); });
    }
    for (const b of filters.querySelectorAll<HTMLElement>('[data-state]')) {
      b.addEventListener('click', () => { stateFilter = b.dataset.state ?? ''; sync(); drawFilters(); draw(); });
    }
  }

  const sync = () => setParams({ type: typeFilter === 'all' ? null : typeFilter, state: stateFilter || null });

  function visible(): Provider[] {
    return all.filter((p) =>
      (typeFilter === 'all' || p.type === typeFilter)
      && (!stateFilter || p.states.includes(stateFilter)));
  }

  function draw(): void {
    const rows = visible();
    scatterHost.innerHTML = '';
    if (!rows.length) {
      scatterHost.innerHTML = `<div class="empty-state"><strong>No provider matches.</strong>No ${typeFilter === 'G' ? 'government' : typeFilter === 'P' ? 'private' : ''} provider has a campus in ${stateFilter || 'Australia'}.</div>`;
      return;
    }
    scatterHost.append(scatter(rows));
    attachSvgZoom(scatterHost.querySelector('svg')!, { maxScale: 10 });
  }

  drawFilters();
  draw();

  const { codes } = await loadCompare();
  const pctByProvider = new Map<number, number[]>();
  for (const entry of codes) {
    if (entry.providers < 3) continue;
    const clean = entry.rows.filter((r) => !r.s);
    if (clean.length < 3) continue;
    const sorted = clean.map((r) => r.pw).sort((a, b) => a - b);
    for (const r of clean) {
      const pct = (sorted.filter((v) => v <= r.pw).length / sorted.length) * 100;
      if (!pctByProvider.has(r.p)) pctByProvider.set(r.p, []);
      pctByProvider.get(r.p)!.push(pct);
    }
  }
  const ranked = [...pctByProvider.entries()]
    .filter(([, list]) => list.length >= 5)
    .map(([pi, list]) => {
      const sorted = list.slice().sort((a, b) => a - b);
      return {
        p: all[pi],
        n: list.length,
        med: quantile(sorted, 0.5) ?? 0,
        lo: quantile(sorted, 0.1) ?? 0,
        hi: quantile(sorted, 0.9) ?? 0,
      };
    })
    .sort((a, b) => b.med - a.med);

  rankedHost.innerHTML = `<div class="track-list">${ranked.slice(0, 40).map((r) => `
    <button type="button" class="track" data-open="${r.p.i}"
      data-tip="${tipAttr(
        providerLabel(r.p),
        `CRICOS provider ${r.p.code} · ${r.p.type === 'G' ? 'Government' : 'Private'}`,
        `${num(r.n)} of its ${num(r.p.live)} courses have an identical peer group elsewhere on the register`,
        `Median position: ${ordinal(r.med)} percentile · middle 80% between the ${ordinal(r.lo)} and ${ordinal(r.hi)}`,
        r.hi - r.lo < 30
          ? 'A narrow band: this provider prices consistently against its peers across everything it sells.'
          : 'A wide band: this provider prices each qualification on its own rather than following one policy.',
        `Median tuition ${r.p.med == null ? 'not recorded' : perWeek(r.p.med)}`,
        'Click to open this provider',
      )}">
      <span class="track-label">${truncEsc(providerLabel(r.p), 40)}</span>
      <span class="track-rail">
        <span class="track-band" style="left:${r.lo.toFixed(1)}%;width:${Math.max(1, r.hi - r.lo).toFixed(1)}%"></span>
        <span class="track-median" style="left:50%"></span>
        <span class="track-dot" style="left:${r.med.toFixed(1)}%"></span>
      </span>
      <span class="track-value num">${ordinal(r.med)}</span>
    </button>`).join('')}</div>
    <p class="small muted">${num(ranked.length)} providers sell at least five nationally coded qualifications that
      somebody else also sells. The 40 with the highest median position are shown. A dot at the far right means this
      provider is consistently near the top of the price range for the identical qualification —
      <strong>which is a fact about its fees and about nothing else</strong>.</p>`;

  for (const b of rankedHost.querySelectorAll<HTMLElement>('[data-open]')) {
    b.addEventListener('click', () => { void openProvider(Number(b.dataset.open)); });
  }
}

function scatter(rows: Provider[]): SVGSVGElement {
  const W = 1000;
  const H = 560;
  const M = { top: 20, right: 26, bottom: 92, left: 68 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const svg = chartSvg(W, H, 'Every registered provider by campuses and catalogue breadth');
  const g = group(M.left, M.top);
  svg.append(g);

  const maxCampus = Math.max(...rows.map((p) => p.campuses), 2);
  const maxCourses = Math.max(...rows.map((p) => p.live), 2);
  // Log on both axes: the population runs from one campus and one course to 208
  // campuses and hundreds of courses, and linear axes would pile 90% of it into
  // one corner.
  const lx = (v: number) => Math.log10(Math.max(1, v));
  const x = linear([0, lx(maxCampus)], [0, plotW]);
  const y = linear([0, lx(maxCourses)], [plotH, 0]);

  const xTicks = [1, 2, 5, 10, 25, 50, 100, 208].filter((t) => t <= maxCampus * 1.1);
  const yTicks = [1, 3, 10, 30, 100, 300, 1000].filter((t) => t <= maxCourses * 1.1);

  for (const t of yTicks) {
    g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(lx(t)), y2: y(lx(t)), class: 'grid-line' }));
    g.append(text(-8, y(lx(t)) + 4, num(t), { 'text-anchor': 'end', class: 'axis-label' }));
  }
  for (const t of xTicks) {
    g.append(svgEl('line', { x1: x(lx(t)), x2: x(lx(t)), y1: 0, y2: plotH, class: 'grid-line' }));
    g.append(text(x(lx(t)), plotH + 18, num(t), { 'text-anchor': 'middle', class: 'axis-label' }));
  }
  g.append(text(plotW / 2, plotH + 40, 'campuses on the register (log scale)', { 'text-anchor': 'middle', class: 'axis-title' }));
  g.append(text(0, -6, 'courses on the register (log scale)', { class: 'axis-title' }));

  // Quadrant guides at the medians, with DESCRIPTIVE labels — never evaluative.
  const medCampus = quantile(rows.map((p) => p.campuses).sort((a, b) => a - b), 0.5) ?? 1;
  const medCourses = quantile(rows.map((p) => p.live).sort((a, b) => a - b), 0.5) ?? 1;
  g.append(svgEl('line', { x1: x(lx(medCampus)), x2: x(lx(medCampus)), y1: 0, y2: plotH, stroke: 'var(--rule-strong)', 'stroke-dasharray': '3 3' }));
  g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(lx(medCourses)), y2: y(lx(medCourses)), stroke: 'var(--rule-strong)', 'stroke-dasharray': '3 3' }));
  g.append(text(4, 14, 'one site, wide catalogue', { class: 'axis-label', fill: 'var(--ink-3)' }));
  // Kept clear of the top-right corner, where the zoom controls live.
  g.append(text(plotW - 46, 30, 'many sites, wide catalogue', { class: 'axis-label', fill: 'var(--ink-3)', 'text-anchor': 'end' }));
  g.append(text(4, plotH - 6, 'one site, narrow catalogue', { class: 'axis-label', fill: 'var(--ink-3)' }));
  g.append(text(plotW - 4, plotH - 6, 'many sites, narrow catalogue', { class: 'axis-label', fill: 'var(--ink-3)', 'text-anchor': 'end' }));

  // Deterministic jitter breaks integer ties. Seeded by the provider code, so
  // two renders of the same data produce identical, assertable positions.
  const rnd = mulberry32(0xc0de);
  const jitter = rows.map(() => (rnd() - 0.5) * 4);

  const noCourses: Provider[] = [];
  rows.forEach((p, i) => {
    if (p.live < 1) { noCourses.push(p); return; }
    const r = p.capacity == null ? 3 : Math.max(3, Math.min(20, Math.sqrt(p.capacity) * 0.22));
    const dot = tipped(svgEl('circle', {
      cx: x(lx(p.campuses)) + jitter[i], cy: y(lx(p.live)) + jitter[i], r,
      fill: 'var(--d-mid)', 'fill-opacity': 0.66,
      class: `mark${p.type === 'G' ? ' gov' : ''}`, tabindex: 0, role: 'button',
    }), [
      providerLabel(p),
      p.trading && p.trading !== p.name ? `Institution name: ${p.name}` : '',
      `CRICOS provider ${p.code} · ${p.type === 'G' ? 'Government' : 'Private'}`,
      `${num(p.campuses)} campuses in ${p.states.join(', ') || 'no recorded state'}`,
      `${num(p.live)} courses on the register · ${num(p.nat.length)} of them nationally coded`,
      p.med == null ? 'No believable price recorded' : `Median tuition ${perWeek(p.med)} (${perWeek(p.min)} – ${perWeek(p.max)})`,
      p.capacity == null
        ? 'Registered capacity not recorded'
        : `Registered capacity ${num(p.capacity)} — the maximum number of overseas students this provider may have at once. A legal ceiling, NOT a headcount; CRICOS publishes no enrolment data.`,
      'Click to open this provider',
    ]);
    dot.addEventListener('click', () => { void openProvider(p.i); });
    dot.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); void openProvider(p.i); }
    });
    g.append(dot);
  });

  // Providers with no current course would vanish under the log transform, so
  // they get their own labelled baseline strip instead of being dropped.
  if (noCourses.length) {
    // The label goes on its own line above the dots. Sharing a line put the
    // first dot on top of the last word.
    const stripY = plotH + 52;
    g.append(text(0, stripY, `${num(noCourses.length)} providers are registered but currently list no course:`,
      { class: 'axis-label' }));
    noCourses.forEach((p, i) => {
      const dot = tipped(svgEl('circle', {
        cx: 6 + (i % 60) * 11, cy: stripY + 15, r: 3.5,
        fill: 'var(--ink-3)', class: `mark${p.type === 'G' ? ' gov' : ''}`,
      }), [providerLabel(p), `CRICOS provider ${p.code}`, 'Registered, with no course currently on the register', 'Click to open this provider']);
      dot.addEventListener('click', () => { void openProvider(p.i); });
      g.append(dot);
    });
  }

  return svg;
}
