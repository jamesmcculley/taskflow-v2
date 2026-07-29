import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/store/stats';
import type { CompletionEntry } from '../src/types';

// Sun 2026-07-19; the week is Mon 07-13 .. Sun 07-19.
const TODAY = '2026-07-19';

function entry(day: string, status: 'done' | 'cancelled' = 'done'): CompletionEntry {
	// Noon local, so the local day equals `day` regardless of timezone.
	const [y, m, d] = day.split('-').map(Number);
	return {
		taskId: `t-${day}`,
		title: 'T',
		status,
		completedAt: new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toISOString(),
	};
}

describe('computeStats', () => {
	it('counts today, week, month, and total', () => {
		const stats = computeStats(
			[
				entry('2026-07-19'),
				entry('2026-07-19'),
				entry('2026-07-13'), // Monday of this week
				entry('2026-07-12'), // last week, same month
				entry('2026-06-30'), // previous month
			],
			TODAY,
		);
		expect(stats.today).toBe(2);
		expect(stats.week).toBe(3);
		expect(stats.month).toBe(4);
		expect(stats.total).toBe(5);
	});

	it('ignores cancelled entries', () => {
		const stats = computeStats([entry('2026-07-19', 'cancelled')], TODAY);
		expect(stats.total).toBe(0);
	});

	it('computes the current streak, tolerating an empty today', () => {
		const withToday = computeStats(
			[entry('2026-07-19'), entry('2026-07-18'), entry('2026-07-17'), entry('2026-07-14')],
			TODAY,
		);
		expect(withToday.currentStreak).toBe(3);

		const withoutToday = computeStats([entry('2026-07-18'), entry('2026-07-17')], TODAY);
		expect(withoutToday.currentStreak).toBe(2);

		const broken = computeStats([entry('2026-07-16')], TODAY);
		expect(broken.currentStreak).toBe(0);
	});

	it('computes the longest streak across gaps and month boundaries', () => {
		const stats = computeStats(
			[
				entry('2026-06-29'),
				entry('2026-06-30'),
				entry('2026-07-01'),
				entry('2026-07-02'),
				entry('2026-07-10'),
			],
			TODAY,
		);
		expect(stats.longestStreak).toBe(4);
	});

	it('builds a Monday-aligned day grid ending today', () => {
		const stats = computeStats([entry('2026-07-19')], TODAY, 2);
		expect(stats.days[0]?.date).toBe('2026-07-06'); // Monday two weeks back
		expect(stats.days[stats.days.length - 1]?.date).toBe(TODAY);
		expect(stats.days).toHaveLength(14);
		expect(stats.days[stats.days.length - 1]?.count).toBe(1);
	});
});
