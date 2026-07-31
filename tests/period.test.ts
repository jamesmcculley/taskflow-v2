import { describe, expect, it } from 'vitest';
import {
	narrowerKeysWithin,
	periodDateRangeLabel,
	periodKeyFor,
	periodKindOf,
	periodLabel,
	periodRange,
	shiftPeriodKey,
} from '../src/store/period';

describe('period keys', () => {
	it('names the week, month and quarter containing a date', () => {
		expect(periodKeyFor('week', '2026-07-31')).toBe('2026-W31');
		expect(periodKeyFor('month', '2026-07-31')).toBe('2026-07');
		expect(periodKeyFor('quarter', '2026-07-31')).toBe('2026-Q3');
	});

	it('follows ISO week-year rules across the new year', () => {
		// 2027-01-01 is a Friday, so it belongs to the week that started
		// 2026-12-28 — ISO week 53 of 2026, not week 1 of 2027.
		expect(periodKeyFor('week', '2027-01-01')).toBe('2026-W53');
		expect(periodKeyFor('week', '2027-01-04')).toBe('2027-W01');
		// ...while the month and quarter keys follow the calendar date.
		expect(periodKeyFor('month', '2027-01-01')).toBe('2027-01');
		expect(periodKeyFor('quarter', '2027-01-01')).toBe('2027-Q1');
	});

	it('classifies keys', () => {
		expect(periodKindOf('2026-W31')).toBe('week');
		expect(periodKindOf('2026-07')).toBe('month');
		expect(periodKindOf('2026-Q3')).toBe('quarter');
		expect(periodKindOf('nonsense')).toBeNull();
	});
});

describe('period ranges', () => {
	it('spans Monday to Sunday for a week', () => {
		expect(periodRange('2026-W31')).toEqual({ start: '2026-07-27', end: '2026-08-02' });
	});

	it('spans whole months and quarters', () => {
		expect(periodRange('2026-07')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
		expect(periodRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
		expect(periodRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
		expect(periodRange('2026-Q3')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
		expect(periodRange('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
	});

	it('round-trips every key back to itself', () => {
		for (const key of ['2026-W01', '2026-W31', '2026-W53', '2026-01', '2026-12', '2026-Q1', '2026-Q4']) {
			const range = periodRange(key);
			expect(range).not.toBeNull();
			const kind = periodKindOf(key);
			expect(kind).not.toBeNull();
			if (range && kind) expect(periodKeyFor(kind, range.start)).toBe(key);
		}
	});
});

describe('shifting periods', () => {
	it('steps back and forward', () => {
		expect(shiftPeriodKey('2026-W31', -1)).toBe('2026-W30');
		expect(shiftPeriodKey('2026-W31', 1)).toBe('2026-W32');
		expect(shiftPeriodKey('2026-07', 1)).toBe('2026-08');
		expect(shiftPeriodKey('2026-Q3', 1)).toBe('2026-Q4');
	});

	it('crosses year boundaries', () => {
		expect(shiftPeriodKey('2026-12', 1)).toBe('2027-01');
		expect(shiftPeriodKey('2026-Q4', 1)).toBe('2027-Q1');
		expect(shiftPeriodKey('2027-W01', -1)).toBe('2026-W53');
	});
});

describe('labels', () => {
	it('reads naturally', () => {
		expect(periodLabel('2026-W31')).toBe('Week 31');
		expect(periodLabel('2026-07')).toBe('July 2026');
		expect(periodLabel('2026-Q3')).toBe('Q3 2026');
		expect(periodDateRangeLabel('2026-W31')).toBe('27 Jul – 2 Aug 2026');
		expect(periodDateRangeLabel('2026-Q3')).toBe('1 Jul – 30 Sep 2026');
	});
});

describe('roll-up', () => {
	const candidates = [
		'2026-W30', '2026-W31', '2026-W32', '2026-W40',
		'2026-07', '2026-08', '2026-11',
		'2026-Q3',
	];

	it('pulls months and weeks up into a quarter, newest first', () => {
		expect(narrowerKeysWithin('2026-Q3', candidates)).toEqual([
			'2026-W40', '2026-W32', '2026-W31', '2026-W30', '2026-08', '2026-07',
		]);
	});

	it('pulls only weeks up into a month', () => {
		// W30 (20–26 Jul) sits inside July and W31 (27 Jul – 2 Aug) straddles the
		// boundary, so both count. W32 (3–9 Aug) is wholly in August and doesn't.
		expect(narrowerKeysWithin('2026-07', candidates)).toEqual(['2026-W31', '2026-W30']);
	});

	it('a week pulls up nothing, and nothing pulls up itself', () => {
		expect(narrowerKeysWithin('2026-W31', candidates)).toEqual([]);
		expect(narrowerKeysWithin('2026-Q3', candidates)).not.toContain('2026-Q3');
	});

	it('includes a week straddling the period boundary', () => {
		// W40 is 28 Sep – 4 Oct: it starts inside Q3 and ends in Q4, and counts
		// for both rather than being dropped by strict containment.
		expect(narrowerKeysWithin('2026-Q3', ['2026-W40'])).toEqual(['2026-W40']);
		expect(narrowerKeysWithin('2026-Q4', ['2026-W40'])).toEqual(['2026-W40']);
	});
});
