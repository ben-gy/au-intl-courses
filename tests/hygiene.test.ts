// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Source-hygiene tests. These turn the site's stated refusals into build
// failures rather than good intentions — a refusal nobody checks is a refusal
// that erodes with the third edit.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '.cache', 'snapshots'].includes(name)) continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SRC = walk(resolve(ROOT, 'src'));
const PIPELINE = walk(resolve(ROOT, 'pipeline'));
const CODE = [...SRC, ...PIPELINE].filter((f) => ['.ts', '.mjs', '.js'].includes(extname(f)));
const TEXT_SOURCES = [...SRC, resolve(ROOT, 'index.html')];

/**
 * Read a source file with its comments stripped.
 *
 * Every refusal in this file is documented in a comment right next to the code
 * that upholds it — so scanning raw text makes each guard fire on its own
 * explanation. Strip comments first and the guard tests what actually ships.
 */
function code(f: string): string {
  return readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the enrolment refusal', () => {
  it('never presents a course or campus count as students, size or market share', () => {
    // The single most damaging misreading available: CRICOS holds NO enrolment
    // data at all, so a course count is catalogue breadth and nothing else.
    const offenders: string[] = [];
    for (const f of TEXT_SOURCES) {
      if (!['.ts', '.html'].includes(extname(f))) continue;
      const text = extname(f) === '.ts' ? code(f) : readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(market share|biggest (?:college|provider)|largest (?:college|provider)|student numbers|enrolment(?:s)? (?:of|at))\b/gi)) {
        const around = text.slice(Math.max(0, m.index! - 160), m.index! + 160);
        const isDisclaimer = /never|not\b|no\b|cannot|refuse|zero|publishes no/i.test(around);
        if (!isDisclaimer) offenders.push(`${f}: …${around.replace(/\s+/g, ' ')}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('attaches the ceiling caveat wherever registered capacity is shown', () => {
    const drawers = readFileSync(resolve(ROOT, 'src/components/drawers.ts'), 'utf8');
    expect(drawers).toMatch(/legal ceiling, not a headcount/i);
    const providersView = readFileSync(resolve(ROOT, 'src/views/providersView.ts'), 'utf8');
    expect(providersView).toMatch(/legal ceiling/i);
  });
});

describe('the duration-confound refusal', () => {
  it('defaults every price encoding to dollars per teaching week', () => {
    const view = readFileSync(resolve(ROOT, 'src/views/sameQualification.ts'), 'utf8');
    expect(view).toMatch(/let unit: Unit = \(route\.params\.get\('unit'\) === 'course' \? 'course' : 'week'\)/);
  });

  it('warns in the interface whenever a whole-of-course total is being ranked', () => {
    const view = readFileSync(resolve(ROOT, 'src/views/sameQualification.ts'), 'utf8');
    expect(view).toMatch(/Whole-course totals are not comparable between providers/);
    const table = readFileSync(resolve(ROOT, 'src/views/findCourse.ts'), 'utf8');
    expect(table).toMatch(/Total is not comparable between providers/);
  });

  it('never claims a spread computed on whole-of-course cost', () => {
    const offenders: string[] = [];
    for (const f of SRC) {
      if (extname(f) !== '.ts') continue;
      for (const m of code(f).matchAll(/\b\d{2,}× (?:for|between)\b/g)) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the misreporting refusal', () => {
  it('uses one suspect threshold, shared by the pipeline and the interface', () => {
    // Two thresholds would mean the pipeline excluded one set of rows from its
    // medians while the interface flagged another, and every percentile on the
    // site would be quietly wrong.
    const pipeline = /SUSPECT_PER_WEEK = (\d+)/.exec(readFileSync(resolve(ROOT, 'pipeline/parse.mjs'), 'utf8'))?.[1];
    const client = /SUSPECT_PER_WEEK = (\d+)/.exec(readFileSync(resolve(ROOT, 'src/scales.ts'), 'utf8'))?.[1];
    expect(pipeline).toBeTruthy();
    expect(client).toBe(pipeline);
  });

  it('never deletes a flagged row — it filters the QUANTILES, not the data', () => {
    const model = readFileSync(resolve(ROOT, 'pipeline/model.mjs'), 'utf8');
    // Every offering, flagged or not, reaches `rows`; only `clean` feeds the
    // percentiles.
    expect(model).toMatch(/rows: group\.map/);
    expect(model).toMatch(/const clean = group\.filter\(\(c\) => !\(c\.flags & F_SUSPECT\)\)/);
  });
});

describe('the absence refusal', () => {
  it('never zero-fills a missing month', () => {
    const agg = readFileSync(resolve(ROOT, 'pipeline/aggregate.mjs'), 'utf8');
    expect(agg).toMatch(/providers: null, courses: null/);
    const view = readFileSync(resolve(ROOT, 'src/views/churn.ts'), 'utf8');
    expect(view).toMatch(/gap/);
  });

  it('draws absence with its own token, never the lightest ramp step', () => {
    const scales = readFileSync(resolve(ROOT, 'src/scales.ts'), 'utf8');
    expect(scales).toMatch(/return b < 0 \? 'var\(--absent\)'/);
  });
});

describe('chart encoding hygiene', () => {
  it('uses no quantile colour scale anywhere', () => {
    // A quantile scale on a $115–$5,863 distribution puts the Melbourne CBD and
    // a single suburban campus in the same darkest bucket.
    const offenders = CODE.filter((f) => /quantileScale|scaleQuantile|quantileRamp/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('never uses role="img" on a chart root', () => {
    // role="img" makes the SVG an accessibility LEAF: it prunes every focusable
    // mark inside from the tree while leaving them in the tab order, so a
    // screen-reader user tabs into things that announce nothing.
    const offenders = CODE.filter((f) => /role:\s*['"]img['"]|role=["']img["']/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('never uses a native SVG <title> as a tooltip substitute', () => {
    const offenders: string[] = [];
    for (const f of SRC) {
      if (extname(f) !== '.ts') continue;
      const text = code(f);
      if (/createElementNS\([^)]*,\s*['"]title['"]\)/.test(text) || /svgEl\(\s*['"]title['"]/.test(text)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never animates a force layout into place', () => {
    // The graph must be motionless from the first frame.
    const graph = code(resolve(ROOT, 'src/views/sharedAddresses.ts'));
    expect(graph).not.toMatch(/requestAnimationFrame/);
  });

  it('adds no charting library', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['leaflet']);
    for (const banned of ['d3', 'chart.js', 'recharts', 'plotly.js', 'echarts']) {
      expect(Object.keys(pkg.dependencies ?? {})).not.toContain(banned);
    }
  });

  it('uses no third-party fonts', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
    expect(css).not.toMatch(/@import\s+url\(/);
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@font-face/);
  });

  it('has no count badge in any nav label', () => {
    const main = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');
    const labels = [...main.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(5);
    for (const l of labels) expect(l).not.toMatch(/\d/);
  });
});

describe('map hygiene', () => {
  it('loads geometry from a real boundary file rather than hand-authored coordinates', () => {
    const where = readFileSync(resolve(ROOT, 'src/views/where.ts'), 'utf8');
    expect(where).toMatch(/loadBoundaries/);
    // A hand-authored polygon in source would be a literal coordinate array.
    expect(code(resolve(ROOT, 'src/views/where.ts'))).not.toMatch(/\[\s*-?\d{2}\.\d+\s*,\s*\d{3}\.\d+\s*\]\s*,\s*\[\s*-?\d{2}\.\d+/);
  });

  it('fits the map only after the container has layout', () => {
    // fitBounds on a 0×0 container returns MAXIMUM zoom and renders a flawless
    // map of one street corner, silently.
    const where = readFileSync(resolve(ROOT, 'src/views/where.ts'), 'utf8');
    expect(where).toMatch(/if \(!mapHost\.clientWidth \|\| !mapHost\.clientHeight\)/);
    expect(where).toMatch(/requestAnimationFrame\(run\)/);
  });

  it('takes Leaflet from npm, never from a CDN', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies.leaflet).toBeTruthy();
    for (const f of SRC) {
      if (extname(f) !== '.ts') continue;
      expect(readFileSync(f, 'utf8')).not.toMatch(/unpkg\.com\/leaflet|cdn\.jsdelivr\.net\/npm\/leaflet/);
    }
  });
});

describe('privacy', () => {
  it('never puts the reader\'s own quote in the URL or in storage', () => {
    // The quote box promises the number stays in the browser. A URL parameter
    // would put it in the address bar, in history and in every screenshot.
    const view = code(resolve(ROOT, 'src/views/sameQualification.ts'));
    expect(view).not.toMatch(/localStorage|sessionStorage/);
    expect(view).not.toMatch(/setParams\(\{[^}]*quote/);
  });

  it('ships no storage or tracking of any kind in first-party code', () => {
    for (const f of SRC) {
      if (extname(f) !== '.ts') continue;
      expect(code(f)).not.toMatch(/document\.cookie|localStorage\.setItem|navigator\.sendBeacon/);
    }
  });
});

describe('licensing hygiene', () => {
  it('puts an SPDX header on every first-party source file', () => {
    const missing = CODE.filter((f) => !readFileSync(f, 'utf8').includes('SPDX-License-Identifier'));
    expect(missing).toEqual([]);
  });

  it('declares AGPL in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(pkg.license).toBe('AGPL-3.0-or-later');
  });

  it('ships the four licensing files', () => {
    for (const f of ['LICENSE', 'ADDITIONAL-TERMS.md', 'CONTRIBUTING.md', 'THIRD-PARTY-NOTICES.md']) {
      expect(() => statSync(resolve(ROOT, f))).not.toThrow();
    }
    expect(readFileSync(resolve(ROOT, 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });

  it('keeps the CC BY attribution in the INTERFACE, not only in the repo', () => {
    // The data licence is separate from the code licence and is not ours to
    // change. CC BY requires attribution, and it must stay visible.
    const about = readFileSync(resolve(ROOT, 'src/about.ts'), 'utf8');
    const main = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');
    expect(about).toMatch(/meta\.source\.licence/);
    expect(main).toMatch(/m\.source\.licence/);
    expect(main).toMatch(/Department of Education|source\.publisher/);
  });
});

describe('page hygiene', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

  it('keeps the mandatory analytics beacon and the feedback widget', () => {
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
    expect(html).toContain('https://feedback.benrichardson.dev/w.js');
  });

  it('does not mount the feedback widget a second time from source', () => {
    // The hosted script self-mounts. A local copy would produce two widgets.
    expect(SRC.filter((f) => readFileSync(f, 'utf8').includes('mountFeedback'))).toEqual([]);
  });

  it('has no canonical link — Pages already redirects the .github.io host', () => {
    expect(html).not.toMatch(/rel=["']canonical["']/);
  });

  it('carries the social card and structured data', () => {
    expect(html).toContain('og:image');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('creativecommons.org/licenses/by/2.5/au/');
  });

  it('never links to the GitHub repository from the interface', () => {
    for (const f of TEXT_SOURCES) {
      if (!['.ts', '.html'].includes(extname(f))) continue;
      expect(readFileSync(f, 'utf8')).not.toMatch(/https:\/\/github\.com\//);
    }
  });

  it('keeps the attribution and the directory backlink in the footer', () => {
    const main = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8');
    expect(main).toContain('https://benrichardson.dev/');
    expect(main).toContain('https://lab.benrichardson.dev');
  });

  it('pins the footer to the bottom even when a view is short', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
    expect(css).toMatch(/#app\s*\{[^}]*min-height:\s*100vh[^}]*flex/);
    expect(css).toMatch(/\.main-content\s*\{[^}]*flex:\s*1 0 auto/);
    expect(css).toMatch(/\.site-footer\s*\{[^}]*flex-shrink:\s*0/);
  });

  it('uses overflow-x: clip on the body, never hidden', () => {
    // `overflow-x: hidden` silently kills `position: sticky` on every
    // descendant, which parks the header mid-page. Comments are stripped first,
    // or this guard fires on the comment that explains it.
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(css).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*clip/);
    expect(css).not.toMatch(/body\s*\{[\s\S]{0,400}overflow-x:\s*hidden/);
  });
});

describe('mobile layout hygiene', () => {
  it('gives every truncating grid child a min-width of 0', () => {
    // A flex/grid child with `white-space: nowrap` refuses to shrink below its
    // content width, and its min-content forces the row — and the page — wider
    // than the viewport. This is the number one cause of sideways scroll.
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
    const truncating = [...css.matchAll(/\.([a-z-]+)\s*\{([^}]*white-space:\s*nowrap[^}]*)\}/g)];
    expect(truncating.length).toBeGreaterThan(0);
    for (const [, name, body] of truncating) {
      if (/text-overflow:\s*ellipsis/.test(body)) {
        expect(body, `.${name} truncates but does not set min-width: 0`).toMatch(/min-width:\s*0/);
      }
    }
  });

  it('never sizes an auto-fill grid track with a bare 1fr', () => {
    // `1fr` is `minmax(auto, 1fr)`, and the `auto` minimum re-introduces the
    // blowout. Every track here uses minmax(0, 1fr).
    const css = readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8');
    for (const m of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
      if (/repeat\([^)]*\)/.test(m[1]) && /1fr/.test(m[1])) {
        expect(m[1], 'grid track uses a bare 1fr').toMatch(/minmax\(\s*(0|min\()/);
      }
    }
  });
});
