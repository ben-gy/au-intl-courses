// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every term a reader who knows nothing about Australian qualifications will
// hit. Written for someone reading in a second language with an offer letter in
// front of them, not for a policy analyst.

export interface Term { term: string; def: string }

export const GLOSSARY: Record<string, string> = {
  CRICOS: 'The Commonwealth Register of Institutions and Courses for Overseas Students. By law, an Australian provider may only teach international students courses that appear on this register. If a course is not on CRICOS, you cannot study it here on a student visa.',
  'CRICOS provider code': 'The registration number of the institution, like 00001K. It never changes, even when the college renames or rebrands itself — which is why it is the safest thing to check an offer letter against.',
  'CRICOS course code': 'The registration number of one specific course at one specific provider, like 078241E. Two providers teaching the identical qualification have different CRICOS course codes.',
  'ESOS Act': 'The Education Services for Overseas Students Act 2000 — the law that requires the register to exist, sets the rules providers must follow, and protects your fees if a provider closes.',
  'student visa': 'The subclass 500 visa. Granting it generally requires a Confirmation of Enrolment in a CRICOS-registered course.',
  'Confirmation of Enrolment': 'The CoE — the document a provider issues once you have accepted an offer and paid. It quotes the CRICOS course code, and it is what your visa application is built on.',
  'registered provider': 'An institution approved to teach international students. This register lists 1,552 of them. Registration says the provider met the regulator\'s requirements; it is not a rating and says nothing about quality.',
  'Institution Type': 'The register classifies every provider as Private or Government. Government providers are universities, TAFEs and school systems; 1,486 of the 1,552 providers on the register are private.',
  'Institution Capacity': 'The maximum number of overseas students a provider is REGISTERED to have enrolled at one time. It is a legal ceiling set by the regulator — not a count of how many students are actually there. CRICOS publishes no enrolment numbers at all.',
  'trading name': 'The name a provider operates under day to day. It is often different from its legal institution name, which is what appears on your testamur.',
  campus: 'The register calls these Locations. Each is an address at which a provider is approved to teach. One provider on this register holds 208 of them.',
  'location type': 'How the teaching site is run: owned and operated by the provider, delivered under arrangement with another registered provider, or delivered under arrangement with a provider that is NOT on CRICOS. All three are lawful and disclosed on the register.',
  'third-party delivery': 'When your classes are actually run by a different organisation from the one on your offer letter, under a written arrangement. It is lawful and it is disclosed on the register — but it is worth knowing before you sign.',
  AQF: 'The Australian Qualifications Framework — the national ladder of qualification levels, from Certificate I at the bottom to a Doctoral Degree at the top. It is what makes a Diploma from one provider the same LEVEL as a Diploma from another.',
  'VET national code': 'A code like BSB50420 that identifies a nationally defined vocational qualification. Every provider awarding it teaches the same units of competency from the same training package and issues the same qualification. This is what makes a price comparison meaningful: the certificate is identical, only the price and the length differ.',
  'training package': 'The nationally agreed set of skills and assessments behind a VET national code, written with industry. BSB is Business Services, SIT is Tourism and Hospitality, CHC is Community Services, ICT is Information Technology, CPC is Construction.',
  'unit of competency': 'One assessable skill inside a training package. A qualification is a defined bundle of them, identical across every provider that awards the code.',
  VET: 'Vocational Education and Training — practical, occupation-focused study, mostly Certificates and Diplomas, delivered by TAFEs and private colleges rather than universities.',
  testamur: 'The actual certificate you are awarded. For a nationally coded VET qualification it names the same qualification no matter which provider issued it.',
  'field of education': 'The ASCED classification of what a course is about, in three tiers: 12 broad fields, then narrower ones inside each. Management and Commerce is the largest on this register.',
  'course level': 'Where the course sits on the AQF ladder — Certificate III, Diploma, Bachelor Degree, Masters, and so on.',
  'duration (weeks)': 'How many weeks the course is conducted over, as registered. The same nationally coded qualification is registered anywhere from 31 to 130 weeks depending on the provider, which is exactly why comparing total fees is misleading.',
  'work component': 'Part of the course is workplace-based training rather than classroom teaching. The register records the hours per week, the number of weeks, and the total.',
  'dual qualification': 'One enrolment that awards two qualifications — common in hospitality and business packaging.',
  'foundation studies': 'A preparatory course taken before a degree, usually to meet entry requirements.',
  'expired course': 'A course whose registration has lapsed. It stays on the published register, so it is shown here, labelled — but you cannot enrol in it.',
  'tuition fee': 'The teaching fee for the WHOLE course, as registered with the Commonwealth — not per year and not per semester.',
  'non-tuition fee': 'Compulsory charges that are not teaching: enrolment, materials, and similar. Added to the tuition fee it gives the estimated total course cost.',
  'estimated total course cost': 'Tuition fee plus non-tuition fee. On the current register this identity holds exactly on all 26,416 priced courses, and this site checks it on every build.',
  'per teaching week': 'Tuition fee divided by the course\'s own registered duration. This site derives it; CRICOS does not publish it. It is the only way to compare two providers teaching the identical qualification over different numbers of weeks.',
  'whole-of-course cost': 'The single fee figure CRICOS shows you. It is not comparable between providers, because the same qualification is registered over wildly different lengths — a cheaper total is often just a shorter course.',
  'suspected misreporting': 'A registered fee that works out below $60 per teaching week, against a register-wide 1st percentile of about $120. These are almost certainly data-entry errors — a deposit or an instalment typed into the whole-of-course field. They are shown exactly as published, drawn differently, and never allowed to win a "cheapest" comparison.',
  percentile: 'Where one value sits in a group. The 90th percentile is the price 90% of offerings come in under.',
  'p10 and p90': 'The 10th and 90th percentiles — the cheap end and the expensive end, ignoring the extreme outliers at either edge. The gap between them is this site\'s measure of how much providers disagree about what the same qualification is worth.',
  'peer group': 'Every other registered offering of the identical qualification. Only qualifications with a VET national code have one; a university degree is not nationally coded, so no other provider offers exactly it.',
  beeswarm: 'A chart where each dot is one real offering, placed at its price along the axis and nudged up or down only so it does not cover its neighbours. The shape shows where the market actually clusters.',
  'iso-rate ray': 'On a plot of total cost against course length, a straight line from the origin along which every course costs the same per week. A course above the line costs more per week than one below it, however different their totals look.',
  hexbin: 'A way of drawing tens of thousands of points without an ink blob: the plane is tiled with hexagons and each is shaded by how many points fall inside it.',
  choropleth: 'A map that shades an area by a value. Here the areas are postcodes, from real Australian Bureau of Statistics boundaries.',
  postcode: 'CRICOS records a campus address but no coordinates, so every point on the map is a postcode CENTROID — the middle of the postcode, not the building. In a CBD, dozens of colleges share one dot.',
  'log scale': 'An axis where each step multiplies rather than adds. It is used here for course cost, which runs from a few hundred dollars to well over a hundred thousand.',
  snapshot: 'One monthly extract of the register. This site holds 60 of them, from July 2021 onward, which is what makes it possible to see providers arriving and leaving.',
  'CC BY 2.5 AU': 'The Creative Commons Attribution 2.5 Australia licence the Department of Education publishes this register under. It permits reuse, including here, as long as the source is credited.',
};

/** Insert a clickable glossary term into an HTML string. */
export function gloss(term: string, label?: string): string {
  const text = label ?? term;
  return `<button type="button" class="glossary-link" data-term="${term.replace(/"/g, '&quot;')}">${text}</button>`;
}

export function glossaryTerms(): Term[] {
  return Object.entries(GLOSSARY)
    .map(([term, def]) => ({ term, def }))
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
}
