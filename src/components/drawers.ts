// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The three drill-downs — a provider, a course, a building — reachable from
// every view. Each is the same overlay component; only the contents differ.
//
// They are DETACHED from the DOM when closed (see overlay.ts). A closed
// off-canvas panel parked at translateX(100%) is still a real box on iOS
// Safari and silently gives the page a horizontal scroll that `overflow-x:
// clip` neither prevents nor lets scrollWidth detect.

import { closeButton, openOverlay } from '../overlay';
import { esc, money, num, ordinal, perWeek, providerLabel, tipAttr, truncEsc, weeks } from '../format';
import {
  fieldName, languageName, levelName, loadCompare, loadCourses, loadPlaces, locationTypeName,
  narrowName, provider, providers, trainingPackage,
} from '../data';
import { gloss } from '../glossary';
import { navigate, setParams } from '../router';
import { F_DUAL, F_EXPIRED, F_FOUNDATION, F_SUSPECT, F_WORK } from '../types';
import type { CoursesPayload, PlacesPayload } from '../types';
import { percentileOf } from '../scales';

function head(panel: HTMLElement, close: () => void, title: string, sub: string): HTMLDivElement {
  const h = document.createElement('div');
  h.className = 'overlay-head';
  h.innerHTML = `<h2>${title}<span class="sub">${sub}</span></h2>`;
  h.append(closeButton(close, 'Close'));
  panel.append(h);
  const body = document.createElement('div');
  body.className = 'overlay-body';
  panel.append(body);
  return body;
}

/** The capacity caveat, attached EVERY time the number appears. */
const CAPACITY_NOTE = 'the maximum number of overseas students this provider is registered to have at once — a legal ceiling, not a headcount';

/* ─────────────────────────── provider ─────────────────────────── */

export async function openProvider(providerIndex: number, opts: { natCode?: string } = {}): Promise<void> {
  const p = providers()[providerIndex];
  if (!p) return;

  setParams({ provider: p.slug });
  const handle = openOverlay({
    panelClass: 'drawer',
    label: `${providerLabel(p)} — provider details`,
    lockScroll: true,
    onClose: () => setParams({ provider: null }),
    build(panel, close) {
      const body = head(panel, close,
        esc(providerLabel(p)),
        `CRICOS provider ${esc(p.code)} · ${p.type === 'G' ? 'Government' : p.type === 'P' ? 'Private' : 'Type not recorded'}`);
      body.innerHTML = '<div class="loading">Loading this provider…</div>';
      void fill(body, providerIndex, opts.natCode);
    },
  });
  void handle;
}

async function fill(body: HTMLElement, pi: number, natCode?: string): Promise<void> {
  const p = providers()[pi];
  let places: PlacesPayload;
  let courses: CoursesPayload;
  let compare: Awaited<ReturnType<typeof loadCompare>>;
  try {
    [places, courses, compare] = await Promise.all([loadPlaces(), loadCourses(), loadCompare()]);
  } catch (err) {
    body.innerHTML = `<div class="error-state"><strong>This provider's detail could not be loaded.</strong>
      <p class="small">${esc(err instanceof Error ? err.message : String(err))}</p></div>`;
    return;
  }

  const myCampuses = places.campuses.filter((c) => c.p === pi);
  const myCourseIdx: number[] = [];
  for (let i = 0; i < courses.n; i++) if (courses.p[i] === pi) myCourseIdx.push(i);

  // Where this provider sits inside each qualification it shares with others.
  const tracks: { nat: string; title: string; pct: number; mine: number; med: number; peers: number; weeks: number | null; peerWeeks: number | null }[] = [];
  for (const entry of compare.codes) {
    if (entry.providers < 3) continue;
    const clean = entry.rows.filter((r) => !r.s);
    if (clean.length < 3) continue;
    const mineRows = clean.filter((r) => r.p === pi);
    if (!mineRows.length) continue;
    const sorted = clean.map((r) => r.pw).sort((a, b) => a - b);
    for (const r of mineRows) {
      tracks.push({
        nat: entry.nat,
        title: entry.title,
        pct: percentileOf(r.pw, sorted),
        mine: r.pw,
        med: entry.pw.med ?? 0,
        peers: clean.length,
        weeks: r.w,
        peerWeeks: entry.weeks.med,
      });
    }
  }
  tracks.sort((a, b) => b.pct - a.pct);

  const parts: string[] = [];

  parts.push(`
    <div class="stat-row">
      <div class="stat"><div class="stat-value num">${num(p.live)}</div><div class="stat-label">courses on the register</div></div>
      <div class="stat"><div class="stat-value num">${num(p.campuses)}</div><div class="stat-label">${p.campuses === 1 ? 'campus' : 'campuses'}</div></div>
      <div class="stat"><div class="stat-value num">${p.med == null ? '—' : perWeek(p.med)}</div><div class="stat-label">median tuition</div></div>
      <div class="stat" data-tip="${tipAttr(CAPACITY_NOTE)}"><div class="stat-value num">${p.capacity == null ? '—' : num(p.capacity)}</div><div class="stat-label">registered capacity</div></div>
    </div>
    <p class="small muted">Course count is what this provider is registered to teach. It is not enrolments, not market share and not size —
      ${gloss('CRICOS')} publishes no student numbers of any kind.</p>`);

  if (tracks.length >= 3) {
    const medianPct = [...tracks].map((t) => t.pct).sort((a, b) => a - b)[Math.floor(tracks.length / 2)];
    parts.push(`<div>
      <h3>Against the providers selling the identical qualification</h3>
      <p class="small muted">Each track is one nationally coded qualification this provider also sells, drawn in
        ${gloss('percentile')} space so tracks at completely different price levels can be read as one shape.
        A near-vertical column means it prices consistently; a zigzag means it prices each qualification on its own.
        ${num(tracks.length)} of its ${num(p.live)} courses have a ${gloss('peer group', 'peer group')} at all.</p>
      <p class="small"><strong>Median position: ${ordinal(medianPct)} percentile</strong> across ${num(tracks.length)} comparable qualifications.</p>
      ${trackHtml(tracks)}
    </div>`);
  } else {
    parts.push(`<div>
      <h3>Against the providers selling the identical qualification</h3>
      <p class="small muted">Only ${tracks.length} of this provider's ${num(p.live)} courses carries a
        ${gloss('VET national code')} with enough other providers to compare against, which is too few to characterise
        how it prices. Most degrees are not nationally coded: no other provider offers exactly the same one, so there is
        nothing to compare a price to. Its courses are listed below.</p>
    </div>`);
  }

  parts.push(`<div>
    <h3>Campuses</h3>
    ${myCampuses.length ? `<div class="table-scroll"><table><thead><tr>
      <th>Campus</th><th>Where</th><th>How it is run</th><th class="num">Courses</th></tr></thead><tbody>
      ${myCampuses.map((c) => `<tr>
        <td>${esc(c.name)}<div class="small dim">${esc(c.addr)}</div></td>
        <td>${esc(c.city)}${c.state ? `, ${esc(c.state)}` : ''} ${esc(c.pc ?? '')}</td>
        <td class="small">${esc(locationTypeName(c.t))}</td>
        <td class="num">${num(c.courses)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="small muted">No campus is recorded for this provider.</p>'}
  </div>`);

  const sortedCourses = myCourseIdx.slice().sort((a, b) => (courses.pw[b] ?? -1) - (courses.pw[a] ?? -1));
  parts.push(`<div>
    <h3>Every course on the register</h3>
    <div class="table-scroll"><table><thead><tr>
      <th>Course</th><th>Level</th><th class="num">Weeks</th><th class="num">Total</th><th class="num">Per week</th>
    </tr></thead><tbody>
      ${sortedCourses.map((i) => `<tr class="clickable" data-course="${esc(courses.code[i])}">
        <td>${truncEsc(courses.name[i], 62)}
          <div class="small dim mono">${esc(courses.code[i])}${courses.nat[i] ? ` · ${esc(courses.nat[i])}` : ''}</div></td>
        <td class="small">${esc(levelName(courses.level[i]))}</td>
        <td class="num">${courses.weeks[i] == null ? '—' : num(courses.weeks[i])}</td>
        <td class="num">${money(courses.total[i])}</td>
        <td class="num">${courses.pw[i] == null ? '—' : perWeek(courses.pw[i])}${courses.flags[i] & F_SUSPECT ? ' <span class="badge flag">check</span>' : ''}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`);

  parts.push(`<div>
    <h3>As registered</h3>
    <dl class="dl">
      <dt>Institution name</dt><dd>${esc(p.name)}</dd>
      ${p.trading && p.trading !== p.name ? `<dt>Trading name</dt><dd>${esc(p.trading)}</dd>` : ''}
      <dt>${gloss('CRICOS provider code', 'Provider code')}</dt><dd class="mono">${esc(p.code)}</dd>
      <dt>${gloss('Institution Type', 'Type')}</dt><dd>${p.type === 'G' ? 'Government' : p.type === 'P' ? 'Private' : 'Not recorded'}</dd>
      <dt>${gloss('Institution Capacity', 'Registered capacity')}</dt><dd>${p.capacity == null ? 'Not recorded' : `${num(p.capacity)} overseas students`}</dd>
      <dt>States</dt><dd>${p.states.length ? esc(p.states.join(', ')) : 'Not recorded'}</dd>
      ${p.website ? `<dt>Website</dt><dd><a href="${esc(p.website)}" target="_blank" rel="noopener nofollow">${esc(p.website.replace(/^https?:\/\//, ''))}</a> <span class="small dim">(the provider's own site — leaves this page)</span></dd>` : ''}
    </dl>
    <p class="small muted">Every figure here is what the provider has registered with the Commonwealth. It is not a quote,
      it is not net of any scholarship, and it may have changed since the ${gloss('snapshot')} this page was built from.
      Check the official register at <a href="https://cricos.education.gov.au/" target="_blank" rel="noopener">cricos.education.gov.au</a> before you act on it.</p>
  </div>`);

  body.innerHTML = parts.join('');

  for (const tr of body.querySelectorAll<HTMLElement>('tr[data-course]')) {
    tr.addEventListener('click', () => { void openCourse(tr.dataset.course!); });
  }
  for (const el of body.querySelectorAll<HTMLElement>('[data-nat]')) {
    el.addEventListener('click', () => navigate('same-qualification', { code: el.dataset.nat }));
  }

  if (natCode) {
    const target = body.querySelector<HTMLElement>(`[data-nat="${CSS.escape(natCode)}"]`);
    target?.scrollIntoView({ block: 'center' });
  }
}

function trackHtml(tracks: { nat: string; title: string; pct: number; mine: number; med: number; peers: number; weeks: number | null; peerWeeks: number | null }[]): string {
  const W = 100;
  return `<div class="track-list">${tracks.map((t) => `
    <button type="button" class="track" data-nat="${esc(t.nat)}"
      data-tip="${tipAttr(
        `${t.nat} — ${t.title}`,
        `This provider: ${perWeek(t.mine)} over ${t.weeks == null ? 'an unrecorded' : `${t.weeks}-week`} course`,
        `Peer median: ${perWeek(t.med)} across ${t.peers} priced offerings`,
        t.peerWeeks != null ? `Peer median duration: ${t.peerWeeks} weeks` : '',
        `Position: ${ordinal(t.pct)} percentile`,
        'Click to open this qualification',
      )}">
      <span class="track-label"><span class="mono">${esc(t.nat)}</span> ${truncEsc(t.title, 42)}</span>
      <span class="track-rail">
        <span class="track-band" style="left:10%;width:80%"></span>
        <span class="track-median" style="left:50%"></span>
        <span class="track-dot" style="left:${Math.max(0, Math.min(W, t.pct)).toFixed(1)}%"></span>
      </span>
      <span class="track-value num">${perWeek(t.mine)}</span>
    </button>`).join('')}</div>`;
}

/* ──────────────────────────── course ──────────────────────────── */

export async function openCourse(code: string): Promise<void> {
  let courses: CoursesPayload;
  let places: PlacesPayload;
  try {
    [courses, places] = await Promise.all([loadCourses(), loadPlaces()]);
  } catch { return; }
  const i = courses.code.indexOf(code);
  if (i < 0) return;
  const p = provider(courses.p[i]);

  openOverlay({
    panelClass: 'drawer',
    label: `${courses.name[i]} — course details`,
    lockScroll: true,
    build(panel, close) {
      const body = head(panel, close, esc(courses.name[i]), `${esc(providerLabel(p))} · CRICOS course ${esc(code)}`);
      const flags = courses.flags[i];
      const campuses = courses.locs[i].map((l) => places.campuses[l]).filter(Boolean);
      const nt = courses.nonTuition[i] ?? 0;
      const pack = courses.nat[i] ? trainingPackage(courses.nat[i]) : null;

      body.innerHTML = `
        <div class="stat-row">
          <div class="stat"><div class="stat-value num">${courses.pw[i] == null ? '—' : perWeek(courses.pw[i])}</div><div class="stat-label">${gloss('per teaching week', 'per teaching week')}</div></div>
          <div class="stat"><div class="stat-value num">${money(courses.total[i])}</div><div class="stat-label">${gloss('estimated total course cost', 'estimated total')}</div></div>
          <div class="stat"><div class="stat-value num">${courses.weeks[i] == null ? '—' : num(courses.weeks[i])}</div><div class="stat-label">weeks</div></div>
        </div>

        ${flags & F_SUSPECT ? `<div class="caution-note"><strong>Suspected misreporting.</strong>
          The register lists ${money(courses.tuition[i])} over ${weeks(courses.weeks[i])}, which is
          ${perWeek(courses.pw[i])} — far below anything else on the register. It is almost certainly a deposit or an
          instalment entered into the whole-of-course field. It is shown here exactly as published, and it is excluded
          from every "cheapest" comparison on this site.</div>` : ''}
        ${flags & F_EXPIRED ? `<div class="caution-note"><strong>This course's registration has expired.</strong>
          It remains on the published register, so it is shown here — but you cannot enrol in it.</div>` : ''}

        <div>
          <h3>The fee, as registered</h3>
          <dl class="dl">
            <dt>${gloss('tuition fee', 'Tuition fee')}</dt><dd class="num">${money(courses.tuition[i])}</dd>
            <dt>${gloss('non-tuition fee', 'Non-tuition fee')}</dt><dd class="num">${money(nt)}</dd>
            <dt>Estimated total</dt><dd class="num">${money(courses.total[i])} <span class="small dim">${money(courses.tuition[i])} + ${money(nt)} ✓</span></dd>
            <dt>Per teaching week</dt><dd class="num">${courses.pw[i] == null ? '—' : perWeek(courses.pw[i])} <span class="small dim">derived on this site, not published by CRICOS</span></dd>
          </dl>
        </div>

        <div>
          <h3>What it is</h3>
          <dl class="dl">
            <dt>${gloss('course level', 'Level')}</dt><dd>${esc(levelName(courses.level[i]))}</dd>
            <dt>${gloss('field of education', 'Field')}</dt><dd>${esc(fieldName(courses.bf[i]))} › ${esc(narrowName(courses.nf[i]))}</dd>
            ${courses.nat[i] ? `<dt>${gloss('VET national code', 'National code')}</dt>
              <dd><button type="button" class="row-link mono" data-nat="${esc(courses.nat[i])}">${esc(courses.nat[i])}</button>
              ${pack ? `<span class="small dim"> — ${esc(pack)} training package</span>` : ''}</dd>` : ''}
            <dt>${gloss('duration (weeks)', 'Duration')}</dt><dd>${weeks(courses.weeks[i])}</dd>
            <dt>Language</dt><dd>${esc(languageName(courses.lang[i]))}</dd>
            <dt>Flags</dt><dd>
              ${flags & F_DUAL ? `<span class="badge">${gloss('dual qualification', 'dual qualification')}</span> ` : ''}
              ${flags & F_WORK ? `<span class="badge">${gloss('work component', 'work component')}</span> ` : ''}
              ${flags & F_FOUNDATION ? `<span class="badge">${gloss('foundation studies', 'foundation studies')}</span> ` : ''}
              ${!(flags & (F_DUAL | F_WORK | F_FOUNDATION)) ? '<span class="small dim">none</span>' : ''}
            </dd>
          </dl>
        </div>

        <div>
          <h3>Where it is taught</h3>
          ${campuses.length ? `<div class="table-scroll"><table><thead><tr><th>Campus</th><th>Where</th><th>How it is run</th></tr></thead><tbody>
            ${campuses.map((c) => `<tr><td>${esc(c.name)}<div class="small dim">${esc(c.addr)}</div></td>
              <td>${esc(c.city)}${c.state ? `, ${esc(c.state)}` : ''} ${esc(c.pc ?? '')}</td>
              <td class="small">${esc(locationTypeName(c.t))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="small muted">No teaching location is recorded for this course.</p>'}
        </div>

        <div>
          <button type="button" class="btn ghost" data-open-provider="${courses.p[i]}">Open ${esc(providerLabel(p))}</button>
          ${courses.nat[i] ? `<button type="button" class="btn ghost" data-nat="${esc(courses.nat[i])}">Compare this qualification elsewhere</button>` : ''}
        </div>`;

      for (const el of body.querySelectorAll<HTMLElement>('[data-nat]')) {
        el.addEventListener('click', () => { close(); navigate('same-qualification', { code: el.dataset.nat }); });
      }
      const openP = body.querySelector<HTMLElement>('[data-open-provider]');
      openP?.addEventListener('click', () => { close(); void openProvider(Number(openP.dataset.openProvider)); });
    },
  });
}

/* ─────────────────────────── building ─────────────────────────── */

export async function openBuilding(key: string): Promise<void> {
  let places: PlacesPayload;
  try { places = await loadPlaces(); } catch { return; }
  const b = places.buildings.find((x) => x.key === key);
  if (!b) return;
  const here = places.campuses.filter((c) => c.b === key);

  openOverlay({
    panelClass: 'drawer',
    label: `${b.addr} — providers at this address`,
    lockScroll: true,
    build(panel, close) {
      const body = head(panel, close, esc(b.addr),
        `${esc(b.locality ?? '')}${b.state ? ` ${esc(b.state)}` : ''} ${esc(b.pc ?? '')} · ${b.providers.length} providers`);
      body.innerHTML = `
        <p class="small muted">Sharing a building is lawful, routine and extremely common — CBD serviced offices and
          education precincts produce it constantly. This lists addresses, not conduct.</p>
        <div class="table-scroll"><table><thead><tr>
          <th>Provider</th><th>Campus</th><th>How it is run</th><th class="num">Courses</th><th class="num">Median</th>
        </tr></thead><tbody>
          ${here.map((c) => {
            const p = provider(c.p);
            return `<tr class="clickable" data-provider="${c.p}">
              <td>${esc(providerLabel(p))}<div class="small dim mono">${esc(p.code)}</div></td>
              <td>${esc(c.name)}</td>
              <td class="small">${esc(locationTypeName(c.t))}</td>
              <td class="num">${num(c.courses)}</td>
              <td class="num">${p.med == null ? '—' : perWeek(p.med)}</td>
            </tr>`;
          }).join('')}
        </tbody></table></div>
        <p class="small muted">Addresses are matched textually and conservatively: two campuses join only when their
          street number and street name normalise to exactly the same string inside the same postcode. Providers at the
          same address who filed it differently will not appear together here — this under-counts rather than over-claims.</p>`;
      for (const tr of body.querySelectorAll<HTMLElement>('tr[data-provider]')) {
        tr.addEventListener('click', () => { close(); void openProvider(Number(tr.dataset.provider)); });
      }
    },
  });
}
