// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Global hover tooltip driven by [data-tip] attributes anywhere in the document.
// Copied from gh-site-factory/patterns/tooltip.ts (canonical fleet pattern).
//
// THE CSS IS NOT OPTIONAL AND IS NOT IN THIS FILE. `initTooltip` shows and hides
// purely by toggling a `visible` class. A stylesheet that defines `.hover-tip`
// but not `.hover-tip.visible` paints the tooltip on the first hover and never
// hides it again — it just follows the pointer around the page forever. The
// class is toggled correctly the whole time and nothing errors. Both rules are
// asserted by the test suite.

let tip: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hover-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function position(el: HTMLDivElement, x: number, y: number): void {
  const pad = 12;
  const rect = el.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 14;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

export function initTooltip(): void {
  let activeText = '';
  document.addEventListener('mouseover', (e) => {
    const target = (e.target as Element).closest('[data-tip]');
    if (!target) return;
    const text = target.getAttribute('data-tip') ?? '';
    if (!text) return;
    activeText = text;
    const el = ensure();
    el.textContent = text;
    el.classList.add('visible');
    position(el, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip || !tip.classList.contains('visible')) return;
    const target = (e.target as Element).closest('[data-tip]');
    if (!target || target.getAttribute('data-tip') !== activeText) {
      tip.classList.remove('visible');
      return;
    }
    position(tip, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', (e) => {
    const target = (e.target as Element).closest('[data-tip]');
    if (target && tip) tip.classList.remove('visible');
  });
  // A tooltip that survives a view swap hangs over the next view. Scrolling and
  // navigating both dismiss it.
  document.addEventListener('scroll', () => tip?.classList.remove('visible'), true);
  addEventListener('hashchange', () => tip?.classList.remove('visible'));
}
