// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// THE DISMISSAL CONTRACT, asserted by STATE rather than by "the handler ran".
//
// A modal you cannot close makes an entire site unusable, and the failure mode
// that ships it is not a missing handler. A sibling site shipped with a working
// ✕, a working scrim listener AND working Escape, and was still impossible to
// dismiss, because a `display` from a class outranked the browser's
// `[hidden]{display:none}` and CSS kept the overlay on screen no matter what the
// handlers set. Only an assertion about what is actually RENDERED catches that.
//
// Each exit is tested independently with the overlay re-opened in between,
// because "at least one of the four works" is not the contract. All four are.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeAllOverlays, closeButton, openOverlay } from '../src/overlay';

// Read from the project root: under the jsdom environment `import.meta.url` is
// an http: URL, which the fs module refuses.
const STYLES = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/**
 * jsdom has no PointerEvent. Substituting a MouseEvent would quietly test a
 * DIFFERENT event family from the one the scrim listens for, so the polyfill
 * carries pointerType — the touch path is the one that has broken before.
 */
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: MouseEventInit & { pointerType?: string; isPrimary?: boolean } = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}
// @ts-expect-error — installing the polyfill jsdom lacks
globalThis.PointerEvent = TestPointerEvent;

function open(label = 'Test overlay') {
  return openOverlay({
    panelClass: 'drawer',
    label,
    lockScroll: true,
    build(panel, close) {
      const head = document.createElement('div');
      head.append(closeButton(close, 'Close'));
      const p = document.createElement('p');
      p.textContent = 'Body content';
      panel.append(head, p);
    },
  });
}

const isRendered = (el: Element | null) => !!el && document.contains(el);

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  closeAllOverlays();
});

describe('the [hidden] guard', () => {
  it('is present in the stylesheet with !important', () => {
    // Not a style assertion — a SOURCE assertion. jsdom does not apply the real
    // stylesheet, and this specific rule is the one whose absence shipped an
    // undismissable modal on a sibling site.
    expect(STYLES).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('is declared BEFORE any component rule that sets a display', () => {
    const guard = STYLES.indexOf('[hidden]');
    const firstDisplay = STYLES.search(/\.(drawer|modal|overlay-host|gloss-pop|search-results)[^{]*\{[^}]*display:/);
    expect(guard).toBeGreaterThan(-1);
    if (firstDisplay > -1) expect(guard).toBeLessThan(firstDisplay);
  });
});

describe('the tooltip stylesheet contract', () => {
  it('defines BOTH .hover-tip and .hover-tip.visible', () => {
    // initTooltip hides purely by removing `.visible`. Without the second rule
    // the tooltip is painted on first hover and then follows the pointer around
    // the page forever. The class toggles correctly the whole time.
    expect(STYLES).toMatch(/\.hover-tip\s*\{/);
    expect(STYLES).toMatch(/\.hover-tip\.visible\s*\{[^}]*opacity:\s*1/);
  });
});

describe('exit 1 — the ✕ control', () => {
  it('removes the panel from the document', () => {
    const h = open();
    expect(isRendered(h.panel)).toBe(true);
    h.panel.querySelector<HTMLButtonElement>('.icon-close')!.click();
    expect(isRendered(h.panel)).toBe(false);
    expect(h.isOpen()).toBe(false);
  });

  it('is bound to `click`, so Enter and Space reach it', () => {
    // A ✕ wired to pointerdown alone is dead to every keyboard and screen
    // reader user, because a <button> synthesises a CLICK from Enter/Space.
    const h = open();
    const btn = h.panel.querySelector<HTMLButtonElement>('.icon-close')!;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(isRendered(h.panel)).toBe(true);  // keydown alone does nothing…
    btn.click();                              // …the synthesised click closes it
    expect(isRendered(h.panel)).toBe(false);
  });

  it('has an accessible name and a real hit area in the stylesheet', () => {
    const h = open();
    expect(h.panel.querySelector('.icon-close')!.getAttribute('aria-label')).toBeTruthy();
    expect(STYLES).toMatch(/\.icon-close\s*\{[^}]*width:\s*44px/);
    expect(STYLES).toMatch(/\.icon-close\s*\{[^}]*height:\s*44px/);
    h.close();
  });
});

describe('exit 2 — a mouse press on the scrim', () => {
  it('closes the overlay', () => {
    const h = open();
    h.scrim.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    expect(isRendered(h.panel)).toBe(false);
  });

  it('has a scrim that is actually reachable — a real fixed box, not pointer-events:none', () => {
    const h = open();
    expect(document.contains(h.scrim)).toBe(true);
    expect(h.scrim.classList.contains('scrim')).toBe(true);
    expect(STYLES).toMatch(/\.scrim\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
    expect(STYLES).not.toMatch(/\.scrim\s*\{[^}]*pointer-events:\s*none/);
    h.close();
  });
});

describe('exit 3 — Escape', () => {
  it('closes from anywhere on the page, not just from inside the panel', () => {
    const h = open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isRendered(h.panel)).toBe(false);
  });

  it('does not leave its keydown listener behind after closing', () => {
    const h = open();
    h.close();
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    expect(h.isOpen()).toBe(false);
  });
});

describe('exit 4 — a real TOUCH sequence outside the panel', () => {
  it('closes, and does NOT double-fire back open', () => {
    // The classic phone bug: a control wired to both touchstart and click fires
    // twice, closing and instantly reopening, which the user experiences as
    // "the close button does nothing".
    const h = open();
    h.scrim.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }));
    h.scrim.dispatchEvent(new TestPointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true }));
    expect(isRendered(h.panel)).toBe(false);
    expect(document.querySelectorAll('.overlay-host').length).toBe(0);
  });
});

describe('every exit works independently, with the overlay re-opened between each', () => {
  it('all four, in sequence', () => {
    const byButton = open();
    byButton.panel.querySelector<HTMLButtonElement>('.icon-close')!.click();
    expect(isRendered(byButton.panel)).toBe(false);

    const byScrim = open();
    byScrim.scrim.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(isRendered(byScrim.panel)).toBe(false);

    const byEscape = open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isRendered(byEscape.panel)).toBe(false);

    const byTouch = open();
    byTouch.scrim.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    expect(isRendered(byTouch.panel)).toBe(false);
  });
});

describe('the closed panel is DETACHED, not parked off-screen', () => {
  it('leaves nothing in the document at all', () => {
    // An off-screen fixed box is still a real box on iOS Safari and silently
    // gives the page a horizontal scroll that `overflow-x: clip` neither
    // prevents nor lets scrollWidth detect.
    const h = open();
    h.close();
    expect(document.querySelectorAll('.drawer').length).toBe(0);
    expect(document.querySelectorAll('.overlay-host').length).toBe(0);
  });

  it('never relies on a translateX(100%) parking spot in the stylesheet', () => {
    expect(STYLES).not.toMatch(/\.drawer[^{]*\{[^}]*translateX\(100%\)/);
  });
});

describe('focus handling', () => {
  it('moves focus into the panel on open', () => {
    const h = open();
    expect(h.panel.contains(document.activeElement)).toBe(true);
    h.close();
  });

  it('restores focus to whatever opened it', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const h = open();
    expect(document.activeElement).not.toBe(trigger);
    h.close();
    expect(document.activeElement).toBe(trigger);
  });

  it('declares itself a modal dialog with a name', () => {
    const h = open('Alpha College — provider details');
    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.panel.getAttribute('aria-modal')).toBe('true');
    expect(h.panel.getAttribute('aria-label')).toBe('Alpha College — provider details');
    h.close();
  });
});

describe('the scroll lock', () => {
  it('locks the body while open and releases it on close', () => {
    const h = open();
    expect(document.body.classList.contains('drawer-open')).toBe(true);
    h.close();
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });

  it('is derived from the DOM, so it cannot drift when overlays close out of order', () => {
    const a = open('A');
    const b = open('B');
    expect(document.body.classList.contains('drawer-open')).toBe(true);
    a.close();
    expect(document.body.classList.contains('drawer-open')).toBe(true); // B is still open
    b.close();
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });

  it('releases the lock when an overlay is removed directly, bypassing close()', () => {
    const h = open();
    h.host.remove();
    closeAllOverlays();
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });
});

describe('navigation teardown', () => {
  it('closeAllOverlays leaves nothing rendered', () => {
    open('A');
    open('B');
    closeAllOverlays();
    expect(document.querySelectorAll('.overlay-host').length).toBe(0);
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });

  it('a second close() is a no-op rather than an error', () => {
    const h = open();
    h.close();
    expect(() => h.close()).not.toThrow();
  });

  it('fires onClose exactly once, even via closeAllOverlays', () => {
    // onClose clears the ?provider= deep link. If closeAllOverlays yanked the
    // host out of the DOM instead of running the real teardown, the URL would
    // keep a provider that is no longer open and a reload would reopen it.
    let calls = 0;
    openOverlay({ panelClass: 'drawer', label: 'x', build: () => {}, onClose: () => { calls++; } });
    closeAllOverlays();
    closeAllOverlays();
    expect(calls).toBe(1);
  });
});

describe('the map cannot paint over an overlay', () => {
  it('isolates the Leaflet container and puts every overlay far above its panes', () => {
    // Leaflet gives its own panes and controls z-index up to 1000. Unless the
    // container establishes a stacking context, those children escape to the
    // page root and paint OVER modals — a whole About panel once shipped hidden
    // underneath a map.
    expect(STYLES).toMatch(/\.map-host\s*\{[^}]*isolation:\s*isolate/);
    expect(STYLES).toMatch(/\.map-host\s*\{[^}]*z-index:\s*0/);
    const zIndex = (sel: string) => {
      const m = new RegExp(`${sel}[^{]*\\{[^}]*z-index:\\s*(\\d+)`).exec(STYLES);
      return m ? Number(m[1]) : -1;
    };
    expect(zIndex('\\.overlay-host')).toBeGreaterThan(1000);
    expect(zIndex('\\.modal, \\.drawer')).toBeGreaterThan(1000);
    expect(zIndex('\\.gloss-pop')).toBeGreaterThan(1000);
    expect(zIndex('\\.hover-tip')).toBeGreaterThan(1000);
  });
});
