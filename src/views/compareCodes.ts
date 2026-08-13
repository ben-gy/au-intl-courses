// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every comparable qualification as one range bar on ONE shared axis, so the
// primary visual quantity is how much providers DISAGREE about what the same
// thing is worth.
//
// A per-row axis would make a $154–$296 code and a $195–$337 code look
// identically wide, which is the exact opposite of the point. And a bar chart
// of "most popular qualifications by provider count" would answer a duller
// question while inviting the market-share misreading this register forbids.

import { chartSvg, group, linear, svgEl, text, ticks, tipped } from '../components/svg';
import { esc, num, perWeek, providerLabel, tipAttr, truncEsc } from '../format';
import { fieldName, levelName, loadCompare, provider, trainingPackage } from '../data';
import { gloss } from '../glossary';
import { navigate, setParams, currentRoute } from '../router';
import type { CompareCode } from '../types';

type Sort = 'providers' | 'dear' | 'cheap' | 'spread' | 'duration' | 'code';

/**
 * The thin-evidence gate, and it is a correctness requirement rather than
 * polish: a p90÷p10 ratio computed over two offerings is noise, and without
 * this it would own the entire top of the spread sort every time.
 */
const THIN = 5;

const MIN_CHOICES: [number, string][] = [[2, '2+'], [3, '3+'], [5, '5+'], [10, '10+'], [25, '25+'], [100, '100+']];

export async function renderCompareCodes(host: HTMLElement): Promise<void> {
  const { codes } = await loadCompare();
  const all = codes.filter((c) => c.providers >= 2);

  const route = currentRoute();
  let sort: Sort = (route.params.get('sort') as Sort) || 'providers';
  let minProviders = Number(route.params.get('min')) || 5;
  let fullRange = false;
  let includeThin = false;

  host.innerHTML = `
    <div class="view-head">
      <h1>Where providers disagree most about what the same thing is worth</h1>
      <p class="view-sub">One row per nationally coded qualification with more than one registered seller. The bar spans
        the 10th to the 90th percentile of ${gloss('per teaching week', 'tuition per teaching week')} — so a long bar means
        providers price the identical qualification very differently, and a short one means the market has settled.
        The grey bar beside it is the range of registered course LENGTHS, which is the other half of every price story here.</p>
    </div>
    <div class="panel">
      <div class="controls" id="sorts"></div>
      <div class="controls" id="mins"></div>
      <div class="controls">
        <button type="button" class="chip" id="full-range" aria-pressed="false">Show the full price range</button>
        <button type="button" class="chip" id="thin" aria-pressed="false">Include 2–4 provider codes in sorts</button>
      </div>
      <div class="legend">
        <span class="legend-title">Reading a row</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--p2)"></span>10th–90th percentile</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--p4)"></span>middle half</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--p6);width:3px"></span>median</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--d-mid)"></span>registered course length</span>
      </div>
    </div>
    <div class="panel" id="rows-panel"><div id="rows"></div></div>`;

  const rowsHost = host.querySelector<HTMLElement>('#rows')!;
  const sortsHost = host.querySelector<HTMLElement>('#sorts')!;
  const minsHost = host.querySelector<HTMLElement>('#mins')!;

  const SORTS: [Sort, string][] = [
    ['providers', 'most providers'],
    ['spread', 'widest price gap'],
    ['dear', 'dearest median'],
    ['cheap', 'cheapest median'],
    ['duration', 'widest length range'],
    ['code', 'code A–Z'],
  ];

  function drawChips(): void {
    sortsHost.innerHTML = '<span class="control-label">Sort by</span>' + SORTS.map(([id, label]) =>
      `<button type="button" class="chip" data-sort="${id}" aria-pressed="${sort === id}">${label}</button>`).join('');
    minsHost.innerHTML = '<span class="control-label">Providers per qualification</span>' + MIN_CHOICES.map(([n, label]) =>
      `<button type="button" class="chip" data-min="${n}" aria-pressed="${minProviders === n}">${label}<span class="n">${num(all.filter((c) => c.providers >= n).length)}</span></button>`).join('');
    for (const b of sortsHost.querySelectorAll<HTMLElement>('[data-sort]')) {
      b.addEventListener('click', () => { sort = b.dataset.sort as Sort; sync(); draw(); });
    }
    for (const b of minsHost.querySelectorAll<HTMLElement>('[data-min]')) {
      b.addEventListener('click', () => { minProviders = Number(b.dataset.min); sync(); draw(); });
    }
  }

  const sync = () => setParams({ sort: sort === 'providers' ? null : sort, min: minProviders === 5 ? null : minProviders });

  host.querySelector<HTMLElement>('#full-range')!.addEventListener('click', (e) => {
    fullRange = !fullRange;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(fullRange));
    draw();
  });
  host.querySelector<HTMLElement>('#thin')!.addEventListener('click', (e) => {
    includeThin = !includeThin;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(includeThin));
    draw();
  });

  function draw(): void {
    let rows = all.filter((c) => c.providers >= minProviders);
    const ratioSort = sort === 'spread' || sort === 'dear' || sort === 'cheap';
    if (ratioSort && !includeThin) rows = rows.filter((c) => c.providers >= THIN);

    const spread = (c: CompareCode) => (c.pw.p10 && c.pw.p90 ? c.pw.p90 / c.pw.p10 : 0);
    rows = rows.slice().sort((a, b) => {
      switch (sort) {
        case 'spread': return spread(b) - spread(a);
        case 'dear': return (b.pw.med ?? 0) - (a.pw.med ?? 0);
        case 'cheap': return (a.pw.med ?? 0) - (b.pw.med ?? 0);
        case 'duration': return ((b.weeks.max ?? 0) - (b.weeks.min ?? 0)) - ((a.weeks.max ?? 0) - (a.weeks.min ?? 0));
        case 'code': return a.nat.localeCompare(b.nat);
        default: return b.providers - a.providers || a.nat.localeCompare(b.nat);
      }
    });

    if (!rows.length) {
      rowsHost.innerHTML = `<div class="empty-state"><strong>No qualification matches those settings.</strong>
        No nationally coded qualification has ${minProviders}+ providers under the current filters. Lower the provider
        filter — ${num(all.length)} qualifications have two or more.</div>`;
      return;
    }

    const priceMax = fullRange
      ? Math.max(...rows.map((c) => c.pw.max ?? 0))
      : 1200;
    const weekMax = 200;

    rowsHost.innerHTML = '';
    if (ratioSort && !includeThin) {
      const excluded = all.filter((c) => c.providers >= minProviders && c.providers < THIN).length;
      if (excluded) {
        const note = document.createElement('p');
        note.className = 'small muted';
        note.innerHTML = `${num(excluded)} qualifications with 2–4 providers are held out of this sort: a price gap
          measured across three offerings is noise, and it would otherwise take the whole top of the list. The toggle
          above puts them back.`;
        rowsHost.append(note);
      }
    }

    const scroller = document.createElement('div');
    scroller.className = 'chart-scroll';
    scroller.append(rangeChart(rows, priceMax, weekMax));
    rowsHost.append(scroller);

    const foot = document.createElement('p');
    foot.className = 'small muted';
    foot.innerHTML = `Showing ${num(rows.length)} of ${num(all.length)} comparable qualifications.
      Click any row to open it in <button type="button" class="row-link" data-goto>Same Qualification</button>.`;
    rowsHost.append(foot);
    foot.querySelector<HTMLElement>('[data-goto]')?.addEventListener('click', () => navigate('same-qualification'));
  }

  drawChips();
  draw();
}

function rangeChart(rows: CompareCode[], priceMax: number, weekMax: number): SVGSVGElement {
  const rowH = 30;
  const labelW = 250;
  const priceW = 560;
  const gap = 26;
  const weekW = 150;
  const countW = 70;
  const W = labelW + priceW + gap + weekW + countW;
  const top = 42;
  const H = top + rows.length * rowH + 18;

  const svg = chartSvg(W, H, 'Price range per teaching week for every comparable qualification');
  svg.style.minWidth = `${Math.min(W, 980)}px`;

  const x = linear([0, priceMax], [0, priceW]);
  const xw = linear([0, weekMax], [0, weekW]);

  const headers = group(0, 0);
  headers.append(text(labelW, 16, 'tuition per teaching week', { class: 'axis-title' }));
  headers.append(text(labelW + priceW + gap, 16, 'course length (weeks)', { class: 'axis-title' }));
  headers.append(text(W, 16, 'providers', { class: 'axis-title', 'text-anchor': 'end' }));
  svg.append(headers);

  const axis = group(labelW, top - 12);
  for (const t of ticks(0, priceMax, 6)) {
    axis.append(svgEl('line', { x1: x(t), x2: x(t), y1: 0, y2: rows.length * rowH + 6, class: 'grid-line' }));
    axis.append(text(x(t), -4, `$${num(t)}`, { 'text-anchor': 'middle', class: 'axis-label' }));
  }
  for (const t of [0, 52, 104, 156, 200]) {
    axis.append(text(priceW + gap + xw(t), -4, String(t), { 'text-anchor': 'middle', class: 'axis-label' }));
  }
  svg.append(axis);

  rows.forEach((c, i) => {
    const y = top + i * rowH;
    const g = group(0, y);
    g.setAttribute('class', 'range-row');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');

    const thin = c.providers < THIN;
    if (thin) g.setAttribute('opacity', '0.58');

    const pack = trainingPackage(c.nat);
    const holderMin = c.rows.find((r) => !r.s);
    const holderMax = [...c.rows].reverse()[0];

    tipped(g, [
      `${c.nat} — ${c.title}`,
      pack ? `${pack} training package` : '',
      `${esc(levelName(c.level))} · ${esc(fieldName(c.bf))}`,
      '',
      `${num(c.providers)} providers, ${num(c.offers)} registered offerings`,
      `Per teaching week: ${perWeek(c.pw.min)} min · ${perWeek(c.pw.p10)} p10 · ${perWeek(c.pw.med)} median · ${perWeek(c.pw.p90)} p90 · ${perWeek(c.pw.max)} max`,
      c.pw.p10 && c.pw.p90
        ? `The 90th-percentile provider charges ${(c.pw.p90 / c.pw.p10).toFixed(1)}× the 10th-percentile provider for the identical qualification.`
        : '',
      `Registered over ${c.weeks.min}–${c.weeks.max} weeks (median ${num(c.weeks.med)}) — which is why the total course fee is not comparable.`,
      holderMin ? `Cheapest believable: ${providerLabel(provider(holderMin.p))}` : '',
      holderMax ? `Dearest: ${providerLabel(provider(holderMax.p))}` : '',
      c.suspect ? `${c.suspect} offering${c.suspect === 1 ? '' : 's'} flagged as suspected misreporting` : '',
      thin ? `Only ${c.providers} providers offer this code — the spread is not meaningful at this sample.` : '',
      'Click to open this qualification',
    ]);

    const label = text(0, rowH / 2 + 4, '', { class: 'axis-label' });
    label.textContent = `${c.nat}  ${truncEsc(c.title, 30).replace(/&amp;/g, '&').replace(/…$/, '…')}`;
    label.setAttribute('fill', 'var(--ink)');
    g.append(label);

    const px = (v: number | null) => (v == null ? 0 : Math.max(0, Math.min(priceW, x(Math.min(v, priceMax)))));
    const bx = labelW;

    if (c.pw.min != null && c.pw.max != null) {
      g.append(svgEl('line', {
        x1: bx + px(c.pw.min), x2: bx + px(c.pw.max), y1: rowH / 2, y2: rowH / 2,
        stroke: 'var(--rule-strong)', 'stroke-width': 1,
      }));
    }
    if (c.pw.p10 != null && c.pw.p90 != null) {
      g.append(svgEl('rect', {
        x: bx + px(c.pw.p10), y: rowH / 2 - 4, width: Math.max(2, px(c.pw.p90) - px(c.pw.p10)), height: 8,
        rx: 4, fill: 'var(--p2)',
      }));
    }
    if (c.pw.p25 != null && c.pw.p75 != null) {
      g.append(svgEl('rect', {
        x: bx + px(c.pw.p25), y: rowH / 2 - 1.5, width: Math.max(2, px(c.pw.p75) - px(c.pw.p25)), height: 3,
        fill: 'var(--p4)',
      }));
    }
    if (c.pw.med != null) {
      g.append(svgEl('line', {
        x1: bx + px(c.pw.med), x2: bx + px(c.pw.med), y1: rowH / 2 - 5.5, y2: rowH / 2 + 5.5,
        stroke: 'var(--p6)', 'stroke-width': 2,
      }));
    }
    if ((c.pw.max ?? 0) > priceMax) {
      const over = text(bx + priceW + 3, rowH / 2 + 4, '▸', { class: 'axis-label', fill: 'var(--p6)' });
      g.append(over);
    }

    // The anti-lie device: a wide price range at constant duration is a
    // different story from a wide price range over wildly varying lengths.
    const wx = labelW + priceW + gap;
    if (c.weeks.min != null && c.weeks.max != null) {
      g.append(svgEl('rect', {
        x: wx + xw(Math.min(c.weeks.min, weekMax)), y: rowH / 2 - 2,
        width: Math.max(2, xw(Math.min(c.weeks.max, weekMax)) - xw(Math.min(c.weeks.min, weekMax))), height: 4,
        fill: 'var(--d-mid)', rx: 2,
      }));
      if (c.weeks.med != null) {
        g.append(svgEl('line', {
          x1: wx + xw(Math.min(c.weeks.med, weekMax)), x2: wx + xw(Math.min(c.weeks.med, weekMax)),
          y1: rowH / 2 - 5, y2: rowH / 2 + 5, stroke: 'var(--ink-2)', 'stroke-width': 1,
        }));
      }
    }

    const count = text(W, rowH / 2 + 4, num(c.providers), { 'text-anchor': 'end', class: 'axis-label', fill: 'var(--ink)' });
    count.setAttribute('style', 'font-variant-numeric: tabular-nums');
    g.append(count);

    // A transparent hit rectangle across the whole row, so the click target is
    // the row and not just the few pixels of bar.
    const hit = svgEl('rect', { x: 0, y: 0, width: W, height: rowH, fill: 'transparent', class: 'mark' });
    g.append(hit);

    const open = () => navigate('same-qualification', { code: c.nat });
    g.addEventListener('click', open);
    g.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
    });

    svg.append(g);
  });

  return svg;
}

export { tipAttr };
