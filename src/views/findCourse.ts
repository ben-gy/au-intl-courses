// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The whole register as a table — and the drill destination five other views
// hand off to.
//
// Every row carries a peer-percentile micro-bar, because the number a reader
// needs is never the price on its own: it is whether that price is normal for
// its kind. The peer group is the identical national code where one exists, and
// the same field-and-level otherwise, and the tooltip always names which.

import { esc, money, num, ordinal, perWeek, providerLabel, tipAttr, truncEsc } from '../format';
import { percentileOf, quantile } from '../scales';
import {
  LEVEL_BANDS, bandOf, fieldName, levelName, loadCourses, loadPlaces, provider,
} from '../data';
import { gloss } from '../glossary';
import { navigate, setParams, currentRoute } from '../router';
import { openCourse, openProvider } from '../components/drawers';
import { F_EXPIRED, F_SUSPECT, F_WORK } from '../types';
import type { CoursesPayload, PlacesPayload } from '../types';

type Sort = 'pw' | 'pwDesc' | 'total' | 'weeks' | 'name' | 'provider';

const PAGE = 60;

export async function renderFindCourse(host: HTMLElement): Promise<void> {
  const [courses, places] = await Promise.all([loadCourses(), loadPlaces()]);
  const route = currentRoute();

  let q = route.params.get('q') ?? '';
  let field = route.params.get('field') ?? '';
  let band = route.params.get('band') ?? '';
  let state = route.params.get('state') ?? '';
  let code = route.params.get('code') ?? '';
  let minW = Number(route.params.get('minw')) || 0;
  let maxW = Number(route.params.get('maxw')) || 0;
  let sort: Sort = (route.params.get('sort') as Sort) || 'pw';
  let showExpired = false;
  let shown = PAGE;

  const campusStates = buildCampusStates(courses, places);
  const peers = buildPeerGroups(courses);

  const fields = [...new Set(Array.from({ length: courses.n }, (_, i) => courses.bf[i]))]
    .filter((f) => fieldName(f))
    .sort((a, b) => fieldName(a).localeCompare(fieldName(b)));
  const states = [...new Set(places.campuses.map((c) => c.state).filter(Boolean))].sort() as string[];

  host.innerHTML = `
    <div class="view-head">
      <h1>Every course an international student can enrol in</h1>
      <p class="view-sub">All ${num(courses.n)} courses on the register, with what each costs
        ${gloss('per teaching week')} and whether that price is normal for its kind. The official register lets you look
        up one course at a time and shows no price at all.</p>
    </div>
    <div class="panel">
      <div class="controls">
        <label class="control-label" for="q">Search</label>
        <input class="chip" id="q" type="search" value="${esc(q)}" placeholder="course name, CRICOS code, national code, provider" style="flex:1 1 300px;max-width:520px" />
      </div>
      <div class="controls" id="field-chips"></div>
      <div class="controls" id="band-chips"></div>
      <div class="controls" id="state-chips"></div>
      <div class="controls">
        <label class="control-label" for="minw">Length, weeks</label>
        <input class="chip" id="minw" type="number" min="0" placeholder="min" value="${minW || ''}" style="width:92px" />
        <input class="chip" id="maxw" type="number" min="0" placeholder="max" value="${maxW || ''}" style="width:92px" />
        <button type="button" class="chip" id="expired" aria-pressed="false">include expired registrations</button>
        <button type="button" class="btn ghost" id="reset">Clear all filters</button>
      </div>
    </div>
    <div id="results"></div>`;

  const results = host.querySelector<HTMLElement>('#results')!;
  const qInput = host.querySelector<HTMLInputElement>('#q')!;

  function chipRow(el: HTMLElement, label: string, items: [string, string][], current: string, set: (v: string) => void): void {
    el.innerHTML = `<span class="control-label">${label}</span>`
      + `<button type="button" class="chip" data-v="" aria-pressed="${!current}">all</button>`
      + items.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${current === v}">${esc(l)}</button>`).join('');
    for (const b of el.querySelectorAll<HTMLElement>('[data-v]')) {
      b.addEventListener('click', () => { set(b.dataset.v ?? ''); shown = PAGE; sync(); redrawChips(); draw(); });
    }
  }

  function redrawChips(): void {
    chipRow(host.querySelector('#field-chips')!, 'Field', fields.map((f) => [String(f), fieldName(f)]), field, (v) => { field = v; });
    chipRow(host.querySelector('#band-chips')!, 'Level', LEVEL_BANDS.map((b) => [b.id, b.label]), band, (v) => { band = v; });
    chipRow(host.querySelector('#state-chips')!, 'State', states.map((s) => [s, s]), state, (v) => { state = v; });
  }

  const sync = () => setParams({
    q: q || null, field: field || null, band: band || null, state: state || null,
    code: code || null, minw: minW || null, maxw: maxW || null, sort: sort === 'pw' ? null : sort,
  });

  let timer = 0;
  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { q = qInput.value.trim(); shown = PAGE; sync(); draw(); }, 260);
  });
  host.querySelector<HTMLInputElement>('#minw')!.addEventListener('input', (e) => {
    minW = Number((e.target as HTMLInputElement).value) || 0; shown = PAGE; sync(); draw();
  });
  host.querySelector<HTMLInputElement>('#maxw')!.addEventListener('input', (e) => {
    maxW = Number((e.target as HTMLInputElement).value) || 0; shown = PAGE; sync(); draw();
  });
  host.querySelector<HTMLElement>('#expired')!.addEventListener('click', (e) => {
    showExpired = !showExpired;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(showExpired));
    draw();
  });
  host.querySelector<HTMLElement>('#reset')!.addEventListener('click', () => {
    q = ''; field = ''; band = ''; state = ''; code = ''; minW = 0; maxW = 0; shown = PAGE;
    qInput.value = '';
    (host.querySelector('#minw') as HTMLInputElement).value = '';
    (host.querySelector('#maxw') as HTMLInputElement).value = '';
    sync(); redrawChips(); draw();
  });

  function matches(): number[] {
    const needle = q.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < courses.n; i++) {
      if (!showExpired && (courses.flags[i] & F_EXPIRED)) continue;
      if (field && String(courses.bf[i]) !== field) continue;
      if (band && bandOf(courses.level[i]) !== band) continue;
      if (code && courses.nat[i] !== code) continue;
      const w = courses.weeks[i];
      if (minW && (w == null || w < minW)) continue;
      if (maxW && (w == null || w > maxW)) continue;
      if (state && !campusStates[i]?.includes(state)) continue;
      if (needle) {
        const p = provider(courses.p[i]);
        const hay = `${courses.name[i]} ${courses.code[i]} ${courses.nat[i]} ${p.name} ${p.trading}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      out.push(i);
    }
    return out;
  }

  function draw(): void {
    const rows = matches();
    const sorted = rows.slice().sort((a, b) => {
      switch (sort) {
        case 'pwDesc': return (courses.pw[b] ?? -1) - (courses.pw[a] ?? -1);
        case 'total': return (courses.total[a] ?? Infinity) - (courses.total[b] ?? Infinity);
        case 'weeks': return (courses.weeks[a] ?? Infinity) - (courses.weeks[b] ?? Infinity);
        case 'name': return courses.name[a].localeCompare(courses.name[b]);
        case 'provider': return providerLabel(provider(courses.p[a])).localeCompare(providerLabel(provider(courses.p[b])));
        default: return (courses.pw[a] ?? Infinity) - (courses.pw[b] ?? Infinity);
      }
    });

    if (!sorted.length) {
      const parts: string[] = [];
      if (field) parts.push(fieldName(Number(field)));
      if (band) parts.push(LEVEL_BANDS.find((b) => b.id === band)?.label ?? band);
      if (state) parts.push(`in ${state}`);
      results.innerHTML = `<div class="empty-state"><strong>No course matches.</strong>
        The register has no ${parts.join(' ') || 'course'}${q ? ` matching “${esc(q)}”` : ''}${minW || maxW ? ` between ${minW || 0} and ${maxW || '∞'} weeks` : ''}.
        ${state ? `Try removing the state filter — the same search across all of Australia returns ${num(matchesWithout('state').length)} courses.` : 'Try removing a filter.'}</div>`;
      return;
    }

    const page = sorted.slice(0, shown);
    const priced = sorted.map((i) => courses.pw[i]).filter((v): v is number => v != null).sort((a, b) => a - b);

    const SORTS: [Sort, string][] = [
      ['pw', 'per week, cheapest first'], ['pwDesc', 'per week, dearest first'],
      ['total', 'total cost'], ['weeks', 'course length'], ['name', 'course name'], ['provider', 'provider'],
    ];

    results.innerHTML = `
      <div class="panel">
        <div class="controls">
          <span class="control-label">Sort by</span>
          ${SORTS.map(([id, l]) => `<button type="button" class="chip" data-sort="${id}" aria-pressed="${sort === id}">${l}</button>`).join('')}
        </div>
        <p class="small muted"><strong>${num(sorted.length)}</strong> courses match.
          ${priced.length ? `Per teaching week across them: ${perWeek(quantile(priced, 0.1))} at the 10th percentile,
          ${perWeek(quantile(priced, 0.5))} median, ${perWeek(quantile(priced, 0.9))} at the 90th.` : 'None of them carries a registered price.'}
          ${sort === 'total' ? '<br><strong>Sorted by total cost.</strong> Total is not comparable between providers — these courses run 1 to 432 weeks. Compare per week.' : ''}</p>
      </div>
      <div class="panel">
        <div class="table-scroll"><table>
          <thead><tr>
            <th>Course</th><th>Provider</th><th class="num">Weeks</th><th class="num">Total</th>
            <th class="num">Per week</th><th>Against its peers</th>
          </tr></thead>
          <tbody>${page.map((i) => rowHtml(i)).join('')}</tbody>
        </table></div>
        ${sorted.length > shown ? `<div style="text-align:center;margin-top:1rem">
          <button type="button" class="btn ghost" id="more">Show ${num(Math.min(PAGE, sorted.length - shown))} more of ${num(sorted.length - shown)}</button></div>` : ''}
      </div>`;

    for (const b of results.querySelectorAll<HTMLElement>('[data-sort]')) {
      b.addEventListener('click', () => { sort = b.dataset.sort as Sort; sync(); draw(); });
    }
    results.querySelector<HTMLElement>('#more')?.addEventListener('click', () => { shown += PAGE; draw(); });
    for (const tr of results.querySelectorAll<HTMLElement>('tr[data-course]')) {
      tr.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-provider]')) { void openProvider(Number(t.closest<HTMLElement>('[data-provider]')!.dataset.provider)); return; }
        if (t.closest('[data-nat]')) { navigate('same-qualification', { code: t.closest<HTMLElement>('[data-nat]')!.dataset.nat }); return; }
        void openCourse(tr.dataset.course!);
      });
    }
  }

  function matchesWithout(drop: 'state'): number[] {
    const saved = state;
    if (drop === 'state') state = '';
    const out = matches();
    state = saved;
    return out;
  }

  function rowHtml(i: number): string {
    const p = provider(courses.p[i]);
    const pw = courses.pw[i];
    const peer = peers.get(i);
    const pctile = pw != null && peer ? percentileOf(pw, peer.values) : null;
    const flags = courses.flags[i];

    return `<tr class="clickable" data-course="${esc(courses.code[i])}">
      <td>
        ${truncEsc(courses.name[i], 58)}
        ${flags & F_EXPIRED ? ' <span class="badge flag">expired</span>' : ''}
        ${flags & F_WORK ? ' <span class="badge">work placement</span>' : ''}
        <div class="small dim mono">${esc(courses.code[i])}
          ${courses.nat[i] ? ` · <button type="button" class="row-link mono" data-nat="${esc(courses.nat[i])}">${esc(courses.nat[i])}</button>` : ''}
          · ${esc(levelName(courses.level[i]))}</div>
      </td>
      <td><button type="button" class="row-link" data-provider="${courses.p[i]}">${truncEsc(providerLabel(p), 34)}</button>
        ${p.type === 'G' ? '<span class="badge gov">Gov</span>' : ''}
        <div class="small dim">${esc((campusStates[i] ?? []).join(', ') || '—')}</div></td>
      <td class="num">${courses.weeks[i] == null ? '—' : num(courses.weeks[i])}</td>
      <td class="num">${money(courses.total[i])}</td>
      <td class="num">${pw == null ? '—' : perWeek(pw)}${flags & F_SUSPECT ? ' <span class="badge flag">check</span>' : ''}</td>
      <td>${peer && pctile != null ? peerBar(pctile, peer) : '<span class="small dim">no peer group</span>'}</td>
    </tr>`;
  }

  function peerBar(pctile: number, peer: { label: string; values: number[]; kind: string }): string {
    const p10 = quantile(peer.values, 0.1);
    const p90 = quantile(peer.values, 0.9);
    return `<span class="peer-bar" data-tip="${tipAttr(
      `Compared against ${peer.label}`,
      `${num(peer.values.length)} priced offerings`,
      `10th percentile ${perWeek(p10)} · median ${perWeek(quantile(peer.values, 0.5))} · 90th percentile ${perWeek(p90)}`,
      `This course sits at the ${ordinal(pctile)} percentile`,
      peer.kind === 'nat'
        ? 'These are the identical nationally coded qualification — the certificate is the same whoever you pay.'
        : 'These are courses at the same level in the same field. They are not the identical qualification, so this is context, not a like-for-like price.',
    )}">
      <span class="peer-track"></span>
      <span class="peer-marker" style="left:${Math.max(0, Math.min(100, pctile)).toFixed(1)}%"></span>
      <span class="peer-text small dim">${ordinal(pctile)} of ${num(peer.values.length)}${peer.kind === 'nat' ? ' identical' : ' similar'}</span>
    </span>`;
  }

  redrawChips();
  draw();
}

/** Which states a course is actually taught in, via its campuses. */
function buildCampusStates(courses: CoursesPayload, places: PlacesPayload): (string[] | undefined)[] {
  const out: (string[] | undefined)[] = new Array(courses.n);
  for (let i = 0; i < courses.n; i++) {
    const set = new Set<string>();
    for (const l of courses.locs[i]) {
      const s = places.campuses[l]?.state;
      if (s) set.add(s);
    }
    out[i] = set.size ? [...set].sort() : undefined;
  }
  return out;
}

/**
 * The peer group for every course.
 *
 * Nationally coded courses get the identical qualification — a genuine
 * like-for-like. Everything else (most degrees) gets the same field and level,
 * which is context rather than a comparison, and the tooltip says which of the
 * two it is looking at. Silently mixing the two would be the real defect.
 */
function buildPeerGroups(courses: CoursesPayload): Map<number, { label: string; values: number[]; kind: string }> {
  const byNat = new Map<string, number[]>();
  const byFieldLevel = new Map<string, number[]>();
  for (let i = 0; i < courses.n; i++) {
    const pw = courses.pw[i];
    if (pw == null || (courses.flags[i] & (F_SUSPECT | F_EXPIRED))) continue;
    if (courses.nat[i]) {
      if (!byNat.has(courses.nat[i])) byNat.set(courses.nat[i], []);
      byNat.get(courses.nat[i])!.push(pw);
    }
    const key = `${courses.bf[i]}|${bandOf(courses.level[i]) ?? levelName(courses.level[i])}`;
    if (!byFieldLevel.has(key)) byFieldLevel.set(key, []);
    byFieldLevel.get(key)!.push(pw);
  }
  for (const list of byNat.values()) list.sort((a, b) => a - b);
  for (const list of byFieldLevel.values()) list.sort((a, b) => a - b);

  const out = new Map<number, { label: string; values: number[]; kind: string }>();
  for (let i = 0; i < courses.n; i++) {
    if (courses.pw[i] == null) continue;
    const nat = courses.nat[i];
    const natGroup = nat ? byNat.get(nat) : undefined;
    if (natGroup && natGroup.length >= 3) {
      out.set(i, { label: `the ${natGroup.length} registered offerings of ${nat}`, values: natGroup, kind: 'nat' });
      continue;
    }
    const key = `${courses.bf[i]}|${bandOf(courses.level[i]) ?? levelName(courses.level[i])}`;
    const flGroup = byFieldLevel.get(key);
    if (flGroup && flGroup.length >= 8) {
      const bandLabel = LEVEL_BANDS.find((b) => b.id === bandOf(courses.level[i]))?.label ?? levelName(courses.level[i]);
      out.set(i, { label: `${bandLabel} courses in ${fieldName(courses.bf[i])}`, values: flGroup, kind: 'field' });
    }
  }
  return out;
}
