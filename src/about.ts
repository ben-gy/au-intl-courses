// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// What this is, where the data comes from, what it cannot tell you, and every
// term defined in one place.

import { closeButton, openOverlay } from './overlay';
import { esc, monthLabel, num, perWeek } from './format';
import { glossaryTerms } from './glossary';
import type { Meta } from './types';

export function openAbout(meta: Meta): void {
  openOverlay({
    panelClass: 'modal',
    label: 'About this site',
    lockScroll: true,
    build(panel, close) {
      const head = document.createElement('div');
      head.className = 'overlay-head';
      head.innerHTML = `<h2>About this site<span class="sub">CRICOS as at ${esc(meta.asAt)}</span></h2>`;
      head.append(closeButton(close, 'Close'));

      const body = document.createElement('div');
      body.className = 'overlay-body';
      const h = meta.headline;
      body.innerHTML = `
        <div>
          <h3>What this is</h3>
          <p>Every course an international student can legally enrol in inside Australia, and what each one costs —
            read out of the Commonwealth Register of Institutions and Courses for Overseas Students, the register the
            law requires providers to appear on.</p>
          <p>The official register lets you look up one course at a time and shows no price on the results. This site
            loads the whole thing: ${num(meta.counts.courseCount)} courses from ${num(meta.counts.providerCount)}
            providers across ${num(meta.counts.campusCount)} campuses, with every fee divided by its own registered
            course length so two providers can actually be compared.</p>
        </div>

        <div>
          <h3>The one thing worth knowing before you read anything else</h3>
          <p>${num(meta.counts.natCodedCourses)} of the ${num(meta.counts.courseCount)} courses on the register carry a
            <strong>VET national code</strong>. That means the qualification is nationally defined: the same units, the
            same training package, the same certificate at the end, no matter which provider you pay. Those courses are
            ${num(meta.counts.natCodeCount)} distinct qualifications, and ${num(meta.counts.comparable2)} of them are
            sold by more than one provider — which makes their prices a genuine like-for-like comparison, the only place
            on this register where one exists.</p>
          ${h ? `<p>The clearest example is <strong>${esc(h.nat)} ${esc(h.title)}</strong>. ${num(h.providers)} registered
            providers sell it. Per teaching week it runs ${perWeek(h.p10)} at the 10th percentile and ${perWeek(h.p90)}
            at the 90th — <strong>${h.ratio}×</strong> — for a legally identical qualification.</p>` : ''}
          <p>It has to be per week, because the same code is registered over anything from ${h?.minWeeks ?? 31} to
            ${h?.maxWeeks ?? 130} weeks. Rank on the total fee instead and you are largely ranking course LENGTH: the
            cheapest totals are often just the shortest courses. That is why per week is the default here and the
            sticker price is a labelled toggle.</p>
        </div>

        <div>
          <h3>What this data cannot tell you</h3>
          <ul>
            <li><strong>Nothing about quality.</strong> CRICOS records no completions, no student satisfaction, no
              outcomes and no ratings. A cheaper provider here is not a worse one and a dearer one is not better.</li>
            <li><strong>Nothing about size.</strong> There are no enrolment numbers anywhere in the register. Course
              count is catalogue breadth. Registered capacity is a legal ceiling set by the regulator, not a headcount.</li>
            <li><strong>Nothing about why a provider left.</strong> The monthly extracts show a provider gone from one
              month to the next; they never say whether that was a closure, a merger, a rename or a withdrawal.</li>
            <li><strong>These are registered fees, not quotes.</strong> They are what each provider filed with the
              Commonwealth, before scholarships and before anything an agent tells you.</li>
          </ul>
        </div>

        <div>
          <h3>How it is put together</h3>
          <p>A scheduled job downloads the bulk export from data.gov.au once a month, parses the four CSVs it contains,
            and rebuilds everything you see. It also keeps a small digest of each of the
            ${num(meta.snapshotMonths)} monthly extracts published since ${meta.firstMonth ? monthLabel(meta.firstMonth) : '2021'},
            which is what makes the arrivals-and-departures view possible — only the current snapshot is normally published.</p>
          <p>Nothing ships unless it passes the build's correctness checks. Among them: the fee identity
            (estimated total = tuition + non-tuition) must hold on every priced course — it currently holds on all
            ${num(meta.counts.pricedCount)}; every location row must carry a numeric postcode, which is the tripwire
            for a parsing bug that would otherwise shift columns silently; and no join may leave an orphan.</p>
          <p>Map boundaries are real Australian Bureau of Statistics 2021 Postal Areas, simplified. CRICOS holds no
            coordinates, so each campus is placed at its postcode's centre — in a city centre, dozens of colleges share
            one dot. ${num(meta.boundaries.matched)} of ${num(meta.boundaries.wanted)} campus postcodes have an ABS
            polygon; the rest are PO-box or single-institution postcodes the ABS does not draw.</p>
        </div>

        <div>
          <h3>Data quality, stated plainly</h3>
          <ul>
            <li><strong>${num(meta.counts.suspectCount)} courses</strong> have a registered fee below $60 per teaching
              week, against a register-wide 1st percentile of about $${meta.priceQuantiles.p1}. Almost certainly a
              deposit typed into the whole-of-course field. They are shown exactly as published, drawn hollow, and
              barred from every "cheapest" claim on the site. They are never deleted.</li>
            <li><strong>${num(meta.counts.expiredCount)} courses</strong> have an expired registration. They stay on the
              published register, so they are here, labelled, and filtered out by default.</li>
            <li><strong>${meta.counts.duplicateCampusRows} campus rows</strong> are exact duplicates under one provider
              and are counted once.</li>
            <li><strong>${meta.gaps.length ? meta.gaps.map(monthLabel).join(', ') : 'No month'}</strong> is missing from
              the published monthly extracts. It is drawn as a gap, never as zero.</li>
          </ul>
        </div>

        <div>
          <h3>Source and licence</h3>
          <p>${esc(meta.source.name)}, published by the ${esc(meta.source.publisher)} on
            <a href="${esc(meta.source.landing)}" target="_blank" rel="noopener">data.gov.au</a> under the
            <a href="${esc(meta.source.licenceUrl)}" target="_blank" rel="noopener">${esc(meta.source.licence)}</a> licence.
            Snapshot dated ${esc(meta.asAt)}. Boundaries from the Australian Bureau of Statistics (CC BY 4.0).</p>
          <p>Always confirm anything that matters against the official register at
            <a href="${esc(meta.source.register)}" target="_blank" rel="noopener">cricos.education.gov.au</a>. This is an
            independent project and is not affiliated with the Department of Education or with any provider listed.</p>
        </div>

        <div>
          <h3>Every term, defined</h3>
          <dl class="dl glossary-dl">
            ${glossaryTerms().map((t) => `<dt>${esc(t.term)}</dt><dd>${esc(t.def)}</dd>`).join('')}
          </dl>
        </div>`;

      panel.append(head, body);
    },
  });
}
