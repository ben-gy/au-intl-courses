// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every priced course on the register on one plane: cost against length.
//
// The point of this view is the ISO-RATE RAY. On a cost-versus-weeks plane a
// constant dollars-per-week is a straight line through the origin, so a point's
// ANGLE from the origin is its price per week. The duration confound stops
// being something the copy asserts and becomes something the reader sees.
//
// It is also the only view where the misreporting story is visible rather than
// stated: a $1,600 course over 104 weeks sits conspicuously below the lowest
// ray, right next to thousands of plausible neighbours.

import { chartSvg, group, linear, log10Scale, svgEl, text, ticks, tipped } from '../components/svg';
import { hexPath, hexbin } from '../utils/layout';
import { DENSITY_RAMP, SUSPECT_PER_WEEK, bucket, quantile } from '../scales';
import { esc, money, num, perWeek, providerLabel, truncEsc, weeks } from '../format';
import { fieldName, levelName, loadCourses, meta, provider } from '../data';
import { gloss } from '../glossary';
import { navigate, setParams, currentRoute } from '../router';
import { openCourse } from '../components/drawers';
import { F_EXPIRED, F_SUSPECT } from '../types';

const RAYS = [100, 250, 500, 1000, 2000];

export async function renderCostDuration(host: HTMLElement): Promise<void> {
  const courses = await loadCourses();
  const route = currentRoute();
  let highlight = route.params.get('code') ?? '';
  let fieldFilter = route.params.get('field') ?? '';

  const idx: number[] = [];
  for (let i = 0; i < courses.n; i++) {
    if (courses.total[i] == null || courses.weeks[i] == null || (courses.flags[i] & F_EXPIRED)) continue;
    idx.push(i);
  }

  const fields = [...new Set(idx.map((i) => courses.bf[i]))].sort((a, b) => fieldName(a).localeCompare(fieldName(b)));

  host.innerHTML = `
    <div class="view-head">
      <h1>How much of a price gap is just a longer course?</h1>
      <p class="view-sub">Every priced course on the register, plotted by what it costs in total against how many weeks
        it runs. The dashed lines are ${gloss('iso-rate ray', 'iso-rate rays')}: every course sitting on one costs the
        same per teaching week, however different its total looks. Two courses at the same height on this chart cost the
        same money — the one further right is the better deal per week.</p>
    </div>
    <div class="panel">
      <div class="controls" id="filters"></div>
      <div class="controls">
        <label class="control-label" for="hl">Highlight one national code</label>
        <input class="chip" id="hl" type="search" placeholder="BSB50420" value="${esc(highlight)}" style="width:170px" />
      </div>
      <div class="legend" id="legend"></div>
    </div>
    <div class="panel"><div class="chart-host" id="chart"></div></div>
    <div id="flagged"></div>`;

  const chart = host.querySelector<HTMLElement>('#chart')!;
  const filters = host.querySelector<HTMLElement>('#filters')!;
  const legend = host.querySelector<HTMLElement>('#legend')!;
  const flaggedHost = host.querySelector<HTMLElement>('#flagged')!;
  const hl = host.querySelector<HTMLInputElement>('#hl')!;

  filters.innerHTML = '<span class="control-label">Field of education</span>'
    + `<button type="button" class="chip" data-field="" aria-pressed="${!fieldFilter}">all fields</button>`
    + fields.map((f) => `<button type="button" class="chip" data-field="${f}" aria-pressed="${fieldFilter === String(f)}">${esc(fieldName(f))}</button>`).join('');
  for (const b of filters.querySelectorAll<HTMLElement>('[data-field]')) {
    b.addEventListener('click', () => {
      fieldFilter = b.dataset.field ?? '';
      for (const o of filters.querySelectorAll('[data-field]')) o.setAttribute('aria-pressed', String((o as HTMLElement).dataset.field === fieldFilter));
      setParams({ field: fieldFilter || null });
      draw();
    });
  }

  let hlTimer = 0;
  hl.addEventListener('input', () => {
    clearTimeout(hlTimer);
    hlTimer = window.setTimeout(() => {
      highlight = hl.value.trim().toUpperCase();
      setParams({ code: highlight || null });
      draw();
    }, 250);
  });

  legend.innerHTML = `
    <span class="legend-title">${DENSITY_RAMP.title}</span>
    ${DENSITY_RAMP.labels.map((l, i) => `<span class="legend-item"><span class="legend-swatch" style="background:${DENSITY_RAMP.colours[i]}"></span>${l}</span>`).join('')}
    <span class="legend-item"><span class="legend-swatch ring"></span>${gloss('suspected misreporting')}</span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--p6);border-radius:50%"></span>above $2,000/wk</span>`;

  function draw(): void {
    const rows = idx.filter((i) => !fieldFilter || String(courses.bf[i]) === fieldFilter);
    chart.innerHTML = '';
    flaggedHost.innerHTML = '';

    if (rows.length < 20) {
      chart.innerHTML = rows.length
        ? ''
        : `<div class="empty-state"><strong>No priced course matches that field.</strong>Remove the field filter to see the whole register.</div>`;
      if (!rows.length) return;
    }

    const W = 1000;
    const H = 560;
    const M = { top: 20, right: 150, bottom: 56, left: 74 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;

    const wMax = 440;
    const totals = rows.map((i) => courses.total[i]!).sort((a, b) => a - b);
    const yMin = Math.max(200, Math.floor((totals[0] ?? 1000) / 100) * 100);
    const yMax = (quantile(totals, 0.9995) ?? 100000) * 1.1;

    const svg = chartSvg(W, H, 'Every priced course by total cost and course length');
    const g = group(M.left, M.top);
    svg.append(g);

    const x = linear([0, wMax], [0, plotW]);
    const y = log10Scale([yMin, yMax], [plotH, 0]);

    // A log axis with sparse labels gets read as linear, so EVERY gridline is
    // labelled and the axis title says so out loud.
    const decades: number[] = [];
    for (let v = 1000; v <= yMax; v *= 10) for (const m of [1, 2, 5]) {
      const val = v * m;
      if (val >= yMin && val <= yMax) decades.push(val);
    }
    for (const v of decades) {
      g.append(svgEl('line', { x1: 0, x2: plotW, y1: y(v), y2: y(v), class: 'grid-line' }));
      g.append(text(-8, y(v) + 4, money(v), { 'text-anchor': 'end', class: 'axis-label' }));
    }
    for (const t of ticks(0, wMax, 6)) {
      g.append(text(x(t), plotH + 18, String(Math.round(t)), { 'text-anchor': 'middle', class: 'axis-label' }));
    }
    g.append(text(plotW / 2, plotH + 40, 'course length, in weeks as registered', { 'text-anchor': 'middle', class: 'axis-title' }));
    g.append(text(0, -6, 'estimated total course cost (log scale)', { class: 'axis-title' }));

    // Rays are sampled polylines: y is logarithmic, so a constant rate is a
    // curve on screen even though it is a straight line in the data.
    const ray = (rate: number, cls: string, label: string) => {
      const pts: string[] = [];
      for (let wk = 1; wk <= wMax; wk += 2) {
        const cost = rate * wk;
        if (cost < yMin || cost > yMax) continue;
        pts.push(`${x(wk).toFixed(1)},${y(cost).toFixed(1)}`);
      }
      if (pts.length < 2) return;
      const path = tipped(svgEl('polyline', {
        points: pts.join(' '), fill: 'none',
        stroke: cls === 'flag' ? 'var(--flag)' : 'var(--ink-3)',
        'stroke-width': cls === 'flag' ? 1.4 : 1,
        'stroke-dasharray': '5 4', class: 'mark',
      }), [
        cls === 'flag'
          ? `Below this line: suspected misreporting (under ${perWeek(SUSPECT_PER_WEEK)})`
          : `Every course on this line costs ${perWeek(rate)}`,
        'A reference line, not a trend or a fit.',
      ]);
      g.append(path);
      const last = pts[pts.length - 1].split(',').map(Number);
      g.append(text(Math.min(plotW + 5, last[0] + 5), last[1], label, {
        class: 'axis-label', 'dominant-baseline': 'middle',
        fill: cls === 'flag' ? 'var(--flag)' : 'var(--ink-3)',
      }));
    };
    for (const r of RAYS) ray(r, 'rate', `${perWeek(r)}`);
    ray(SUSPECT_PER_WEEK, 'flag', 'suspected misreporting');

    // The two tails are drawn as individual marks, because those are the two
    // places where the individual row is the point.
    const flagged: number[] = [];
    const topTail: number[] = [];
    const binnable: { x: number; y: number; i: number }[] = [];
    for (const i of rows) {
      const wk = courses.weeks[i]!;
      const tot = courses.total[i]!;
      const pw = courses.pw[i];
      const px = x(Math.min(wk, wMax));
      const py = y(Math.min(Math.max(tot, yMin), yMax));
      if (courses.flags[i] & F_SUSPECT) { flagged.push(i); continue; }
      if (pw != null && pw > 2000) { topTail.push(i); continue; }
      binnable.push({ x: px, y: py, i });
    }

    const radius = 7;
    const bins = hexbin(binnable, radius);
    const path = hexPath(radius);
    for (const bin of bins) {
      if (bin.cx < -radius || bin.cx > plotW + radius || bin.cy < -radius || bin.cy > plotH + radius) continue;
      const b = bucket(DENSITY_RAMP, bin.n);
      const sample = bin.items.slice(0, 3).map((i) => `${truncEsc(courses.name[i], 40).replace(/&amp;/g, '&')} — ${money(courses.total[i])} over ${weeks(courses.weeks[i])}`);
      const pws = bin.items.map((i) => courses.pw[i]).filter((v): v is number => v != null).sort((a, b2) => a - b2);
      const hex = tipped(svgEl('path', {
        d: path, transform: `translate(${bin.cx.toFixed(1)},${bin.cy.toFixed(1)})`,
        fill: DENSITY_RAMP.colours[b], stroke: 'var(--surface)', 'stroke-width': 0.5, class: 'mark',
      }), [
        `${num(bin.n)} course${bin.n === 1 ? '' : 's'} in this bin`,
        pws.length ? `Per teaching week: ${perWeek(quantile(pws, 0.25))} – ${perWeek(quantile(pws, 0.75))} (median ${perWeek(quantile(pws, 0.5))})` : '',
        '',
        ...sample,
        bin.n > 3 ? `…and ${num(bin.n - 3)} more` : '',
        'Click to list these courses',
      ]);
      hex.addEventListener('click', () => {
        const sampleI = bin.items[0];
        navigate('find-a-course', {
          field: courses.bf[sampleI],
          minw: Math.max(1, Math.round((courses.weeks[sampleI] ?? 1) * 0.85)),
          maxw: Math.round((courses.weeks[sampleI] ?? 1) * 1.15),
        });
      });
      g.append(hex);
    }

    for (const i of topTail) {
      const dot = tipped(svgEl('circle', {
        cx: x(Math.min(courses.weeks[i]!, wMax)), cy: y(Math.min(courses.total[i]!, yMax)), r: 3,
        fill: 'var(--p6)', class: 'mark',
      }), [
        truncEsc(courses.name[i], 60).replace(/&amp;/g, '&'),
        providerLabel(provider(courses.p[i])),
        `${money(courses.total[i])} over ${weeks(courses.weeks[i])} = ${perWeek(courses.pw[i])}`,
        'Click to open this course',
      ]);
      dot.addEventListener('click', () => { void openCourse(courses.code[i]); });
      g.append(dot);
    }

    for (const i of flagged) {
      const ring = tipped(svgEl('circle', {
        cx: x(Math.min(courses.weeks[i]!, wMax)), cy: y(Math.min(Math.max(courses.total[i]!, yMin), yMax)), r: 4,
        class: 'mark flagged',
      }), [
        truncEsc(courses.name[i], 60).replace(/&amp;/g, '&'),
        providerLabel(provider(courses.p[i])),
        `${money(courses.total[i])} over ${weeks(courses.weeks[i])} = ${perWeek(courses.pw[i])}`,
        'Suspected data-entry error in the register. Shown exactly as published and not corrected.',
        'Click to open this course',
      ]);
      ring.addEventListener('click', () => { void openCourse(courses.code[i]); });
      g.append(ring);
    }

    if (highlight) {
      const hits = rows.filter((i) => courses.nat[i] === highlight);
      for (const i of hits) {
        const dot = tipped(svgEl('circle', {
          cx: x(Math.min(courses.weeks[i]!, wMax)), cy: y(Math.min(Math.max(courses.total[i]!, yMin), yMax)), r: 4,
          fill: 'var(--you)', stroke: '#fff', 'stroke-width': 1, class: 'mark',
        }), [
          `${highlight} — ${providerLabel(provider(courses.p[i]))}`,
          `${money(courses.total[i])} over ${weeks(courses.weeks[i])} = ${perWeek(courses.pw[i])}`,
          'Click to open this course',
        ]);
        dot.addEventListener('click', () => { void openCourse(courses.code[i]); });
        g.append(dot);
      }
      if (!hits.length) {
        g.append(text(plotW / 2, 14, `No course on the register carries the national code “${highlight}”.`,
          { 'text-anchor': 'middle', class: 'axis-title', fill: 'var(--you-ink)' }));
      }
    }

    chart.append(svg);

    const foot = document.createElement('p');
    foot.className = 'small muted';
    foot.innerHTML = `${num(rows.length)} priced courses. ${num(flagged.length)} sit below
      ${perWeek(SUSPECT_PER_WEEK)} — ${gloss('suspected misreporting')} rather than a bargain, and drawn hollow so you can
      judge them yourself. ${num(topTail.length)} sit above $2,000 per teaching week.`;
    chart.append(foot);

    if (flagged.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ghost';
      btn.textContent = `List the ${flagged.length} implausibly cheap entries`;
      btn.addEventListener('click', () => {
        flaggedHost.innerHTML = `<div class="panel"><div class="panel-head"><h3>Registered fees below ${perWeek(SUSPECT_PER_WEEK)}</h3>
          <span class="muted">shown exactly as published — judge them yourself</span></div>
          <div class="table-scroll"><table><thead><tr><th>Course</th><th>Provider</th><th class="num">Total</th><th class="num">Weeks</th><th class="num">Per week</th></tr></thead><tbody>
          ${flagged.sort((a, b) => (courses.pw[a] ?? 0) - (courses.pw[b] ?? 0)).map((i) => `<tr class="clickable" data-course="${esc(courses.code[i])}">
            <td>${truncEsc(courses.name[i], 54)}<div class="small dim mono">${esc(courses.code[i])}</div></td>
            <td class="small">${esc(providerLabel(provider(courses.p[i])))}</td>
            <td class="num">${money(courses.total[i])}</td>
            <td class="num">${num(courses.weeks[i])}</td>
            <td class="num">${perWeek(courses.pw[i])}</td></tr>`).join('')}
        </tbody></table></div></div>`;
        for (const tr of flaggedHost.querySelectorAll<HTMLElement>('tr[data-course]')) {
          tr.addEventListener('click', () => { void openCourse(tr.dataset.course!); });
        }
      });
      chart.append(btn);
    }
  }

  draw();
  void levelName;
  void meta;
}
