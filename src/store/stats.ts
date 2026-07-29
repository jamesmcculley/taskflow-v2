import { addDaysISO, endOfWeekISO, todayISO } from './selectors';
import type { CompletionEntry } from '../types';

export interface DayCount {
	date: string;
	count: number;
}

export interface StatsData {
	today: number;
	week: number;
	month: number;
	total: number;
	currentStreak: number;
	longestStreak: number;
	/** One entry per day, oldest first, starting on a Monday and ending today. */
	days: DayCount[];
}

/** Completion stats from the log ('done' entries only), local-day based. */
export function computeStats(log: CompletionEntry[], today: string, weeks = 26): StatsData {
	const counts = new Map<string, number>();
	let total = 0;
	for (const e of log) {
		if (e.status !== 'done') continue;
		const day = todayISO(new Date(e.completedAt));
		counts.set(day, (counts.get(day) ?? 0) + 1);
		total++;
	}

	const weekStart = addDaysISO(endOfWeekISO(today), -6);
	const monthStart = `${today.slice(0, 8)}01`;
	const sumFrom = (from: string) => {
		let sum = 0;
		for (const [day, count] of counts) if (day >= from && day <= today) sum += count;
		return sum;
	};

	// Current streak: consecutive days with a completion; an empty today doesn't
	// break it (the day isn't over yet).
	let currentStreak = 0;
	let cursor = (counts.get(today) ?? 0) > 0 ? today : addDaysISO(today, -1);
	while ((counts.get(cursor) ?? 0) > 0) {
		currentStreak++;
		cursor = addDaysISO(cursor, -1);
	}

	let longestStreak = 0;
	const dates = [...counts.keys()].sort();
	let run = 0;
	let prev: string | null = null;
	for (const d of dates) {
		run = prev !== null && addDaysISO(prev, 1) === d ? run + 1 : 1;
		longestStreak = Math.max(longestStreak, run);
		prev = d;
	}

	const gridStart = addDaysISO(weekStart, -7 * (weeks - 1));
	const days: DayCount[] = [];
	for (let d = gridStart; d <= today; d = addDaysISO(d, 1)) {
		days.push({ date: d, count: counts.get(d) ?? 0 });
	}

	return {
		today: counts.get(today) ?? 0,
		week: sumFrom(weekStart),
		month: sumFrom(monthStart),
		total,
		currentStreak,
		longestStreak,
		days,
	};
}
