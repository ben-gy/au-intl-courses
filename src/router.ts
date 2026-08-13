// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Hash routing: `#/view?k=v`. Small enough not to want a library.
//
// One thing this router deliberately never carries: the reader's own quote.
// The "what were you quoted?" box promises the number stays in the browser, and
// a URL parameter would put it in the address bar, in history, and in every
// screenshot they share. That promise is kept here, by omission.

export interface Route { view: string; params: URLSearchParams }

export const DEFAULT_VIEW = 'same-qualification';

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { view: path || DEFAULT_VIEW, params: new URLSearchParams(query) };
}

export function currentRoute(): Route {
  return parseHash(location.hash);
}

export function buildHash(view: string, params?: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  return `#/${view}${qs ? `?${qs}` : ''}`;
}

export function navigate(view: string, params?: Record<string, string | number | null | undefined>): void {
  const next = buildHash(view, params);
  if (location.hash === next) {
    dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  location.hash = next;
}

/** Replace query params on the CURRENT view without adding a history entry. */
export function setParams(params: Record<string, string | number | null | undefined>): void {
  const { view, params: existing } = currentRoute();
  const merged: Record<string, string> = {};
  for (const [k, v] of existing) merged[k] = v;
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') delete merged[k];
    else merged[k] = String(v);
  }
  history.replaceState(null, '', buildHash(view, merged));
}

export function onRouteChange(fn: (route: Route) => void): void {
  addEventListener('hashchange', () => fn(currentRoute()));
}
