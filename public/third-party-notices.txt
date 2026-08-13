# Third-party notices

This list is derived from what actually ships — the `sources` arrays in
`dist/**/*.js.map` — rather than from the dependency tree, so it reflects the
components a visitor's browser really downloads.

The site itself is [AGPL-3.0-or-later](./LICENSE) with an
[additional attribution term](./ADDITIONAL-TERMS.md). Everything below keeps its
own licence.

No web fonts are used. The typeface is whatever the reader's own system provides.

---

## Bundled into the site

### Leaflet 1.9.4 — BSD 2-Clause

<https://leafletjs.com/> · <https://github.com/Leaflet/Leaflet>

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Served to the browser at runtime

### CARTO Positron basemap tiles

Map tiles © [CARTO](https://carto.com/attributions), map data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available
under the Open Database Licence. The attribution is rendered by Leaflet in the
corner of every map.

### Cloudflare Web Analytics

`static.cloudflareinsights.com/beacon.min.js` — cookie-less, anonymous page-view
counts. No other analytics is present, and no first-party code sets a cookie or
writes to browser storage.

### Feedback widget

`feedback.benrichardson.dev/w.js` — the hosted feedback dialog, © Ben Richardson.

---

## Data, which is licensed separately from this code

### Commonwealth Register of Institutions and Courses for Overseas Students (CRICOS)

Australian Government Department of Education, published on
[data.gov.au](https://data.gov.au/data/dataset/cricos) under the
[Creative Commons Attribution 2.5 Australia](http://creativecommons.org/licenses/by/2.5/au/)
licence. Attribution is required, and is rendered in the site footer and in the
About panel.

### Australian Statistical Geography Standard — Postal Areas, 2021

Australian Bureau of Statistics, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Boundaries are simplified with mapshaper; the geometry is otherwise unmodified
ABS source data.

### Australian postcode centroids

[matthewproctor/australianpostcodes](https://github.com/matthewproctor/australianpostcodes),
CC BY 4.0, itself derived from Australia Post and ABS sources.

---

## Build-time only, not shipped to the browser

`vite`, `typescript`, `vitest`, `jsdom`, `mapshaper`, `@types/*` — development
dependencies. None of their code is included in the published site.
