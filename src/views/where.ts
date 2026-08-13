// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Where you can physically study, on real ABS POA_2021 postcode boundaries.
//
// Four traps this view handles on purpose:
//
//  1. `fitBounds` on a 0×0 container returns MAXIMUM zoom and renders a perfect
//     map of one street corner, silently. The fit is therefore deferred until
//     the container actually has layout, and re-run when it resizes.
//  2. Leaflet gives its own panes and controls z-index up to 1000, and unless
//     the container establishes a stacking context those children escape to the
//     page root and paint OVER modals and drawers. `.map-host` carries
//     `isolation: isolate; position: relative; z-index: 0` for exactly that.
//  3. There is NO lat/lon in CRICOS. Every marker is a postcode CENTROID, not a
//     building — and that sentence is printed on the map, in the tooltips and
//     in the glossary rather than buried in a footnote.
//  4. A course taught at several campuses is counted at each of them, so the
//     postcode course counts sum to more than the number of courses. The
//     tooltip says so.

import 'leaflet/dist/leaflet.css';
import type * as L from 'leaflet';
import { CAMPUS_RAMP, COURSE_RAMP, PRICE_RAMP, PROVIDER_RAMP, bucket, rampFill } from '../scales';
import { esc, num, perWeek, providerLabel, tipAttr } from '../format';
import { loadBoundaries, loadPlaces, locationTypeName, meta, provider } from '../data';
import { gloss } from '../glossary';
import { openOverlay, closeButton } from '../overlay';
import { openProvider } from '../components/drawers';
import { setParams, currentRoute } from '../router';
import type { GeoRow, PlacesPayload } from '../types';

type Metric = 'providers' | 'campuses' | 'courses' | 'price';

const METRICS: [Metric, string][] = [
  ['providers', 'distinct providers'],
  ['campuses', 'campuses'],
  ['courses', 'courses taught here'],
  ['price', 'median tuition per week'],
];

const RAMPS: Record<Metric, typeof PROVIDER_RAMP> = {
  providers: PROVIDER_RAMP, campuses: CAMPUS_RAMP, courses: COURSE_RAMP, price: PRICE_RAMP,
};

const STATE_ORDER = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'ACT', 'TAS', 'NT'];

export async function renderWhere(host: HTMLElement): Promise<void> {
  const [places, boundaries, leaflet] = await Promise.all([
    loadPlaces(), loadBoundaries(), import('leaflet'),
  ]);

  const route = currentRoute();
  let metric: Metric = (route.params.get('metric') as Metric) || 'providers';
  let stateFilter = route.params.get('state') ?? '';

  const byPc = new Map(places.geo.map((g) => [g.pc, g]));

  host.innerHTML = `
    <div class="view-head">
      <h1>Where you can physically study</h1>
      <p class="view-sub">Every campus on the register, placed by postcode. ${gloss('postcode', 'CRICOS records an address but no coordinates')},
        so a dot is the middle of a postcode, not a building — in a city centre, dozens of colleges share one dot.
        Postcode 3000 alone holds campuses of ${num(byPc.get('3000')?.providers ?? 0)} different providers.</p>
    </div>
    <div class="panel">
      <div class="controls" id="metric-chips"></div>
      <div class="controls" id="state-strip"></div>
      <div class="legend" id="legend"></div>
    </div>
    <div class="map-host" id="map"></div>
    <p class="small muted" id="map-note"></p>`;

  const mapHost = host.querySelector<HTMLElement>('#map')!;
  const legend = host.querySelector<HTMLElement>('#legend')!;
  const chips = host.querySelector<HTMLElement>('#metric-chips')!;
  const strip = host.querySelector<HTMLElement>('#state-strip')!;
  const note = host.querySelector<HTMLElement>('#map-note')!;

  // A view is set SYNCHRONOUSLY at construction. Leaflet renders nothing at all
  // — no tiles, no layers, no error — until it has one, and deferring that to a
  // requestAnimationFrame means a page opened in a BACKGROUND tab gets an empty
  // grey box: rAF does not fire in a hidden tab, so the callback never runs and
  // the map is still viewless when the reader finally switches to it.
  const map = leaflet.map(mapHost, { preferCanvas: false, scrollWheelZoom: true, zoomControl: true })
    .setView([-27, 133], 4);
  leaflet.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 18,
  }).addTo(map);

  const val = (g: GeoRow): number | null =>
    metric === 'providers' ? g.providers
      : metric === 'campuses' ? g.campuses
        : metric === 'courses' ? g.courses
          : g.med;

  const rowTip = (g: GeoRow) => tipAttr(
    `Postcode ${g.pc}${g.locality ? ` — ${g.locality}` : ''}${g.state ? `, ${g.state}` : ''}`,
    `${num(g.providers)} distinct providers · ${num(g.campuses)} campuses`,
    `${num(g.courses)} course–campus records (a course taught at three campuses is counted three times)`,
    g.med == null ? 'No believable price recorded here' : `Median tuition ${perWeek(g.med)}`,
    'Click for every provider with a campus here',
  );

  let polygons: L.GeoJSON | null = null;
  let markers: L.LayerGroup | null = null;

  function style(pc: string): L.PathOptions {
    const g = byPc.get(pc);
    const v = g ? val(g) : null;
    const visible = !stateFilter || g?.state === stateFilter;
    return {
      fillColor: v == null ? 'var(--absent)' : rampFill(RAMPS[metric], v),
      fillOpacity: visible ? 0.82 : 0.15,
      color: '#ffffff', weight: 0.6, opacity: visible ? 0.6 : 0.2,
    };
  }

  function drawLayers(): void {
    polygons?.remove();
    markers?.remove();

    polygons = leaflet.geoJSON(boundaries as GeoJSON.FeatureCollection, {
      style: (f) => style(String(f?.properties?.pc ?? '')),
      onEachFeature: (f, layer) => {
        const pc = String(f.properties?.pc ?? '');
        const g = byPc.get(pc);
        if (!g) return;
        layer.bindTooltip(rowTip(g).replace(/&#10;/g, '\n'), { sticky: true });
        layer.on('click', () => openPostcode(g, places));
      },
    }).addTo(map);

    // Markers carry the extreme magnitudes at national zoom, where a CBD
    // polygon is a couple of pixels wide and its fill is invisible.
    //
    // They are sized conservatively and hollow-ish on purpose. Sizing on
    // sqrt(providers) alone put a 26px disc on every CBD postcode, and since
    // the CBD postcodes are neighbours the discs merged into one blob that hid
    // both each other and the boundaries underneath. Small, translucent, with a
    // visible outline reads as "many of them here" without erasing the map.
    const group = leaflet.layerGroup();
    for (const g of places.geo) {
      if (g.lat == null || g.lon == null) continue;
      if (stateFilter && g.state !== stateFilter) continue;
      const v = val(g);
      const magnitude = metric === 'price' ? 9 : (v ?? 1);
      const r = Math.max(2.5, Math.min(14, Math.sqrt(magnitude) * (metric === 'providers' ? 0.85 : metric === 'campuses' ? 0.7 : 0.16)));
      const m = leaflet.circleMarker([g.lat, g.lon], {
        radius: r,
        fillColor: v == null ? '#cbd5d8' : rampFill(RAMPS[metric], v),
        fillOpacity: 0.5, color: '#ffffff', weight: 1, opacity: 0.85,
      });
      m.bindTooltip(rowTip(g).replace(/&#10;/g, '\n'), { sticky: true });
      m.on('click', () => openPostcode(g, places));
      group.addLayer(m);
    }
    group.addTo(map);
    markers = group;
    applyMarkerVisibility();
  }

  /**
   * Once the reader is zoomed in far enough for a postcode polygon to be a real
   * shape, the marker on top of it is just an obstruction — so it goes away.
   */
  function applyMarkerVisibility(): void {
    const showMarkers = map.getZoom() < 9;
    for (const layer of (markers?.getLayers() ?? [])) {
      const el = (layer as L.CircleMarker).getElement() as SVGElement | null;
      if (el) el.style.display = showMarkers ? '' : 'none';
    }
  }
  map.on('zoomend', applyMarkerVisibility);

  function drawChrome(): void {
    const r = RAMPS[metric];
    chips.innerHTML = '<span class="control-label">Shade by</span>' + METRICS.map(([id, label]) =>
      `<button type="button" class="chip" data-metric="${id}" aria-pressed="${metric === id}">${label}</button>`).join('');
    for (const b of chips.querySelectorAll<HTMLElement>('[data-metric]')) {
      b.addEventListener('click', () => {
        metric = b.dataset.metric as Metric;
        setParams({ metric: metric === 'providers' ? null : metric });
        drawChrome();
        drawLayers();
      });
    }

    const stateCounts = new Map<string, number>();
    for (const c of places.campuses) if (c.state) stateCounts.set(c.state, (stateCounts.get(c.state) ?? 0) + 1);
    strip.innerHTML = '<span class="control-label">Jump to</span>'
      + `<button type="button" class="chip" data-state="" aria-pressed="${!stateFilter}">all of Australia</button>`
      + STATE_ORDER.filter((s) => stateCounts.has(s)).map((s) =>
        `<button type="button" class="chip" data-state="${s}" aria-pressed="${stateFilter === s}">${s}<span class="n">${num(stateCounts.get(s) ?? 0)}</span></button>`).join('');
    for (const b of strip.querySelectorAll<HTMLElement>('[data-state]')) {
      b.addEventListener('click', () => {
        stateFilter = b.dataset.state ?? '';
        setParams({ state: stateFilter || null });
        drawChrome();
        drawLayers();
        fit();
      });
    }

    legend.innerHTML = `<span class="legend-title">${r.title} <span class="muted">(${r.unit})</span></span>`
      + r.labels.map((l, i) => `<span class="legend-item"><span class="legend-swatch" style="background:${r.colours[i]}"></span>${l}</span>`).join('')
      + `<span class="legend-item"><span class="legend-swatch hatched"></span>no value recorded</span>`;

    const m = meta();
    note.innerHTML = `${num(m.counts.geocodedCampuses)} of ${num(m.counts.campusCount)} campuses are placed
      (${num(m.counts.campusCount - m.counts.geocodedCampuses)} have a postcode with no published centroid).
      ${num(m.boundaries.matched)} of ${num(m.boundaries.wanted)} campus postcodes have an ABS boundary polygon;
      the rest are PO-box or single-institution postcodes the Australian Bureau of Statistics does not draw, so those
      campuses appear as a dot with no shaded area. Boundaries: ABS ASGS 2021 Postal Areas, simplified.`;
  }

  /**
   * Fit only once the container really has layout. fitBounds on a 0×0 box
   * returns MAXIMUM zoom and renders a flawless map of one street corner with
   * no error anywhere.
   */
  function fit(attempt = 0): void {
    const run = () => {
      // fitBounds on a 0×0 container returns MAXIMUM zoom and renders a
      // flawless map of one street corner, silently. So the fit waits for real
      // layout — but it gives up after a bounded number of tries and leaves the
      // synchronous national view in place rather than retrying forever.
      if (!mapHost.clientWidth || !mapHost.clientHeight) {
        if (attempt < 60) setTimeout(() => fit(attempt + 1), 50);
        return;
      }
      map.invalidateSize();
      const pts = places.geo
        .filter((g) => g.lat != null && g.lon != null && (!stateFilter || g.state === stateFilter))
        .map((g) => [g.lat!, g.lon!] as [number, number]);
      if (pts.length) map.fitBounds(leaflet.latLngBounds(pts).pad(0.08));
      else map.setView([-27, 133], 4);
    };
    // Both paths, because rAF alone is dead in a background tab and a timeout
    // alone would fit before the browser has done layout on a visible one.
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }

  drawChrome();
  drawLayers();
  fit();

  // The drawer opening introduces a scrollbar, which resizes the map; without
  // re-invalidating, the centre drifts every time one is opened.
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(mapHost);
}

function openPostcode(g: GeoRow, places: PlacesPayload): void {
  const here = places.campuses.filter((c) => c.pc === g.pc);
  const byProvider = new Map<number, typeof here>();
  for (const c of here) {
    if (!byProvider.has(c.p)) byProvider.set(c.p, []);
    byProvider.get(c.p)!.push(c);
  }
  const rows = [...byProvider.entries()].sort((a, b) =>
    b[1].reduce((n, c) => n + c.courses, 0) - a[1].reduce((n, c) => n + c.courses, 0));

  openOverlay({
    panelClass: 'drawer',
    label: `Postcode ${g.pc} — providers with a campus here`,
    lockScroll: true,
    build(panel, close) {
      const head = document.createElement('div');
      head.className = 'overlay-head';
      const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
      head.innerHTML = `<h2>Postcode ${esc(g.pc)}<span class="sub">${esc(g.locality ?? '')}${g.state ? `, ${esc(g.state)}` : ''} · ${plural(rows.length, 'provider', 'providers')} · ${plural(g.campuses, 'campus', 'campuses')}</span></h2>`;
      head.append(closeButton(close, 'Close'));
      const body = document.createElement('div');
      body.className = 'overlay-body';
      body.innerHTML = `
        <div class="table-scroll"><table><thead><tr>
          <th>Provider</th><th>Campuses here</th><th class="num">Courses</th><th class="num">Median</th>
        </tr></thead><tbody>
        ${rows.map(([pi, cams]) => {
          const p = provider(pi);
          return `<tr class="clickable" data-provider="${pi}">
            <td>${esc(providerLabel(p))} ${p.type === 'G' ? '<span class="badge gov">Government</span>' : ''}
              <div class="small dim mono">${esc(p.code)}</div></td>
            <td class="small">${cams.map((c) => `${esc(c.name)} <span class="dim">(${esc(locationTypeName(c.t))})</span>`).join('<br>')}</td>
            <td class="num">${num(cams.reduce((n, c) => n + c.courses, 0))}</td>
            <td class="num">${p.med == null ? '—' : perWeek(p.med)}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
        <p class="small muted">Course counts here are course–campus records: a course taught at three campuses in this
          postcode is counted three times.</p>`;
      panel.append(head, body);
      for (const tr of body.querySelectorAll<HTMLElement>('tr[data-provider]')) {
        tr.addEventListener('click', () => { close(); void openProvider(Number(tr.dataset.provider)); });
      }
    },
  });
}

export { bucket };
