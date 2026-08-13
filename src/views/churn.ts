// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Providers arriving on and leaving the register, month by month.
//
// Only the CURRENT snapshot of CRICOS is normally published; this series exists
// because the pipeline keeps a digest of all sixty monthly extracts. Two rules
// hold the whole view together:
//
//   * Arrivals go above the axis and departures below, never netted into one
//     line. A month with 20 in and 20 out looks identical to a dead month once
//     you net them, and those are completely different months.
//   * A missing month is drawn as a GAP with the line broken, never zero-filled
//     and never interpolated. Zero-filling May 2022 would draw a month in which
//     every provider in Australia deregistered.
//
// And a refusal: the register does not record WHY a provider left. A departure
// here is not a closure, a collapse or a regulatory action, and this view never
// calls it one.

import { chartSvg, group, linear, svgEl, text, ticks, tipped } from '../components/svg';
import { esc, monthLabel, num, perWeek } from '../format';
import { loadChurn, loadCompare, meta } from '../data';
import { gloss } from '../glossary';
import { currentRoute, setParams } from '../router';
import type { ChurnPoint } from '../types';

export async function renderChurn(host: HTMLElement): Promise<void> {
  const churn = await loadChurn();
  const { codes } = await loadCompare();
  const route = currentRoute();
  let priceCode = route.params.get('code') ?? 'BSB50420';

  const real = churn.series.filter((p) => !p.gap);
  const first = real[0];
  const last = real[real.length - 1];
  const biggestExit = real.reduce((a, b) => ((b.exited ?? 0) > (a.exited ?? 0) ? b : a), real[0]);

  host.innerHTML = `
    <div class="view-head">
      <h1>Who arrives on the register, and who leaves</h1>
      <p class="view-sub">Sixty monthly extracts of CRICOS, ${monthLabel(first.m)} to ${monthLabel(last.m)}. Only the
        current ${gloss('snapshot')} is normally published, so this is the one thing here that cannot be read off the
        official register. Registered providers went from ${num(first.providers)} to ${num(last.providers)} over the
        five years.</p>
    </div>

    <div class="standing-note">
      <strong>The register does not record why a provider leaves.</strong> A departure below the axis may be a closure,
      a merger, a rename under a new provider code, a voluntary withdrawal or a regulatory action — the published data
      cannot tell them apart, and this page never claims to.
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-value num">${num(last.providers)}</div><div class="stat-label">providers, ${monthLabel(last.m)}</div></div>
      <div class="stat"><div class="stat-value num">+${num((last.providers ?? 0) - (first.providers ?? 0))}</div><div class="stat-label">net change since ${monthLabel(first.m)}</div></div>
      <div class="stat"><div class="stat-value num">${num(real.reduce((n, p) => n + (p.entered ?? 0), 0))}</div><div class="stat-label">arrivals recorded</div></div>
      <div class="stat"><div class="stat-value num">${num(real.reduce((n, p) => n + (p.exited ?? 0), 0))}</div><div class="stat-label">departures recorded</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Arrivals and departures, month by month</h2>
        <span class="muted">above the axis: providers new to the register · below: providers no longer on it</span></div>
      <div class="chart-host" id="flow"></div>
      <p class="small muted">The largest single month of departures in the series is ${monthLabel(biggestExit.m)},
        with ${num(biggestExit.exited)} providers gone from one extract to the next.
        ${churn.gaps.length ? `${churn.gaps.map(monthLabel).join(' and ')} ${churn.gaps.length === 1 ? 'is' : 'are'} missing from the published extracts and drawn as a gap; the month after a gap reports no arrival or departure count at all, because a difference measured across a hole is not a monthly rate.` : ''}</p>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Providers on the register</h2>
        <span class="muted">the running total, with gaps left open</span></div>
      <div class="chart-host" id="total"></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>What one qualification has cost, month by month</h2>
        <span class="muted">median tuition per teaching week across every registered offering</span></div>
      <div class="controls" id="code-chips"></div>
      <div class="chart-host" id="price"></div>
      <p class="small muted">Only qualifications with at least ten registered offerings in a month get a median here.
        This tracks the median across whoever happens to be selling the qualification that month, so part of any movement
        is a change in the mix of sellers rather than any single provider changing its fee.</p>
    </div>`;

  drawFlow(host.querySelector<HTMLElement>('#flow')!, churn.series);
  drawTotal(host.querySelector<HTMLElement>('#total')!, churn.series);

  const available = Object.keys(churn.nat)
    .map((nat) => ({ nat, n: Object.keys(churn.nat[nat]).length, title: codes.find((c) => c.nat === nat)?.title ?? nat }))
    .sort((a, b) => (codes.find((c) => c.nat === b.nat)?.providers ?? 0) - (codes.find((c) => c.nat === a.nat)?.providers ?? 0))
    .slice(0, 14);
  if (!available.some((a) => a.nat === priceCode)) priceCode = available[0]?.nat ?? '';

  const chips = host.querySelector<HTMLElement>('#code-chips')!;
  function drawChips(): void {
    chips.innerHTML = '<span class="control-label">Qualification</span>' + available.map((a) =>
      `<button type="button" class="chip" data-code="${esc(a.nat)}" aria-pressed="${priceCode === a.nat}">${esc(a.nat)}</button>`).join('');
    for (const b of chips.querySelectorAll<HTMLElement>('[data-code]')) {
      b.addEventListener('click', () => {
        priceCode = b.dataset.code!;
        setParams({ code: priceCode });
        drawChips();
        drawPrice(host.querySelector<HTMLElement>('#price')!, churn, priceCode,
          codes.find((c) => c.nat === priceCode)?.title ?? priceCode);
      });
    }
  }
  drawChips();
  drawPrice(host.querySelector<HTMLElement>('#price')!, churn, priceCode,
    codes.find((c) => c.nat === priceCode)?.title ?? priceCode);

  void meta;
}

function drawFlow(host: HTMLElement, series: ChurnPoint[]): void {
  const W = 1000;
  const H = 340;
  const M = { top: 24, right: 20, bottom: 54, left: 54 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const mid = plotH / 2;

  const svg = chartSvg(W, H, 'Providers arriving on and leaving the register each month');
  const g = group(M.left, M.top);
  svg.append(g);

  const maxV = Math.max(10, ...series.map((p) => Math.max(p.entered ?? 0, p.exited ?? 0)));
  const y = linear([0, maxV], [0, mid - 6]);
  const bw = Math.max(4, (plotW / series.length) - 2);

  for (const t of ticks(0, maxV, 3)) {
    for (const sign of [1, -1]) {
      const yy = mid - sign * y(t);
      g.append(svgEl('line', { x1: 0, x2: plotW, y1: yy, y2: yy, class: 'grid-line' }));
      if (t > 0 || sign > 0) g.append(text(-8, yy + 4, num(t), { 'text-anchor': 'end', class: 'axis-label' }));
    }
  }
  g.append(svgEl('line', { x1: 0, x2: plotW, y1: mid, y2: mid, class: 'axis-line' }));
  g.append(text(0, -8, 'arrivals ▲   departures ▼', { class: 'axis-title' }));

  series.forEach((p, i) => {
    const x = (i / series.length) * plotW;
    if (p.gap) {
      // Absence gets its own hatch and its own words, never a zero bar.
      const band = tipped(svgEl('rect', {
        x, y: 0, width: bw + 2, height: plotH,
        fill: 'var(--absent)', class: 'mark',
      }), [monthLabel(p.m), 'No extract of the register was published for this month.', 'Drawn as a gap — not as zero.']);
      g.append(band);
      g.append(text(x + bw / 2, mid - 4, '?', { 'text-anchor': 'middle', class: 'axis-label', fill: 'var(--ink-3)' }));
      return;
    }
    if (p.entered == null || p.exited == null) {
      g.append(tipped(svgEl('rect', { x, y: mid - 3, width: bw, height: 6, fill: 'var(--rule-strong)', class: 'mark' }), [
        monthLabel(p.m),
        `${num(p.providers)} providers on the register`,
        'This month follows a gap in the published extracts, so no monthly arrival or departure count can be computed for it.',
      ]));
      return;
    }
    g.append(tipped(svgEl('rect', {
      x, y: mid - y(p.entered), width: bw, height: Math.max(1, y(p.entered)),
      fill: 'var(--p4)', class: 'mark',
    }), [
      monthLabel(p.m),
      `${num(p.entered)} providers newly on the register`,
      `${num(p.exited)} no longer on it`,
      `${num(p.providers)} registered in total · ${num(p.courses)} courses`,
    ]));
    g.append(tipped(svgEl('rect', {
      x, y: mid, width: bw, height: Math.max(1, y(p.exited)),
      fill: 'var(--flag)', class: 'mark',
    }), [
      monthLabel(p.m),
      `${num(p.exited)} providers no longer on the register`,
      `${num(p.entered)} newly on it`,
      'The register does not say why any of them left.',
    ]));
  });

  labelMonths(g, series, plotW, plotH);
  host.append(svg);
}

function drawTotal(host: HTMLElement, series: ChurnPoint[]): void {
  const W = 1000;
  const H = 300;
  const M = { top: 20, right: 20, bottom: 54, left: 60 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const svg = chartSvg(W, H, 'Providers on the register each month');
  const g = group(M.left, M.top);
  svg.append(g);

  const vals = series.map((p) => p.providers).filter((v): v is number => v != null);
  const lo = Math.floor((Math.min(...vals) * 0.98) / 50) * 50;
  const hi = Math.ceil((Math.max(...vals) * 1.02) / 50) * 50;
  const y = linear([lo, hi], [plotH, 0]);
  const x = (i: number) => (i / (series.length - 1)) * plotW;

  for (const t of ticks(lo, hi, 5)) {
    g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(t), y2: y(t), class: 'grid-line' }));
    g.append(text(-8, y(t) + 4, num(t), { 'text-anchor': 'end', class: 'axis-label' }));
  }

  // The path BREAKS at a gap: a line drawn straight through a hole asserts a
  // trajectory nobody measured.
  let d = '';
  series.forEach((p, i) => {
    if (p.providers == null) { d += ' '; return; }
    d += `${d.endsWith(' ') || d === '' ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.providers).toFixed(1)}`;
  });
  g.append(svgEl('path', { d: d.trim(), fill: 'none', stroke: 'var(--p5)', 'stroke-width': 2 }));

  series.forEach((p, i) => {
    if (p.providers == null) {
      g.append(tipped(svgEl('rect', { x: x(i) - 4, y: 0, width: 8, height: plotH, fill: 'var(--absent)', class: 'mark' }),
        [monthLabel(p.m), 'No extract published — the line is broken here rather than drawn through it.']));
      return;
    }
    g.append(tipped(svgEl('circle', { cx: x(i), cy: y(p.providers), r: 3.4, fill: 'var(--p6)', class: 'mark' }), [
      monthLabel(p.m),
      `${num(p.providers)} registered providers`,
      `${num(p.courses)} courses · ${num(p.campuses)} campuses`,
      p.byType ? Object.entries(p.byType).map(([k, v]) => `${k}: ${num(v)}`).join(' · ') : '',
    ]));
  });

  labelMonths(g, series, plotW, plotH);
  host.append(svg);
}

function drawPrice(host: HTMLElement, churn: { series: ChurnPoint[]; nat: Record<string, Record<string, number>> }, code: string, title: string): void {
  host.innerHTML = '';
  const seriesMap = churn.nat[code];
  if (!seriesMap) {
    host.innerHTML = `<div class="empty-state"><strong>No monthly price series for ${esc(code)}.</strong>
      A qualification needs at least ten registered offerings in a month to get a median here.</div>`;
    return;
  }

  const W = 1000;
  const H = 300;
  const M = { top: 24, right: 20, bottom: 54, left: 64 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const svg = chartSvg(W, H, `Median tuition per teaching week for ${title}`);
  const g = group(M.left, M.top);
  svg.append(g);

  const months = churn.series.map((p) => p.m);
  const vals = months.map((m) => seriesMap[m] ?? null);
  const present = vals.filter((v): v is number => v != null);
  const lo = Math.floor((Math.min(...present) * 0.9) / 10) * 10;
  const hi = Math.ceil((Math.max(...present) * 1.1) / 10) * 10;
  const y = linear([lo, hi], [plotH, 0]);
  const x = (i: number) => (i / (months.length - 1)) * plotW;

  for (const t of ticks(lo, hi, 5)) {
    g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(t), y2: y(t), class: 'grid-line' }));
    g.append(text(-8, y(t) + 4, `$${num(t)}`, { 'text-anchor': 'end', class: 'axis-label' }));
  }
  g.append(text(0, -8, `${code} — ${title}`, { class: 'axis-title' }));

  let d = '';
  vals.forEach((v, i) => {
    if (v == null) { d += ' '; return; }
    d += `${d.endsWith(' ') || d === '' ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  g.append(svgEl('path', { d: d.trim(), fill: 'none', stroke: 'var(--p5)', 'stroke-width': 2 }));

  vals.forEach((v, i) => {
    if (v == null) return;
    g.append(tipped(svgEl('circle', { cx: x(i), cy: y(v), r: 3.4, fill: 'var(--p6)', class: 'mark' }), [
      monthLabel(months[i]),
      `Median ${perWeek(v)} across every registered offering of ${code}`,
      'Part of any movement is a change in which providers are selling it, not a fee change.',
    ]));
  });

  labelMonths(g, churn.series, plotW, plotH);
  host.append(svg);
}

function labelMonths(g: SVGGElement, series: ChurnPoint[], plotW: number, plotH: number): void {
  const every = Math.ceil(series.length / 10);
  series.forEach((p, i) => {
    if (i % every) return;
    g.append(text((i / Math.max(1, series.length - 1)) * plotW, plotH + 20, monthLabel(p.m),
      { 'text-anchor': 'middle', class: 'axis-label' }));
  });
}
