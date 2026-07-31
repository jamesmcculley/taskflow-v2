import { describe, expect, it } from 'vitest';
import {
	advanceDate,
	advanceRecurrence,
	normalizeRecurrenceText,
	parseRecurrence,
	parseRepeater,
	repeaterFromText,
} from '../src/recurrence/recurrence';

// Sat 2026-07-18.
const TODAY = '2026-07-18';

describe('parseRepeater', () => {
	it('parses all three org repeater kinds', () => {
		expect(parseRepeater('+1w')).toEqual({ kind: '+', value: 1, unit: 'w' });
		expect(parseRepeater('++2d')).toEqual({ kind: '++', value: 2, unit: 'd' });
		expect(parseRepeater('.+3m')).toEqual({ kind: '.+', value: 3, unit: 'm' });
	});

	it('rejects anything that isn’t one', () => {
		expect(parseRepeater('every week')).toBeNull();
		expect(parseRepeater('+1x')).toBeNull();
		expect(parseRepeater('1w')).toBeNull();
	});
});

describe('advanceDate — the three repeater kinds', () => {
	it('+ shifts once from the stamp, even if that stays in the past', () => {
		// Org's plain `+`: a long-overdue weekly task steps forward exactly one
		// week per completion rather than jumping to the future.
		expect(advanceDate('2026-06-01', { kind: '+', value: 1, unit: 'w' }, TODAY)).toBe('2026-06-08');
	});

	it('++ catches up past today, staying on the original weekday', () => {
		// Mon 2026-06-01 weekly -> the first Monday strictly after Sat 07-18.
		expect(advanceDate('2026-06-01', { kind: '++', value: 1, unit: 'w' }, TODAY)).toBe('2026-07-20');
	});

	it('.+ counts from today, ignoring the old stamp entirely', () => {
		expect(advanceDate('2026-06-01', { kind: '.+', value: 1, unit: 'w' }, TODAY)).toBe('2026-07-25');
	});

	it('crosses month and year boundaries', () => {
		expect(advanceDate('2026-07-31', { kind: '+', value: 1, unit: 'd' }, '2026-07-31')).toBe('2026-08-01');
		expect(advanceDate('2026-12-25', { kind: '+', value: 1, unit: 'w' }, '2026-12-25')).toBe('2027-01-01');
	});

	it('clamps monthly arithmetic to the end of a short month', () => {
		// Jan 31 + 1 month has no Feb 31; org lands on the last day of February.
		expect(advanceDate('2026-01-31', { kind: '+', value: 1, unit: 'm' }, '2026-01-31')).toBe('2026-02-28');
	});
});

describe('advanceRecurrence', () => {
	it('advances SCHEDULED by the repeater', () => {
		expect(advanceRecurrence({ scheduled: '2026-07-18', repeater: '++1d' }, TODAY)).toEqual({
			scheduled: '2026-07-19',
		});
		expect(advanceRecurrence({ scheduled: '2026-07-18', repeater: '++1w' }, TODAY)).toEqual({
			scheduled: '2026-07-25',
		});
	});

	it('overdue ++ repeats skip forward but stay pattern-aligned', () => {
		// Anchored Fri 2026-07-10, weekly: 07-17 is ≤ today, so next is 07-24.
		expect(advanceRecurrence({ scheduled: '2026-07-10', repeater: '++1w' }, TODAY)).toEqual({
			scheduled: '2026-07-24',
		});
	});

	it('completing early still advances past a future anchor', () => {
		expect(advanceRecurrence({ scheduled: '2026-07-20', repeater: '++1w' }, TODAY)).toEqual({
			scheduled: '2026-07-27',
		});
	});

	it('anchors on DEADLINE when there is no SCHEDULED date', () => {
		expect(advanceRecurrence({ due: '2026-07-18', repeater: '++1w' }, TODAY)).toEqual({
			due: '2026-07-25',
		});
	});

	it('keeps the deadline offset when both stamps are present', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-18', due: '2026-07-21', repeater: '++1w' }, TODAY),
		).toEqual({ scheduled: '2026-07-25', due: '2026-07-28' });
	});

	it('anchors on today when the task has no dates', () => {
		expect(advanceRecurrence({ repeater: '++1d' }, TODAY)).toEqual({ scheduled: '2026-07-19' });
	});

	it('.+ repeats anchor on the completion date, not the schedule', () => {
		// A ++ weekly from 07-10 gives 07-24; .+ gives today + one week.
		expect(advanceRecurrence({ scheduled: '2026-07-10', repeater: '.+1w' }, TODAY)).toEqual({
			scheduled: '2026-07-25',
		});
	});

	it('.+ keeps the deadline offset too', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-15', due: '2026-07-17', repeater: '.+1w' }, TODAY),
		).toEqual({ scheduled: '2026-07-25', due: '2026-07-27' });
	});

	it('returns null when there is no repeater and no rule', () => {
		expect(advanceRecurrence({ scheduled: TODAY }, TODAY)).toBeNull();
		expect(advanceRecurrence({ scheduled: TODAY, repeater: 'nonsense' }, TODAY)).toBeNull();
	});
});

describe('advanceRecurrence — the :REPEAT: rrule fallback', () => {
	it('every weekday skips the weekend', () => {
		// Today is Saturday; the next weekday is Monday.
		expect(
			advanceRecurrence({ scheduled: '2026-07-17', ruleText: 'every weekday' }, TODAY),
		).toEqual({ scheduled: '2026-07-20' });
	});

	it('every 3rd friday is monthly, including across the month boundary', () => {
		// 3rd Friday of July 2026 is 07-17; next is 3rd Friday of August, 08-21.
		expect(
			advanceRecurrence({ scheduled: '2026-07-17', ruleText: 'every 3rd friday' }, TODAY),
		).toEqual({ scheduled: '2026-08-21' });
	});

	it('after-completion phrasing anchors on today', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-01', ruleText: 'every 2 weeks after completion' }, TODAY),
		).toEqual({ scheduled: '2026-08-01' });
	});

	it('returns null for unparseable rule text', () => {
		expect(advanceRecurrence({ scheduled: TODAY, ruleText: 'sometimes' }, TODAY)).toBeNull();
	});

	it('a repeater wins over a rule when both are present', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-18', repeater: '++1d', ruleText: 'every week' }, TODAY),
		).toEqual({ scheduled: '2026-07-19' });
	});
});

describe('repeaterFromText — the migration mapping', () => {
	it('maps plain intervals onto ++ repeaters', () => {
		expect(repeaterFromText('every day')).toEqual({ kind: '++', value: 1, unit: 'd' });
		expect(repeaterFromText('every week')).toEqual({ kind: '++', value: 1, unit: 'w' });
		expect(repeaterFromText('every 3 days')).toEqual({ kind: '++', value: 3, unit: 'd' });
		expect(repeaterFromText('every 2 months')).toEqual({ kind: '++', value: 2, unit: 'm' });
		expect(repeaterFromText('every other week')).toEqual({ kind: '++', value: 2, unit: 'w' });
	});

	it('maps "after done" onto .+ repeaters', () => {
		expect(repeaterFromText('every week after done')).toEqual({ kind: '.+', value: 1, unit: 'w' });
		expect(repeaterFromText('every 2 weeks after completion')).toEqual({
			kind: '.+',
			value: 2,
			unit: 'w',
		});
	});

	it('returns null for patterns no repeater expresses — those keep :REPEAT:', () => {
		expect(repeaterFromText('every weekday')).toBeNull();
		expect(repeaterFromText('every 3rd friday')).toBeNull();
		expect(repeaterFromText('every monday')).toBeNull();
	});
});

describe('rrule helpers still used by the fallback', () => {
	it('rewrites ordinal-weekday shorthand to monthly', () => {
		expect(normalizeRecurrenceText('every 3rd friday')).toBe('every month on the 3rd friday');
		expect(normalizeRecurrenceText('every last monday')).toBe('every month on the last monday');
		expect(normalizeRecurrenceText('every week')).toBe('every week');
	});

	it('parses the phrases the migrator hands off', () => {
		for (const text of ['every day', 'every week', 'every weekday', 'every 3rd friday']) {
			expect(parseRecurrence(text), text).not.toBeNull();
		}
		expect(parseRecurrence('whenever I feel like it')).toBeNull();
	});
});

describe('sub-day repeaters', () => {
	// Every date in the index is day-granular, so an hour repeater has nothing
	// to move. It used to shift by zero days, which rescheduled a completed task
	// to the same day forever; now it reports as unhonourable and completes once.
	it('does not advance an hour repeater', () => {
		const today = '2026-07-31';
		expect(advanceDate(today, { kind: '++', value: 1, unit: 'h' }, today)).toBeNull();
		expect(advanceDate(today, { kind: '+', value: 2, unit: 'h' }, today)).toBeNull();
		expect(advanceDate(today, { kind: '.+', value: 3, unit: 'h' }, today)).toBeNull();
		expect(advanceRecurrence({ scheduled: today, repeater: '++1h' }, today)).toBeNull();
	});

	it('still advances day and larger units', () => {
		const today = '2026-07-31';
		expect(advanceDate(today, { kind: '++', value: 1, unit: 'd' }, today)).toBe('2026-08-01');
		expect(advanceRecurrence({ scheduled: today, repeater: '++1w' }, today)).toEqual({
			scheduled: '2026-08-07',
		});
	});
});
