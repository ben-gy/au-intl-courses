// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Which providers operate out of the same buildings as each other.
//
// This view names BUILDINGS, not conduct, and the standfirst says so above the
// fold rather than in a footnote. Sharing an address is lawful, routine and
// extremely common — CBD serviced offices and education precincts produce it
// constantly — and the register records nothing about quality or legitimacy.
//
// The layout runs to completion synchronously before a single DOM node is
// created, so the graph is motionless from the first frame. Animated settling
// is banned in this fleet.

import { chartSvg, group, svgEl, text, tipped } from '../components/svg';
import { boundsOf, packBoxes } from '../utils/layout';
import { components, forceLayout, mulberry32 } from '../utils/forceLayout';
import type { SimLink, SimNode } from '../utils/forceLayout';
import { attachSvgZoom } from '../utils/svgZoom';
import { esc, num, perWeek, providerLabel, truncEsc } from '../format';
import { loadPlaces, locationTypeName, meta, provider } from '../data';
import { gloss } from '../glossary';
import { openBuilding, openProvider } from '../components/drawers';
import { setParams, currentRoute } from '../router';
import type { Building } from '../types';

const OWNED = 'Location owned and operated by provider';

export async function renderSharedAddresses(host: HTMLElement): Promise<void> {
  const places = await loadPlaces();
  const route = currentRoute();
  // Default to buildings with THREE or more tenants. At two, the graph is one
  // giant hairball: pairs chain transitively through CBD towers until 700-odd
  // providers form a single component with no legible structure, which is a
  // structureless dot-cloud rather than a finding. At three the components
  // separate into readable clusters, and the 2+ chip is one click away.
  let minTenants = Number(route.params.get('min')) || 3;
  let hidePairs = route.params.get('pairs') === 'off';
  let stateFilter = route.params.get('state') ?? '';
  let selected: number | null = null;

  const m = meta();

  host.innerHTML = `
    <div class="view-head">
      <h1>Colleges that share a building</h1>
      <p class="view-sub">Each dot is a registered provider; a line means two providers list a campus at the same street
        address. ${num(m.counts.providersSharing)} of the ${num(m.counts.providerCount)} providers on the register share
        at least one address with somebody else, across ${num(m.counts.sharedBuildings)} buildings.</p>
    </div>

    <div class="standing-note">
      <strong>Sharing a building is lawful, routine and extremely common.</strong> CBD serviced offices, education
      precincts and shared campus towers all produce it. This view names buildings, not conduct. CRICOS records nothing
      about quality, outcomes or legitimacy, and nothing on this page should be read as an allegation about any provider.
    </div>

    <div class="panel">
      <div class="controls" id="controls"></div>
      <div class="controls">
        <label class="control-label" for="prov-search">Find a provider</label>
        <input class="chip" id="prov-search" type="search" placeholder="trading name" style="flex:1 1 220px;max-width:340px" />
      </div>
      <div class="legend">
        <span class="legend-title">Reading the graph</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--d-mid);border-radius:50%"></span>a registered provider — size is campuses on the register, never students</span>
        <span class="legend-item"><span class="legend-swatch" style="background:none;border:1.5px solid var(--ink);border-radius:50%"></span>Government provider</span>
        <span class="legend-item">— solid line: both campuses owned and operated by their provider</span>
        <span class="legend-item">– – dashed: at least one is delivered under arrangement with someone else</span>
      </div>
      <p class="small" id="counts"></p>
    </div>
    <div class="panel"><div class="chart-host" id="graph"></div></div>
    <p class="small muted">Addresses are matched textually and deliberately conservatively: two campuses join only when
      their street number and street name normalise to the same string inside the same postcode. Providers at one address
      who filed it differently will not appear together. This under-counts; it never invents a link.</p>`;

  const graphHost = host.querySelector<HTMLElement>('#graph')!;
  const controls = host.querySelector<HTMLElement>('#controls')!;
  const counts = host.querySelector<HTMLElement>('#counts')!;
  const search = host.querySelector<HTMLInputElement>('#prov-search')!;

  const states = [...new Set(places.buildings.map((b) => b.state).filter(Boolean))].sort() as string[];

  function drawControls(): void {
    controls.innerHTML = '<span class="control-label">Providers per building</span>'
      + [2, 3, 5, 10].map((n) => `<button type="button" class="chip" data-min="${n}" aria-pressed="${minTenants === n}">${n}+</button>`).join('')
      + '<span class="control-label">State</span>'
      + `<button type="button" class="chip" data-state="" aria-pressed="${!stateFilter}">all</button>`
      + states.map((s) => `<button type="button" class="chip" data-state="${s}" aria-pressed="${stateFilter === s}">${s}</button>`).join('')
      + `<button type="button" class="chip" data-pairs aria-pressed="${hidePairs}">hide two-provider pairs</button>`;
    for (const b of controls.querySelectorAll<HTMLElement>('[data-min]')) {
      b.addEventListener('click', () => { minTenants = Number(b.dataset.min); sync(); drawControls(); draw(); });
    }
    for (const b of controls.querySelectorAll<HTMLElement>('[data-state]')) {
      b.addEventListener('click', () => { stateFilter = b.dataset.state ?? ''; sync(); drawControls(); draw(); });
    }
    controls.querySelector<HTMLElement>('[data-pairs]')!.addEventListener('click', () => {
      hidePairs = !hidePairs; sync(); drawControls(); draw();
    });
  }

  const sync = () => setParams({
    min: minTenants === 3 ? null : minTenants,
    state: stateFilter || null,
    pairs: hidePairs ? 'off' : null,
  });

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) { selected = null; draw(); return; }
    const hit = [...new Set(places.buildings.flatMap((b) => b.providers))]
      .map((i) => provider(i))
      .find((p) => providerLabel(p).toLowerCase().includes(q));
    selected = hit ? hit.i : null;
    draw();
  });

  function draw(): void {
    let buildings = places.buildings.filter((b) => b.providers.length >= minTenants);
    if (stateFilter) buildings = buildings.filter((b) => b.state === stateFilter);
    if (hidePairs) buildings = buildings.filter((b) => b.providers.length > 2);

    const nodeIds = [...new Set(buildings.flatMap((b) => b.providers))].sort((a, b) => a - b);
    const index = new Map(nodeIds.map((id, i) => [id, i]));

    const links: SimLink[] = [];
    const edgeMeta: { building: Building; dashed: boolean }[] = [];
    for (const b of buildings) {
      const dashed = b.third > 0;
      for (let i = 0; i < b.providers.length; i++) {
        for (let j = i + 1; j < b.providers.length; j++) {
          links.push({ source: index.get(b.providers[i])!, target: index.get(b.providers[j])! });
          edgeMeta.push({ building: b, dashed });
        }
      }
    }

    counts.innerHTML = `Showing <strong>${num(nodeIds.length)}</strong> providers across
      <strong>${num(buildings.length)}</strong> shared buildings, joined by ${num(links.length)} co-tenancies.
      ${num(meta().counts.providerCount - meta().counts.providersSharing)} providers on the register share an address
      with nobody at all.`;

    graphHost.innerHTML = '';
    if (!nodeIds.length) {
      graphHost.innerHTML = `<div class="empty-state"><strong>No building matches those settings.</strong>
        No address in ${stateFilter || 'Australia'} has ${minTenants} or more registered providers at it${hidePairs ? ' once pairs are hidden' : ''}.
        Lower the providers-per-building filter.</div>`;
      return;
    }

    // Lay each connected component out on its own, then pack the boxes. In one
    // shared field, pure repulsion pushes a two-node pair to the far corner and
    // crushes the interesting clusters into the middle.
    const nodes: SimNode[] = nodeIds.map((id) => ({
      x: 0, y: 0, r: Math.max(4, Math.min(18, Math.sqrt(provider(id).campuses) * 3)),
    }));
    const comps = components(nodes.length, links);
    const rnd = mulberry32(0x51c0);
    const boxes: { w: number; h: number }[] = [];
    const compNodes: SimNode[][] = [];

    for (const comp of comps) {
      const sub = comp.map((i) => nodes[i]);
      const localIndex = new Map(comp.map((id, i) => [id, i]));
      const subLinks = links
        .filter((l) => localIndex.has(l.source) && localIndex.has(l.target))
        .map((l) => ({ source: localIndex.get(l.source)!, target: localIndex.get(l.target)! }));
      const side = Math.max(90, Math.sqrt(sub.length) * 70);
      for (const n of sub) { n.x = rnd() * side; n.y = rnd() * side; }
      forceLayout(sub, subLinks, {
        width: side, height: side, linkDistance: 46, gravity: 0.05,
        cutoff: 80, iterations: 220, timeBudgetMs: 200,
      });
      const b = boundsOf(sub);
      for (const n of sub) { n.x -= b.minX; n.y -= b.minY; }
      boxes.push({ w: Math.max(40, b.maxX - b.minX), h: Math.max(40, b.maxY - b.minY) });
      compNodes.push(sub);
    }

    const FIELD_W = 1180;
    const offsets = packBoxes(boxes, FIELD_W, 26);
    compNodes.forEach((sub, ci) => {
      for (const n of sub) { n.x += offsets[ci].x; n.y += offsets[ci].y; }
    });

    const all = boundsOf(nodes);
    const W = Math.max(400, all.maxX - all.minX + 40);
    const H = Math.max(300, all.maxY - all.minY + 40);
    const svg = chartSvg(W, H, 'Providers sharing a building');
    svg.style.maxHeight = '72vh';
    const g = group(20 - all.minX, 20 - all.minY);
    svg.append(g);

    // The selected provider's whole component at full opacity, everything else
    // dimmed — a click that only opens a panel wastes the visualisation.
    const selIdx = selected != null ? index.get(selected) : undefined;
    const litComponent = selIdx != null ? comps.find((c) => c.includes(selIdx)) : undefined;
    const lit = litComponent ? new Set(litComponent) : null;

    const edges = svgEl('g');
    links.forEach((l, i) => {
      const em = edgeMeta[i];
      const a = nodes[l.source];
      const b = nodes[l.target];
      const dim = lit ? (!lit.has(l.source) || !lit.has(l.target)) : false;
      const line = tipped(svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: 'var(--ink-2)', 'stroke-width': 1,
        'stroke-dasharray': em.dashed ? '4 3' : null,
        opacity: dim ? 0.12 : 0.5, class: 'mark',
      }), [
        em.building.addr,
        `${em.building.locality ?? ''} ${em.building.state ?? ''} ${em.building.pc ?? ''}`.trim(),
        `${em.building.providers.length} registered providers at this address`,
        em.dashed
          ? 'At least one campus here is delivered under arrangement with another organisation, not owned and operated by the provider itself.'
          : 'Both campuses here are owned and operated by their own provider.',
        'Click for everyone at this address',
      ]);
      line.addEventListener('click', () => { void openBuilding(em.building.key); });
      edges.append(line);
    });
    g.append(edges);

    nodeIds.forEach((id, i) => {
      const p = provider(id);
      const n = nodes[i];
      const dim = lit ? !lit.has(i) : false;
      const buildingsHere = buildings.filter((b) => b.providers.includes(id));
      const circle = tipped(svgEl('circle', {
        cx: n.x, cy: n.y, r: n.r,
        fill: 'var(--d-mid)',
        opacity: dim ? 0.2 : 1,
        class: `mark${p.type === 'G' ? ' gov' : ''}`,
        tabindex: 0, role: 'button',
      }), [
        providerLabel(p),
        `CRICOS provider ${p.code} · ${p.type === 'G' ? 'Government' : 'Private'}`,
        `${num(p.campuses)} campuses on the register · ${num(p.live)} courses`,
        p.med == null ? '' : `Median tuition ${perWeek(p.med)}`,
        `Shares ${buildingsHere.length} building${buildingsHere.length === 1 ? '' : 's'}:`,
        ...buildingsHere.slice(0, 4).map((b) => `  ${b.addr} (${b.providers.length} providers)`),
        buildingsHere.length > 4 ? `  …and ${buildingsHere.length - 4} more` : '',
        'Click to highlight its cluster and open the provider',
      ]);
      const open = () => {
        selected = selected === id ? null : id;
        draw();
        if (selected != null) void openProvider(id);
      };
      circle.addEventListener('click', open);
      circle.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
      });
      g.append(circle);
    });

    // Label the biggest buildings, once the reader zooms enough to read them.
    for (const b of buildings.filter((x) => x.providers.length >= 4).slice(0, 30)) {
      const pts = b.providers.map((id) => nodes[index.get(id)!]).filter(Boolean);
      if (pts.length < 2) continue;
      const cx = pts.reduce((s, n) => s + n.x, 0) / pts.length;
      const cy = pts.reduce((s, n) => s + n.y, 0) / pts.length;
      const label = text(cx, cy - 22, truncEsc(b.addr, 30).replace(/&amp;/g, '&'), {
        'text-anchor': 'middle', class: 'axis-label', fill: 'var(--ink-2)',
      });
      label.setAttribute('pointer-events', 'none');
      g.append(label);
    }

    graphHost.append(svg);
    attachSvgZoom(svg, { maxScale: 12 });

    // Clicking empty canvas clears the selection.
    svg.addEventListener('click', (e) => {
      if (e.target === svg) { selected = null; draw(); }
    });
  }

  drawControls();
  draw();
  void locationTypeName;
  void esc;
  void gloss;
  void OWNED;
}
