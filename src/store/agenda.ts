import type { Task } from '../types';
import { addDaysISO, compareTasks, diffDaysISO, isSomedayTask, todayISO } from './selectors';

/**
 * Why an entry appears on a given agenda day. Org shows the same task under
 * different prefixes depending on which of its stamps put it there, and the
 * distinction is the whole point of the view: a `deadline` line is a warning
 * ahead of time, a `scheduled` line is a plan for that day.
 */
export type AgendaReason = 'scheduled' | 'deadline' | 'past-scheduled' | 'past-deadline' | 'timed';

export interface AgendaEntry {
	task: Task;
	reason: AgendaReason;
	/**
	 * Days between this agenda day and the stamp that produced the entry.
	 * Negative when the stamp is in the past — org renders that as
	 * "Sched. 3x" / "3 d. ago".
	 */
	daysFrom: number;
}

export interface AgendaDay {
	date: string;
	/** Entries with a time-of-day, in clock order. */
	timed: AgendaEntry[];
	/** Everything else, deadlines first, then by priority. */
	untimed: AgendaEntry[];
}

export interface AgendaOptions {
	/** First day shown; defaults to today. */
	start?: string;
	/** Days to show (org's `org-agenda-span`). */
	span: number;
	/** Days ahead a DEADLINE begins appearing (`org-deadline-warning-days`). */
	deadlineWarningDays: number;
	/** Repeat a past SCHEDULED task on every day until it's done. */
	showScheduledPast: boolean;
}

function reasonRank(reason: AgendaReason): number {
	if (reason === 'past-deadline') return 0;
	if (reason === 'deadline') return 1;
	if (reason === 'past-scheduled') return 2;
	return 3;
}

function compareEntries(a: AgendaEntry, b: AgendaEntry): number {
	return reasonRank(a.reason) - reasonRank(b.reason) || compareTasks(a.task, b.task);
}

/**
 * Builds the agenda: for each day in the span, every open task whose SCHEDULED
 * or DEADLINE stamp lands it there.
 *
 * The rules follow org's:
 *  - a SCHEDULED task shows on its day, and (when `showScheduledPast`) on every
 *    day after until it's done — org's "sticky" scheduled behaviour, which is
 *    what stops an overdue task from quietly vanishing off the agenda;
 *  - a DEADLINE shows from `deadlineWarningDays` before it, every day up to it,
 *    and every day after while it's still open;
 *  - a task with both stamps can appear twice on one day, once per reason,
 *    exactly as org lists it.
 *
 * Someday tasks stay out entirely: they're explicitly not on the calendar.
 */
export function buildAgenda(tasks: Record<string, Task>, options: AgendaOptions): AgendaDay[] {
	const start = options.start ?? todayISO();
	const open = Object.values(tasks).filter((t) => t.status === 'todo' && !isSomedayTask(t));
	const days: AgendaDay[] = [];

	for (let i = 0; i < options.span; i++) {
		const date = addDaysISO(start, i);
		const timed: AgendaEntry[] = [];
		const untimed: AgendaEntry[] = [];

		for (const task of open) {
			if (task.scheduled !== undefined) {
				const delta = diffDaysISO(task.scheduled, date);
				const onDay = delta === 0;
				const carried = options.showScheduledPast && delta > 0;
				if (onDay || carried) {
					const entry: AgendaEntry = {
						task,
						reason: onDay ? (task.scheduledTime !== undefined ? 'timed' : 'scheduled') : 'past-scheduled',
						daysFrom: -delta,
					};
					if (task.scheduledTime !== undefined) timed.push(entry);
					else untimed.push(entry);
				}
			}
			if (task.due !== undefined) {
				const delta = diffDaysISO(date, task.due);
				// `delta` counts days until the deadline: 0 is the day itself,
				// positive is upcoming, negative is overdue.
				if (delta <= options.deadlineWarningDays) {
					untimed.push({
						task,
						reason: delta < 0 ? 'past-deadline' : 'deadline',
						daysFrom: delta,
					});
				}
			}
		}

		days.push({
			date,
			timed: timed.sort(
				(a, b) => (a.task.scheduledTime ?? '').localeCompare(b.task.scheduledTime ?? '') || compareEntries(a, b),
			),
			untimed: untimed.sort(compareEntries),
		});
	}
	return days;
}

/** The prefix org prints on an agenda line, e.g. `Sched. 3x:` or `In 4 d.:`. */
export function agendaPrefix(entry: AgendaEntry): string | null {
	switch (entry.reason) {
		case 'past-scheduled':
			// Org counts the occurrence, not the days: the 3rd day it's been shown.
			return `Sched. ${Math.abs(entry.daysFrom) + 1}x`;
		case 'past-deadline': {
			const days = Math.abs(entry.daysFrom);
			return `${days} d. ago`;
		}
		case 'deadline':
			if (entry.daysFrom === 0) return 'Deadline';
			return `In ${entry.daysFrom} d.`;
		default:
			return null;
	}
}

/** Day header: "Monday 27 July 2026", with "Today" called out. */
export function agendaDayLabel(date: string, today: string): string {
	const [y, m, d] = date.split('-').map(Number);
	const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	const label = dt.toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
	});
	if (date === today) return `${label} — Today`;
	if (date === addDaysISO(today, 1)) return `${label} — Tomorrow`;
	return label;
}

/**
 * Org's global TODO list (`org-agenda` `t`): every open task, ignoring dates
 * entirely, optionally narrowed to a keyword. This is the counterpart to the
 * date-driven agenda — the "what could I do" list rather than "what's today".
 */
export function selectByKeyword(tasks: Record<string, Task>, keyword?: string): Task[] {
	return Object.values(tasks)
		.filter((t) => t.status === 'todo' && !isSomedayTask(t) && (keyword === undefined || t.keyword === keyword))
		.sort(compareTasks);
}
