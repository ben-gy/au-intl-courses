// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// THE SIGNATURE VIEW. One nationally coded qualification, every registered
// offering of it as a dot, on a dollars-per-teaching-week axis.
//
// Why per week is the default and the sticker price is a toggle: the same
// national code is registered over anywhere from 31 to 130 weeks, so ranking on
// whole-of-course cost ranks course LENGTH as much as price. The "29× for the
// same piece of paper" headline that falls out of the sticker price is
// arithmetically true and substantively false. Flipping the toggle visibly
// scrambles the order, which is the argument for the default, and costs one
// control to make.

import { chartSvg, group, linear, svgEl, text, ticks, tipped } from '../components/svg';
import { beeswarm } from '../utils/layout';
import {
  DURATION_COLOURS, DURATION_LABELS, percentileOf, quantile, tercile,
} from '../scales';
import { esc, money, num, perWeek, providerLabel, tipAttr, truncEsc, weeks } from '../format';
import { fieldName, levelName, loadCompare, meta, provider, trainingPackage } from '../data';
import { gloss } from '../glossary';
import { currentRoute, setParams } from '../router';
import { openProvider } from '../components/drawers';
import type { CompareCode } from '../types';

const MAX_CODES = 4;
/** The largest cross-provider markets — the ones a reader is most likely in. */
const QUICK = ['BSB80120', 'BSB50420', 'SIT50422', 'SIT40521', 'BSB60420', 'BSB50120', 'SIT60322', 'SIT30821', 'CHC52025', 'CHC33021', 'ICT60220', 'CPC30220'];

type Unit = 'week' | 'course';

interface QuoteState { value: number | null; unit: Unit; weeks: number | null }

let quote: QuoteState = { value: null, unit: 'week', weeks: null };

export async function renderSameQualification(host: HTMLElement): Promise<void> {
  const { codes } = await loadCompare();
  const comparable = codes.filter((c) => c.providers >= 2);
  const byNat = new Map(codes.map((c) => [c.nat, c]));

  const route = currentRoute();
  const requested = (route.params.get('code') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let selected = requested.filter((c) => byNat.has(c)).slice(0, MAX_CODES);
  if (!selected.length) selected = [meta().headline?.nat ?? comparable[0]?.nat ?? ''].filter(Boolean);

  let unit: Unit = (route.params.get('unit') === 'course' ? 'course' : 'week');

  host.innerHTML = `
    <div class="view-head">
      <h1>The same qualification, priced by ${num(comparable.length)} different sellers</h1>
      <p class="view-sub">A ${gloss('VET national code')} means the qualification is nationally defined: the same units,
        the same training package, the same certificate at the end, whoever you pay. So the price is a genuine
        like-for-like comparison — and it is the only place on this register where one exists.</p>
    </div>

    <div class="standing-note">
      <strong>CRICOS records no enrolments, no completions, no student satisfaction and no quality measure.</strong>
      A cheaper provider here is not a worse one, and a dearer one is not better. These are the fees each provider has
      registered with the Commonwealth.
    </div>

    <div class="panel">
      <div class="controls" id="quick-chips"></div>
      <div class="controls">
        <label class="control-label" for="code-search">Find a qualification</label>
        <input class="chip" id="code-search" type="search" placeholder="carpentry, community services, BSB50420…" style="flex:1 1 260px;max-width:420px" />
        <span class="control-label">Show as</span>
        <button type="button" class="chip" id="unit-week" aria-pressed="${unit === 'week'}">$ per teaching week</button>
        <button type="button" class="chip" id="unit-course" aria-pressed="${unit === 'course'}">Whole course total</button>
      </div>
      <div id="code-results"></div>
    </div>

    <div class="panel" id="quote-panel">
      <div class="panel-head"><h3>Were you quoted a price?</h3></div>
      <div class="controls">
        <label class="control-label" for="quote-value">Amount (A$)</label>
        <input class="chip" id="quote-value" type="number" inputmode="decimal" min="0" placeholder="e.g. 14500" style="width:150px" />
        <button type="button" class="chip" id="quote-week" aria-pressed="true">per week</button>
        <button type="button" class="chip" id="quote-course" aria-pressed="false">whole course</button>
        <label class="control-label" for="quote-weeks" id="quote-weeks-label" hidden>over how many weeks?</label>
        <input class="chip" id="quote-weeks" type="number" inputmode="numeric" min="1" placeholder="weeks" style="width:110px" hidden />
        <button type="button" class="btn ghost" id="quote-clear">Clear</button>
      </div>
      <p class="small muted" id="quote-msg">This stays in your browser. It is not saved, not sent anywhere, and never
        appears in the page address.</p>
    </div>

    <div id="plots"></div>`;

  const plots = host.querySelector<HTMLElement>('#plots')!;
  const chips = host.querySelector<HTMLElement>('#quick-chips')!;
  const results = host.querySelector<HTMLElement>('#code-results')!;
  const search = host.querySelector<HTMLInputElement>('#code-search')!;

  const sync = () => setParams({ code: selected.join(','), unit: unit === 'course' ? 'course' : null });

  function drawChips(): void {
    chips.innerHTML = `<span class="control-label">Most-sold qualifications</span>` + QUICK
      .filter((nat) => byNat.has(nat))
      .map((nat) => {
        const c = byNat.get(nat)!;
        return `<button type="button" class="chip" data-code="${esc(nat)}" aria-pressed="${selected.includes(nat)}"
          data-tip="${tipAttr(`${c.nat} — ${c.title}`, `${num(c.providers)} providers, ${num(c.offers)} registered offerings`)}">
          ${esc(nat)}<span class="n">${num(c.providers)}</span></button>`;
      }).join('');
    for (const b of chips.querySelectorAll<HTMLElement>('[data-code]')) {
      b.addEventListener('click', () => toggle(b.dataset.code!));
    }
  }

  function toggle(nat: string): void {
    if (selected.includes(nat)) {
      if (selected.length === 1) return; // never leave the view with nothing to read
      selected = selected.filter((c) => c !== nat);
    } else {
      if (selected.length >= MAX_CODES) {
        results.innerHTML = `<p class="small caution-note">Four qualifications is the most that stay readable on one
          shared axis. Remove one first — click a row label, or a highlighted chip.</p>`;
        return;
      }
      selected = [...selected, nat];
    }
    sync();
    drawChips();
    draw();
  }

  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { results.innerHTML = ''; return; }
      const hits = comparable.filter((c) =>
        c.nat.toLowerCase().startsWith(q) || c.title.toLowerCase().includes(q)).slice(0, 24);
      if (!hits.length) {
        results.innerHTML = `<p class="small muted">No nationally coded qualification matches “${esc(search.value)}”.
          Try the qualification title — for example “hospitality”, “carpentry” or “community services”. Only
          qualifications with a ${gloss('VET national code')} can be compared this way; degrees are not nationally coded.</p>`;
        return;
      }
      results.innerHTML = `<div class="controls">${hits.map((c) => `
        <button type="button" class="chip" data-code="${esc(c.nat)}" aria-pressed="${selected.includes(c.nat)}">
          <span class="mono">${esc(c.nat)}</span> ${truncEsc(c.title, 44)}<span class="n">${num(c.providers)}</span></button>`).join('')}</div>`;
      for (const b of results.querySelectorAll<HTMLElement>('[data-code]')) {
        b.addEventListener('click', () => toggle(b.dataset.code!));
      }
    }, 200);
  });

  for (const id of ['week', 'course'] as Unit[]) {
    host.querySelector<HTMLElement>(`#unit-${id}`)!.addEventListener('click', () => {
      unit = id;
      host.querySelector('#unit-week')!.setAttribute('aria-pressed', String(unit === 'week'));
      host.querySelector('#unit-course')!.setAttribute('aria-pressed', String(unit === 'course'));
      sync();
      draw();
    });
  }

  /* ── the quote box. Nothing here ever leaves the browser. ── */
  const qValue = host.querySelector<HTMLInputElement>('#quote-value')!;
  const qWeeks = host.querySelector<HTMLInputElement>('#quote-weeks')!;
  const qWeeksLabel = host.querySelector<HTMLElement>('#quote-weeks-label')!;
  const qMsg = host.querySelector<HTMLElement>('#quote-msg')!;
  const qWeekBtn = host.querySelector<HTMLElement>('#quote-week')!;
  const qCourseBtn = host.querySelector<HTMLElement>('#quote-course')!;

  function readQuote(): void {
    const v = Number(qValue.value);
    const w = Number(qWeeks.value);
    quote = {
      value: Number.isFinite(v) && v > 0 ? v : null,
      unit: qCourseBtn.getAttribute('aria-pressed') === 'true' ? 'course' : 'week',
      weeks: Number.isFinite(w) && w > 0 ? w : null,
    };
    const needsWeeks = quote.unit === 'course';
    qWeeks.hidden = !needsWeeks;
    qWeeksLabel.hidden = !needsWeeks;
    if (quote.value != null && needsWeeks && quote.weeks == null) {
      qMsg.textContent = 'We need the number of weeks to compare — the same qualification is registered over wildly different lengths, so a total on its own cannot be placed.';
      qMsg.className = 'small caution-note';
    } else {
      qMsg.innerHTML = 'This stays in your browser. It is not saved, not sent anywhere, and never appears in the page address.';
      qMsg.className = 'small muted';
    }
    draw();
  }
  qValue.addEventListener('input', readQuote);
  qWeeks.addEventListener('input', readQuote);
  qWeekBtn.addEventListener('click', () => {
    qWeekBtn.setAttribute('aria-pressed', 'true');
    qCourseBtn.setAttribute('aria-pressed', 'false');
    readQuote();
  });
  qCourseBtn.addEventListener('click', () => {
    qWeekBtn.setAttribute('aria-pressed', 'false');
    qCourseBtn.setAttribute('aria-pressed', 'true');
    readQuote();
  });
  host.querySelector<HTMLElement>('#quote-clear')!.addEventListener('click', () => {
    qValue.value = ''; qWeeks.value = '';
    readQuote();
  });

  function quotePerWeek(): number | null {
    if (quote.value == null) return null;
    if (quote.unit === 'week') return quote.value;
    if (quote.weeks == null || quote.weeks <= 0) return null;
    return quote.value / quote.weeks;
  }

  function draw(): void {
    const entries = selected.map((nat) => byNat.get(nat)!).filter(Boolean);
    plots.innerHTML = '';
    if (!entries.length) {
      plots.innerHTML = '<div class="empty-state"><strong>Nothing selected.</strong>Pick a qualification above.</div>';
      return;
    }
    // One shared domain across every selected row: a per-row axis would make a
    // $154–$296 code and a $195–$337 code look identically wide.
    const values = entries.flatMap((e) => e.rows.map((r) => (unit === 'week' ? r.pw : r.t)));
    const cap = quantile(values.slice().sort((a, b) => a - b), 0.995) ?? 1;
    const qpw = quotePerWeek();
    const quoteValue = unit === 'week' ? qpw : (quote.unit === 'course' ? quote.value : null);
    const domainMax = Math.max(cap, quoteValue ?? 0) * 1.04;
    const step = unit === 'week' ? 25 : 2500;
    const xMax = Math.max(step * 4, Math.ceil(domainMax / step) * step);

    if (unit === 'course') {
      const note = document.createElement('div');
      note.className = 'caution-note';
      note.innerHTML = `<strong>Whole-course totals are not comparable between providers.</strong>
        ${entries.map((e) => `${esc(e.nat)} is registered over ${e.weeks.min}–${e.weeks.max} weeks`).join('; ')}.
        Several of the cheapest offerings on this axis are simply the shortest courses. Switch back to
        ${gloss('per teaching week')} to compare like with like.`;
      plots.append(note);
    }

    for (const entry of entries) {
      plots.append(plotRow(entry, unit, xMax, entries.length > 1, qpw, quote, () => { toggle(entry.nat); }));
    }

    const foot = document.createElement('p');
    foot.className = 'small muted';
    foot.innerHTML = `${num(comparable.length)} nationally coded qualifications on the register have two or more
      providers and can be compared this way. A further ${num(codes.length - comparable.length)} carry a national code
      but only one registered seller, so there is nothing to compare them against.
      ${meta().counts.suspectCount} offerings across the whole register are drawn hollow as
      ${gloss('suspected misreporting')}; they are counted in every percentile and barred from every “cheapest” claim.`;
    plots.append(foot);
  }

  drawChips();
  draw();
  sync();
}

function plotRow(
  entry: CompareCode, unit: Unit, xMax: number, shared: boolean,
  quotePw: number | null, quoteState: QuoteState, onRemove: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'panel qual-row';

  const pack = trainingPackage(entry.nat);
  const cheapest = entry.rows.find((r) => !r.s);

  wrap.innerHTML = `
    <div class="panel-head">
      <h2><button type="button" class="row-link mono" data-remove>${esc(entry.nat)}</button> ${esc(entry.title)}</h2>
      <span class="muted">${num(entry.providers)} providers · ${num(entry.offers)} registered offerings ·
        ${esc(levelName(entry.level))} · ${esc(fieldName(entry.bf))}${pack ? ` · ${esc(pack)} training package` : ''}</span>
    </div>
    <p class="small muted">Registered over ${entry.weeks.min}–${entry.weeks.max} weeks
      (median ${num(entry.weeks.med)}). Per teaching week: ${perWeek(entry.pw.p10)} at the 10th percentile,
      ${perWeek(entry.pw.med)} median, ${perWeek(entry.pw.p90)} at the 90th —
      <strong>${entry.pw.p10 && entry.pw.p90 ? `${(entry.pw.p90 / entry.pw.p10).toFixed(1)}×` : '—'}</strong> between the two.
      ${cheapest ? `Cheapest believable offering: ${perWeek(cheapest.pw)} at ${esc(providerLabel(provider(cheapest.p)))}.` : ''}</p>
  `;

  wrap.querySelector<HTMLElement>('[data-remove]')!.addEventListener('click', onRemove);

  const chartHost = document.createElement('div');
  chartHost.className = 'chart-host';
  wrap.append(chartHost);
  chartHost.append(swarm(entry, unit, xMax, shared, quotePw, quoteState));

  const details = document.createElement('details');
  details.className = 'duration-panel';
  details.innerHTML = `<summary>Cost against course length, for ${esc(entry.nat)}</summary>`;
  const dHost = document.createElement('div');
  dHost.className = 'chart-host';
  details.append(dHost);
  details.addEventListener('toggle', () => {
    if (details.open && !dHost.childElementCount) dHost.append(durationPlot(entry));
  }, { once: false });
  wrap.append(details);

  return wrap;
}

function swarm(
  entry: CompareCode, unit: Unit, xMax: number, shared: boolean,
  quotePw: number | null, quoteState: QuoteState,
): SVGSVGElement {
  // The viewBox is sized to the VIEWPORT, not fixed at 1000.
  //
  // A 1000-unit viewBox rendered into a 335px phone column scales everything by
  // 0.335, which turns a 4.2-unit dot into a 2.7px mark: too small to read and
  // far too small to tap. Sizing the viewBox near 1:1 on a narrow screen keeps
  // a dot the size it was designed to be.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760;
  const W = narrow ? Math.max(320, Math.min(700, window.innerWidth - 56)) : 1000;
  const M = narrow
    ? { top: 26, right: 26, bottom: 40, left: 6 }
    : { top: 30, right: 34, bottom: 44, left: 12 };
  const halfH = narrow ? 74 : 62;
  const H = M.top + halfH * 2 + M.bottom;
  const plotW = W - M.left - M.right;

  const svg = chartSvg(W, H, `${entry.title}: every registered offering by ${unit === 'week' ? 'tuition per teaching week' : 'whole-of-course cost'}`);
  const g = group(M.left, M.top);
  svg.append(g);

  const x = linear([0, xMax], [0, plotW]);
  const baseY = halfH;

  const value = (r: { pw: number; t: number }) => (unit === 'week' ? r.pw : r.t);
  const inDomain = entry.rows.filter((r) => value(r) <= xMax);
  const above = entry.rows.filter((r) => value(r) > xMax);

  // The decile fan sits behind every dot: p10–p90 wide, p25–p75 inside it.
  const q = unit === 'week'
    ? entry.pw
    : (() => {
      const t = entry.rows.filter((r) => !r.s).map((r) => r.t).sort((a, b) => a - b);
      return {
        min: t[0] ?? null, p10: quantile(t, 0.1), p25: quantile(t, 0.25), med: quantile(t, 0.5),
        p75: quantile(t, 0.75), p90: quantile(t, 0.9), max: t[t.length - 1] ?? null,
      };
    })();

  const fmt = (v: number | null) => (unit === 'week' ? perWeek(v) : money(v));

  if (q.p10 != null && q.p90 != null) {
    g.append(tipped(svgEl('rect', {
      x: x(q.p10), y: 0, width: Math.max(1, x(q.p90) - x(q.p10)), height: halfH * 2,
      fill: 'var(--p1)', class: 'mark',
    }), [
      'The middle 80% of offerings',
      `${fmt(q.p10)} (10th percentile) to ${fmt(q.p90)} (90th percentile)`,
      `across ${num(entry.offers)} registered offerings from ${num(entry.providers)} providers`,
    ]));
  }
  if (q.p25 != null && q.p75 != null) {
    g.append(tipped(svgEl('rect', {
      x: x(q.p25), y: 8, width: Math.max(1, x(q.p75) - x(q.p25)), height: halfH * 2 - 16,
      fill: 'var(--p2)', class: 'mark',
    }), [
      'The middle half of offerings',
      `${fmt(q.p25)} (25th percentile) to ${fmt(q.p75)} (75th percentile)`,
    ]));
  }
  if (q.med != null) {
    g.append(tipped(svgEl('line', {
      x1: x(q.med), x2: x(q.med), y1: -4, y2: halfH * 2 + 4,
      stroke: 'var(--p6)', 'stroke-width': 2, class: 'mark',
    }), [`Median: ${fmt(q.med)}`, 'half the registered offerings cost less than this']));
    g.append(text(x(q.med), -10, `median ${fmt(q.med)}`, { 'text-anchor': 'middle', class: 'axis-title', fill: 'var(--p6)' }));
  }

  // Duration terciles, computed inside THIS code's own distribution.
  const durations = entry.rows.map((r) => r.w).filter((w): w is number => w != null).sort((a, b) => a - b);
  const sortedPw = entry.rows.filter((r) => !r.s).map((r) => r.pw).sort((a, b) => a - b);

  const r = narrow ? 4.6 : 4.2;
  const packedIn = beeswarm(inDomain.map(value), (v) => x(v), r, halfH - r - 2);

  inDomain.forEach((row, idx) => {
    const pt = packedIn[idx];
    const p = provider(row.p);
    const t = row.w != null ? tercile(row.w, durations) : 1;
    const pctile = percentileOf(row.pw, sortedPw);
    const dot = svgEl('circle', {
      cx: pt.x, cy: baseY + pt.y, r,
      fill: row.s ? 'none' : DURATION_COLOURS[t],
      class: `mark${row.s ? ' flagged' : ''}${p.type === 'G' ? ' gov' : ''}`,
      tabindex: 0, role: 'button',
    });
    tipped(dot, [
      providerLabel(p),
      `CRICOS provider ${p.code} · ${p.type === 'G' ? 'Government' : 'Private'}`,
      row.st.length ? `Taught in ${row.st.join(', ')}` : 'No campus state recorded',
      '',
      `${money(row.t)} tuition + ${money(row.nt ?? 0)} non-tuition = ${money(row.t + (row.nt ?? 0))} ✓`,
      `over ${weeks(row.w)} = ${perWeek(row.pw)}`,
      '',
      row.s
        ? 'SUSPECTED MISREPORTING — below $60 per teaching week, against a register-wide 1st percentile of about $120. Shown exactly as published; excluded from every cheapest claim.'
        : `Dearer per week than ${Math.round(pctile)}% of the ${num(sortedPw.length)} believable offerings of ${entry.nat}`,
      'Click to open this provider',
    ]);
    dot.addEventListener('click', () => { void openProvider(row.p, { natCode: entry.nat }); });
    dot.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        void openProvider(row.p, { natCode: entry.nat });
      }
    });
    g.append(dot);
  });

  // Off-domain rows are pinned, counted and hoverable — never silently clipped.
  if (above.length) {
    const gutter = group(plotW + 6, baseY - 8);
    const marker = tipped(svgEl('text', { x: 0, y: 0, class: 'axis-title', fill: 'var(--p6)' }), [
      `${above.length} ${above.length === 1 ? 'offering costs' : 'offerings cost'} more than ${fmt(xMax)}`,
      ...above.slice(0, 8).map((row) => `${providerLabel(provider(row.p))} — ${fmt(value(row))}`),
      above.length > 8 ? `…and ${above.length - 8} more` : '',
    ]);
    marker.textContent = `▸${above.length}`;
    gutter.append(marker);
    g.append(gutter);
  }

  // The reader's own quote, in the one warm colour reserved for their numbers.
  const qv = unit === 'week' ? quotePw : (quoteState.unit === 'course' ? quoteState.value : null);
  if (qv != null && qv > 0 && qv <= xMax) {
    g.append(svgEl('line', {
      x1: x(qv), x2: x(qv), y1: -18, y2: halfH * 2 + 6,
      stroke: 'var(--you)', 'stroke-width': 2,
    }));
    const label = text(x(qv), -22, `your quote ${fmt(qv)}`, { 'text-anchor': 'middle', class: 'axis-title', fill: 'var(--you-ink)' });
    g.append(label);
  }

  // Axis.
  const axisY = halfH * 2 + 10;
  g.append(svgEl('line', { x1: 0, x2: plotW, y1: axisY, y2: axisY, class: 'axis-line' }));
  for (const t of ticks(0, xMax, narrow ? 4 : 7)) {
    g.append(svgEl('line', { x1: x(t), x2: x(t), y1: axisY, y2: axisY + 4, class: 'axis-line' }));
    g.append(text(x(t), axisY + 17, unit === 'week' ? `$${num(t)}` : money(t), { 'text-anchor': 'middle', class: 'axis-label' }));
  }
  g.append(text(plotW, axisY + 33, unit === 'week'
    ? `tuition per teaching week${shared ? ' — shared scale across every selected qualification' : ''}`
    : `whole-of-course tuition${shared ? ' — shared scale' : ''}`,
  { 'text-anchor': 'end', class: 'axis-title' }));

  return svg;
}

function durationPlot(entry: CompareCode): SVGSVGElement {
  const W = 1000;
  const H = 420;
  const M = { top: 22, right: 120, bottom: 52, left: 74 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const svg = chartSvg(W, H, `${entry.title}: whole-of-course cost against course length`);
  const g = group(M.left, M.top);
  svg.append(g);

  const wMin = Math.max(0, (entry.weeks.min ?? 1) * 0.9);
  const wMax = (entry.weeks.max ?? 100) * 1.06;
  const tMax = Math.max(...entry.rows.map((r) => r.t)) * 1.06;
  const x = linear([wMin, wMax], [0, plotW]);
  const y = linear([0, tMax], [plotH, 0]);

  // Gridlines.
  for (const t of ticks(0, tMax, 6)) {
    g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(t), y2: y(t), class: 'grid-line' }));
    g.append(text(-8, y(t) + 4, money(t), { 'text-anchor': 'end', class: 'axis-label' }));
  }
  for (const t of ticks(wMin, wMax, 6)) {
    g.append(text(x(t), plotH + 18, String(Math.round(t)), { 'text-anchor': 'middle', class: 'axis-label' }));
  }
  g.append(text(plotW / 2, plotH + 38, 'course length, in weeks as registered', { 'text-anchor': 'middle', class: 'axis-title' }));
  g.append(text(0, -8, 'whole-of-course tuition', { class: 'axis-title' }));

  // Iso-rate rays: on this plane a constant $/week IS a straight line through
  // the origin, so a point's ANGLE is its per-week price. This is the duration
  // confound made visible instead of asserted in copy.
  for (const [rate, label] of [[entry.pw.p10, '10th percentile'], [entry.pw.med, 'median'], [entry.pw.p90, '90th percentile']] as [number | null, string][]) {
    if (rate == null) continue;
    const xEnd = Math.min(wMax, tMax / rate);
    const line = tipped(svgEl('line', {
      x1: x(0), y1: y(0), x2: x(xEnd), y2: y(rate * xEnd),
      stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '4 3', class: 'mark',
    }), [
      `Every course on this line costs ${perWeek(rate)}`,
      `${label} of ${entry.nat}`,
      'A reference line, not a trend or a fit.',
    ]);
    g.append(line);
    g.append(text(Math.min(plotW + 4, x(xEnd) + 4), y(rate * xEnd), `${perWeek(rate)} — ${label}`,
      { class: 'axis-label', 'dominant-baseline': 'middle' }));
  }

  const durations = entry.rows.map((r) => r.w).filter((w): w is number => w != null).sort((a, b) => a - b);
  for (const row of entry.rows) {
    if (row.w == null) continue;
    const p = provider(row.p);
    const dot = svgEl('circle', {
      cx: x(row.w), cy: y(row.t), r: 4,
      fill: row.s ? 'none' : DURATION_COLOURS[tercile(row.w, durations)],
      class: `mark${row.s ? ' flagged' : ''}${p.type === 'G' ? ' gov' : ''}`,
      tabindex: 0, role: 'button',
    });
    tipped(dot, [
      providerLabel(p),
      `${money(row.t)} over ${weeks(row.w)} = ${perWeek(row.pw)}`,
      row.s ? 'Suspected misreporting — shown as published.' : '',
      'Click to open this provider',
    ]);
    dot.addEventListener('click', () => { void openProvider(row.p, { natCode: entry.nat }); });
    g.append(dot);
  }

  return svg;
}

/** The legend text every plot shares, rendered once by the view shell. */
export function durationLegend(): string {
  return DURATION_LABELS.map((l, i) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${DURATION_COLOURS[i]}"></span>${l}</span>`).join('');
}
