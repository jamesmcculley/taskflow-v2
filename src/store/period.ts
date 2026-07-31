/**
 * Week / month / quarter arithmetic for the review.
 *
 * A period is addressed by a sortable string key — `2026-W31`, `2026-07`,
 * `2026-Q3` — because keys are what get persisted, and a key has to survive
 * being written to data.json and read back in another timezone. Everything here
 * is UTC date math on ISO strings for that reason: local-time arithmetic
 * silently shifts a day across a DST boundary, which would move a Sunday
 * completion into the wrong week.
 *
 * Weeks are ISO 8601 (Monday start; week 1 is the one containing 4 January),
 * which is what every calendar the user might cross-check against uses.
 */

export type PeriodKind = 'week' | 'month' | 'quarter';

export interface PeriodRange {
	/** Inclusive ISO date. */
	start: string;
	/** Inclusive ISO date. */
	end: string;
}

const DAY_MS = 86_400_000;
const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

function toUTC(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function isoOf(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
	const out = new Date(date);
	out.setUTCDate(out.getUTCDate() + days);
	return out;
}

/** Monday of ISO week 1 for a given ISO week-numbering year. */
function week1Monday(year: number): Date {
	const jan4 = new Date(Date.UTC(year, 0, 4));
	// getUTCDay is Sun=0; shift so Monday=0.
	return addDays(jan4, -((jan4.getUTCDay() + 6) % 7));
}

function isoWeekOf(iso: string): { year: number; week: number } {
	// The Thursday of a week decides which year the week belongs to — that's
	// the whole trick to ISO weeks, and why 1 Jan can land in the prior year.
	const thursday = addDays(toUTC(iso), 3 - ((toUTC(iso).getUTCDay() + 6) % 7));
	const year = thursday.getUTCFullYear();
	const week = Math.round((thursday.getTime() - week1Monday(year).getTime()) / (7 * DAY_MS)) + 1;
	return { year, week };
}

/** The key naming the period of `kind` that contains `iso`. */
export function periodKeyFor(kind: PeriodKind, iso: string): string {
	const d = toUTC(iso);
	if (kind === 'week') {
		const { year, week } = isoWeekOf(iso);
		return `${year}-W${String(week).padStart(2, '0')}`;
	}
	if (kind === 'month') {
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	}
	return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function periodKindOf(key: string): PeriodKind | null {
	if (/^\d{4}-W\d{2}$/.test(key)) return 'week';
	if (/^\d{4}-\d{2}$/.test(key)) return 'month';
	if (/^\d{4}-Q[1-4]$/.test(key)) return 'quarter';
	return null;
}

/** Inclusive start/end dates of a period key. Null if the key is malformed. */
export function periodRange(key: string): PeriodRange | null {
	const kind = periodKindOf(key);
	if (kind === null) return null;
	const year = Number(key.slice(0, 4));
	if (kind === 'week') {
		const start = addDays(week1Monday(year), (Number(key.slice(6)) - 1) * 7);
		return { start: isoOf(start), end: isoOf(addDays(start, 6)) };
	}
	const firstMonth = kind === 'month' ? Number(key.slice(5)) - 1 : (Number(key.slice(6)) - 1) * 3;
	const months = kind === 'month' ? 1 : 3;
	const start = new Date(Date.UTC(year, firstMonth, 1));
	// Day 0 of the following month is the last day of this one.
	const end = new Date(Date.UTC(year, firstMonth + months, 0));
	return { start: isoOf(start), end: isoOf(end) };
}

/** The same kind of period, `delta` steps away. */
export function shiftPeriodKey(key: string, delta: number): string {
	const kind = periodKindOf(key);
	const range = periodRange(key);
	if (kind === null || range === null) return key;
	if (kind === 'week') return periodKeyFor('week', isoOf(addDays(toUTC(range.start), delta * 7)));
	const start = toUTC(range.start);
	const step = kind === 'month' ? 1 : 3;
	return periodKeyFor(
		kind,
		isoOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta * step, 1))),
	);
}

function shortDate(iso: string): string {
	const d = toUTC(iso);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]?.slice(0, 3) ?? ''}`;
}

/** Human label, e.g. "Week 31" / "July 2026" / "Q3 2026". */
export function periodLabel(key: string): string {
	const kind = periodKindOf(key);
	if (kind === null) return key;
	const year = key.slice(0, 4);
	if (kind === 'week') return `Week ${Number(key.slice(6))}`;
	if (kind === 'quarter') return `${key.slice(5)} ${year}`;
	const month = MONTHS[Number(key.slice(5)) - 1] ?? '';
	return `${month} ${year}`;
}

/** "27 Jul – 2 Aug 2026" — the dates a label alone doesn't tell you. */
export function periodDateRangeLabel(key: string): string {
	const range = periodRange(key);
	if (!range) return '';
	return `${shortDate(range.start)} – ${shortDate(range.end)} ${toUTC(range.end).getUTCFullYear()}`;
}

export function isWithin(iso: string, range: PeriodRange): boolean {
	return iso >= range.start && iso <= range.end;
}

function overlaps(a: PeriodRange, b: PeriodRange): boolean {
	return a.start <= b.end && b.start <= a.end;
}

const NARROWER: Record<PeriodKind, PeriodKind[]> = {
	quarter: ['month', 'week'],
	month: ['week'],
	week: [],
};

/**
 * Keys of shorter periods overlapping this one, newest first — what a quarter
 * pulls up from its months and weeks.
 *
 * Overlap rather than strict containment on purpose: an ISO week straddles a
 * month boundary four times a year, and a week's worth of work doesn't stop
 * counting because the month ticked over mid-week.
 */
export function narrowerKeysWithin(key: string, candidates: readonly string[]): string[] {
	const kind = periodKindOf(key);
	const range = periodRange(key);
	if (kind === null || range === null) return [];
	const wanted = new Set(NARROWER[kind]);
	return candidates
		.filter((c) => {
			if (c === key) return false;
			const ck = periodKindOf(c);
			const cr = periodRange(c);
			return ck !== null && cr !== null && wanted.has(ck) && overlaps(cr, range);
		})
		.sort((a, b) => b.localeCompare(a));
}
