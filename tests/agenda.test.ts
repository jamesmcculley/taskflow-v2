import { describe, expect, it } from 'vitest';
import { agendaPrefix, buildAgenda, selectByKeyword } from '../src/store/agenda';
import type { AgendaEntry } from '../src/store/agenda';
import type { Task } from '../src/types';

// Sat 2026-07-18.
const TODAY = '2026-07-18';

let n = 0;
function task(over: Partial<Task>): Task {
	n += 1;
	return {
		id: `t-${n}`,
		title: `Task ${n}`,
		file: 'Inbox.md',
		line: n,
		blockEnd: n,
		keyword: 'TODO',
		status: 'todo',
		tags: [],
		order: n,
		...over,
	};
}

function map(tasks: Task[]): Record<string, Task> {
	return Object.fromEntries(tasks.map((t) => [t.id, t]));
}

const OPTIONS = { span: 7, deadlineWarningDays: 14, showScheduledPast: true, start: TODAY };

/** Titles on a given day, in render order. */
function titlesOn(days: ReturnType<typeof buildAgenda>, date: string): string[] {
	const day = days.find((d) => d.date === date);
	return [...(day?.timed ?? []), ...(day?.untimed ?? [])].map((e) => e.task.title);
}

describe('buildAgenda', () => {
	it('spans the requested number of days from the start', () => {
		const days = buildAgenda({}, OPTIONS);
		expect(days).toHaveLength(7);
		expect(days[0]?.date).toBe(TODAY);
		expect(days[6]?.date).toBe('2026-07-24');
	});

	it('places a SCHEDULED task on its day', () => {
		const days = buildAgenda(map([task({ title: 'Call', scheduled: '2026-07-20' })]), OPTIONS);
		expect(titlesOn(days, '2026-07-20')).toEqual(['Call']);
		expect(titlesOn(days, '2026-07-19')).toEqual([]);
	});

	it('carries a past SCHEDULED task onto every later day', () => {
		const days = buildAgenda(map([task({ title: 'Slipped', scheduled: '2026-07-16' })]), OPTIONS);
		expect(titlesOn(days, TODAY)).toEqual(['Slipped']);
		expect(titlesOn(days, '2026-07-21')).toEqual(['Slipped']);
	});

	it('stops carrying past items forward when the setting is off', () => {
		const days = buildAgenda(map([task({ scheduled: '2026-07-16' })]), {
			...OPTIONS,
			showScheduledPast: false,
		});
		expect(titlesOn(days, TODAY)).toEqual([]);
	});

	it('shows a DEADLINE from its warning window onward', () => {
		const days = buildAgenda(map([task({ title: 'Ship', due: '2026-07-22' })]), {
			...OPTIONS,
			deadlineWarningDays: 2,
		});
		// 4 and 3 days out are outside the 2-day window; 2 days out is inside.
		expect(titlesOn(days, '2026-07-19')).toEqual([]);
		expect(titlesOn(days, '2026-07-20')).toEqual(['Ship']);
		expect(titlesOn(days, '2026-07-22')).toEqual(['Ship']);
	});

	it('keeps an overdue DEADLINE visible every day while it is open', () => {
		const days = buildAgenda(map([task({ title: 'Late', due: '2026-07-10' })]), OPTIONS);
		expect(titlesOn(days, TODAY)).toEqual(['Late']);
		expect(titlesOn(days, '2026-07-24')).toEqual(['Late']);
	});

	it('lists a task with both stamps twice on the same day, once per reason', () => {
		const days = buildAgenda(map([task({ title: 'Both', scheduled: TODAY, due: TODAY })]), OPTIONS);
		const day = days.find((d) => d.date === TODAY);
		const reasons = [...(day?.timed ?? []), ...(day?.untimed ?? [])].map((e) => e.reason);
		expect(reasons).toEqual(['deadline', 'scheduled']);
	});

	it('sorts timed entries chronologically, ahead of untimed ones', () => {
		const days = buildAgenda(
			map([
				task({ title: 'Late meeting', scheduled: TODAY, scheduledTime: '15:00' }),
				task({ title: 'Standup', scheduled: TODAY, scheduledTime: '09:30' }),
				task({ title: 'Anytime', scheduled: TODAY }),
			]),
			OPTIONS,
		);
		expect(titlesOn(days, TODAY)).toEqual(['Standup', 'Late meeting', 'Anytime']);
	});

	it('orders untimed entries: overdue deadline, deadline, past scheduled, scheduled', () => {
		const days = buildAgenda(
			map([
				task({ title: 'Plain', scheduled: TODAY }),
				task({ title: 'Slipped', scheduled: '2026-07-15' }),
				task({ title: 'Due today', due: TODAY }),
				task({ title: 'Overdue', due: '2026-07-01' }),
			]),
			OPTIONS,
		);
		expect(titlesOn(days, TODAY)).toEqual(['Overdue', 'Due today', 'Slipped', 'Plain']);
	});

	it('leaves closed tasks and Someday items off entirely', () => {
		const days = buildAgenda(
			map([
				task({ title: 'Done', scheduled: TODAY, keyword: 'DONE', status: 'done' }),
				task({ title: 'Cancelled', scheduled: TODAY, keyword: 'CANCELLED', status: 'cancelled' }),
				task({ title: 'Someday', scheduled: TODAY, someday: true }),
				task({ title: 'Someday project', scheduled: TODAY, projectStatus: 'someday' }),
				task({ title: 'Real', scheduled: TODAY }),
			]),
			OPTIONS,
		);
		expect(titlesOn(days, TODAY)).toEqual(['Real']);
	});

	it('includes WAITING and NEXT — they are open work', () => {
		const days = buildAgenda(
			map([
				task({ title: 'Blocked', scheduled: TODAY, keyword: 'WAITING' }),
				task({ title: 'Up next', scheduled: TODAY, keyword: 'NEXT' }),
			]),
			OPTIONS,
		);
		// NEXT sorts above WAITING.
		expect(titlesOn(days, TODAY)).toEqual(['Up next', 'Blocked']);
	});
});

describe('agendaPrefix', () => {
	const entry = (over: Partial<AgendaEntry>): AgendaEntry =>
		({ task: task({}), reason: 'scheduled', daysFrom: 0, ...over }) as AgendaEntry;

	it('counts how many times a past scheduled item has been shown', () => {
		expect(agendaPrefix(entry({ reason: 'past-scheduled', daysFrom: -2 }))).toBe('Sched. 3x');
	});

	it('reports how late an overdue deadline is', () => {
		expect(agendaPrefix(entry({ reason: 'past-deadline', daysFrom: -3 }))).toBe('3 d. ago');
	});

	it('labels a deadline by how far off it is', () => {
		expect(agendaPrefix(entry({ reason: 'deadline', daysFrom: 0 }))).toBe('Deadline');
		expect(agendaPrefix(entry({ reason: 'deadline', daysFrom: 4 }))).toBe('In 4 d.');
	});

	it('gives a plain scheduled item no prefix', () => {
		expect(agendaPrefix(entry({ reason: 'scheduled' }))).toBeNull();
	});
});

describe('selectByKeyword', () => {
	it('narrows to one keyword, ignoring dates', () => {
		const tasks = map([
			task({ title: 'A', keyword: 'NEXT' }),
			task({ title: 'B', keyword: 'TODO' }),
			task({ title: 'C', keyword: 'NEXT', scheduled: '2030-01-01' }),
		]);
		expect(selectByKeyword(tasks, 'NEXT').map((t) => t.title)).toEqual(['A', 'C']);
	});

	it('returns every open task when no keyword is given', () => {
		const tasks = map([
			task({ keyword: 'TODO' }),
			task({ keyword: 'DONE', status: 'done' }),
			task({ keyword: 'WAITING' }),
		]);
		expect(selectByKeyword(tasks)).toHaveLength(2);
	});
});
