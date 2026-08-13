// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import './styles.css';
import { loadMeta, loadProviders, primeCore, meta, providers, providerBySlug } from './data';
import { DEFAULT_VIEW, currentRoute, navigate, onRouteChange } from './router';
import { initTooltip } from './components/tooltip';
import { initGlossary } from './components/glossary';
import { closeAllOverlays } from './overlay';
import { openAbout } from './about';
import { openProvider } from './components/drawers';
import { esc, num, providerLabel, truncEsc } from './format';

import { renderSameQualification } from './views/sameQualification';
import { renderCompareCodes } from './views/compareCodes';
import { renderFindCourse } from './views/findCourse';
import { renderWhere } from './views/where';
import { renderCostDuration } from './views/costDuration';
import { renderFieldsLevels } from './views/fieldsLevels';
import { renderSharedAddresses } from './views/sharedAddresses';
import { renderProviders } from './views/providersView';
import { renderChurn } from './views/churn';

/** Nav labels are WORDS ONLY — never a count badge. Counts belong in the views. */
const VIEWS: { id: string; label: string; render: (host: HTMLElement) => void | Promise<void> }[] = [
  { id: 'same-qualification', label: 'Same Qualification', render: renderSameQualification },
  { id: 'compare-codes', label: 'Compare Qualifications', render: renderCompareCodes },
  { id: 'find-a-course', label: 'Find a Course', render: renderFindCourse },
  { id: 'where', label: 'Where', render: renderWhere },
  { id: 'cost-duration', label: 'Cost and Time', render: renderCostDuration },
  { id: 'fields-levels', label: 'Fields and Levels', render: renderFieldsLevels },
  { id: 'providers', label: 'Providers', render: renderProviders },
  { id: 'shared-addresses', label: 'Shared Addresses', render: renderSharedAddresses },
  { id: 'churn', label: 'Arrivals and Departures', render: renderChurn },
];

function shell(): { main: HTMLElement } {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="#/${DEFAULT_VIEW}">
          <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="12" fill="#0F6E6E"/>
            <path d="M32 14 L56 24 L32 34 L8 24 Z" fill="#FBFAF7"/>
            <path d="M18 28.5 V38 c0 4.5 6.6 7.5 14 7.5 s14 -3 14 -7.5 V28.5 L32 36 Z" fill="#C3E0DA"/>
            <rect x="12" y="50" width="40" height="4" rx="2" fill="#C2691A"/>
            <circle cx="24" cy="52" r="4.6" fill="#FBFAF7" stroke="#C2691A" stroke-width="2.4"/>
          </svg>
          <span class="brand-name">International Student Courses</span>
        </a>
        <div class="header-spacer"></div>
        <div class="header-search">
          <input type="search" id="global-search" placeholder="Search providers" aria-label="Search registered providers" autocomplete="off" />
          <div class="search-results" id="global-results" hidden></div>
        </div>
        <button type="button" class="icon-btn" id="about-btn" aria-label="About this site, its sources and its limitations">About</button>
      </div>
    </header>
    <nav class="site-nav" aria-label="Views"><div class="nav-inner" id="nav-inner"></div></nav>
    <main class="main-content" id="main-content" tabindex="-1"></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <div id="footer-sources"></div>
        <div>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></div>
      </div>
    </footer>`;

  const nav = app.querySelector<HTMLElement>('#nav-inner')!;
  for (const view of VIEWS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-tab';
    b.textContent = view.label;
    b.dataset.view = view.id;
    b.addEventListener('click', () => navigate(view.id));
    nav.append(b);
  }

  app.querySelector<HTMLButtonElement>('#about-btn')!.addEventListener('click', () => openAbout(meta()));

  // The skip link must not reach the router. `href="#main-content"` sets
  // location.hash, which fires hashchange, which the router would read as the
  // view "main-content" — an unknown view, so it would fall back to the default
  // and throw the reader out of whatever they were reading.
  app.querySelector<HTMLAnchorElement>('.skip-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main-content')?.focus();
  });

  wireSearch(app);

  return { main: app.querySelector<HTMLElement>('#main-content')! };
}

function wireSearch(app: HTMLElement): void {
  const input = app.querySelector<HTMLInputElement>('#global-search')!;
  const results = app.querySelector<HTMLElement>('#global-results')!;
  let timer = 0;

  const close = () => { results.hidden = true; results.innerHTML = ''; };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      const hits = providers()
        .filter((p) => providerLabel(p).toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
        .slice(0, 12);
      if (!hits.length) {
        results.innerHTML = `<div class="search-group-label">No match</div>
          <div class="search-item" style="cursor:default">No registered provider matches “${esc(input.value)}”.
            Try the trading name from your offer letter, or its CRICOS provider code.</div>`;
        results.hidden = false;
        return;
      }
      results.innerHTML = `<div class="search-group-label">Providers</div>` + hits.map((p) => `
        <button type="button" class="search-item" data-open="${p.i}">${esc(truncEsc(providerLabel(p), 48))}
          <span class="sub">${esc(p.code)} · ${p.type === 'G' ? 'Government' : 'Private'} · ${num(p.live)} courses · ${esc(p.states.join(', ') || 'no state recorded')}</span>
        </button>`).join('');
      results.hidden = false;
      for (const b of results.querySelectorAll<HTMLElement>('[data-open]')) {
        b.addEventListener('click', () => { close(); input.value = ''; void openProvider(Number(b.dataset.open)); });
      }
    }, 220);
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.header-search')) close();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function markActive(id: string): void {
  for (const tab of document.querySelectorAll<HTMLElement>('.nav-tab')) {
    const on = tab.dataset.view === id;
    if (on) { tab.setAttribute('aria-current', 'page'); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    else tab.removeAttribute('aria-current');
  }
}

let renderToken = 0;

async function route(main: HTMLElement): Promise<void> {
  // An overlay opened on one view must not survive into the next: on a phone a
  // drawer is full-width, so the reader would appear to be browsing behind it.
  closeAllOverlays();

  const { view, params } = currentRoute();
  const entry = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  markActive(entry.id);

  // A view render is async. Without a token, navigating twice quickly lets a
  // slow first render append its DOM into a host the second render already
  // replaced, and the reader ends up with two views stacked.
  const token = ++renderToken;
  main.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'view-wrap';
  main.append(wrap);
  wrap.innerHTML = '<div class="loading">Loading the register…</div>';

  try {
    // Views render into the ATTACHED container, never into a detached div that
    // is grafted in afterwards. Leaflet measures its container at construction
    // and re-parenting the map afterwards leaves it with no tile layer and no
    // size — a map that renders as an empty grey box with no error anywhere.
    // The render token, not a staging node, is what keeps a slow render from
    // landing on top of a newer one.
    // Each view fetches what it needs and then writes its own markup, which
    // replaces the loading line above at the first paint it can actually fill.
    await entry.render(wrap);
    if (token !== renderToken) { wrap.innerHTML = ''; return; }
  } catch (err) {
    if (token !== renderToken) return;
    wrap.innerHTML = `<div class="error-state"><strong>This view failed to render.</strong>
      <p class="small">${esc(err instanceof Error ? err.message : String(err))}</p>
      <button type="button" class="btn" id="retry">Try again</button></div>`;
    wrap.querySelector('#retry')?.addEventListener('click', () => { void route(main); });
    return;
  }

  // Deep link into a provider, so a shared URL reopens what was shared.
  const slug = params.get('provider');
  if (slug) {
    const p = providerBySlug(slug);
    if (p) void openProvider(p.i);
  }
}

async function boot(): Promise<void> {
  const { main } = shell();
  main.innerHTML = '<div class="view-wrap"><div class="loading">Loading the CRICOS register…</div></div>';

  try {
    const [m, prov] = await Promise.all([loadMeta(), loadProviders()]);
    primeCore(m, prov);
    document.querySelector('#footer-sources')!.innerHTML = `
      Source: <a href="${esc(m.source.landing)}" target="_blank" rel="noopener">${esc(m.source.name)}</a>,
      ${esc(m.source.publisher)} — ${esc(m.source.licence)}. Snapshot ${esc(m.asAt)}:
      ${num(m.counts.courseCount)} courses, ${num(m.counts.providerCount)} providers,
      ${num(m.counts.campusCount)} campuses. Map boundaries: ABS ASGS 2021 Postal Areas (CC BY 4.0).
      Registered fees, not quotes — confirm anything that matters at
      <a href="${esc(m.source.register)}" target="_blank" rel="noopener">cricos.education.gov.au</a>.
      Independent project; not affiliated with the Department of Education or any provider listed.`;
  } catch (err) {
    main.innerHTML = `<div class="view-wrap"><div class="error-state">
      <strong>The register could not be loaded.</strong>
      <p class="small">${esc(err instanceof Error ? err.message : String(err))}</p>
      <p class="small">The original data is published at
        <a href="https://data.gov.au/data/dataset/cricos">data.gov.au</a>.</p>
      <button type="button" class="btn" id="retry">Try again</button></div></div>`;
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
    return;
  }

  initTooltip();
  initGlossary();
  if (!location.hash) history.replaceState(null, '', `#/${DEFAULT_VIEW}`);
  await route(main);
  onRouteChange(() => { void route(main); });
}

void boot();
