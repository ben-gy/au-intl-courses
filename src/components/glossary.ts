// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Click-to-open definition popover for every [data-term] in the document.
//
// It sits at z-index 2300 — above Leaflet's panes, which reach 1000 and would
// otherwise paint over a definition opened while the map view is active.

import { GLOSSARY } from '../glossary';
import { esc } from '../format';

let pop: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'gloss-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Definition');
    pop.hidden = true;
    document.body.appendChild(pop);
  }
  return pop;
}

function hide(): void {
  if (pop) pop.hidden = true;
}

function show(anchor: Element, term: string): void {
  const def = GLOSSARY[term];
  const el = ensure();
  el.innerHTML = def
    ? `<strong>${esc(term)}</strong>${esc(def)}`
    : `<strong>${esc(term)}</strong>No definition has been written for this term yet.`;
  el.hidden = false;

  // Measure after unhiding — a hidden element has no box, and positioning
  // against a zero-size rect parks the popover in the top-left corner.
  const a = anchor.getBoundingClientRect();
  const p = el.getBoundingClientRect();
  const pad = 10;
  let left = a.left;
  let top = a.bottom + 8;
  if (left + p.width + pad > innerWidth) left = innerWidth - p.width - pad;
  if (top + p.height + pad > innerHeight) top = a.top - p.height - 8;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest?.('[data-term]');
    if (link) {
      e.preventDefault();
      const term = link.getAttribute('data-term') ?? '';
      // A second click on the same term closes it, so the affordance is not a
      // one-way door.
      if (pop && !pop.hidden && pop.dataset.term === term) { hide(); return; }
      show(link, term);
      ensure().dataset.term = term;
      return;
    }
    if (pop && !pop.hidden && !(e.target as Element).closest?.('.gloss-pop')) hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  addEventListener('hashchange', hide);
  addEventListener('resize', hide);
}
