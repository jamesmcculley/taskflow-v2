import { describe, expect, it } from 'vitest';
import { matchesFilter, selectFilterTasks } from '../src/store/filters';
import type { ProjectInfo, SavedFilter, Task } from '../src/types';

const TODAY = '2026-07-19';

const projects: Record<string, ProjectInfo> = {
	'P/Site.md': { path: 'P/Site.md', name: 'Site', status: 'active', area: 'Work' },
	'P/Reno.md': { path: 'P/Reno.md', name: 'Reno', status: 'active', area: 'Home' },
};

let n = 0;
function task(over: Partial<Task>): Task {
	n += 1;
	return {
		id: `t-${n}`,
		title: 'Task',
		file: 'Inbox.md',
		line: n,
		keyword: 'TODO',
		status: 'todo',
		tags: [],
		order: n,
		blockEnd: n,
		...over,
	};
}

function filter(over: Partial<SavedFilter>): SavedFilter {
	return { id: 'f-test', name: 'Test', ...over };
}

describe('matchesFilter', () => {
	it('matches open tasks only', () => {
		expect(matchesFilter(task({ status: 'done' }), filter({}), projects, TODAY)).toBe(false);
		expect(matchesFilter(task({}), filter({}), projects, TODAY)).toBe(true);
	});

	it('requires every tag, matching nested tags by prefix', () => {
		const t = task({ tags: ['work', 'dev/backend'] });
		expect(matchesFilter(t, filter({ tags: ['work'] }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ tags: ['dev'] }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ tags: ['work', 'home'] }), projects, TODAY)).toBe(false);
	});

	it('matches tags case-insensitively, like Obsidian', () => {
		const t = task({ tags: ['Work', 'Dev/Backend'] });
		expect(matchesFilter(t, filter({ tags: ['work'] }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ tags: ['WORK'] }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ tags: ['dev'] }), projects, TODAY)).toBe(true);
	});

	it('matches project and area by name, case-insensitive', () => {
		const t = task({ project: 'P/Site.md' });
		expect(matchesFilter(t, filter({ project: 'site' }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ project: 'Reno' }), projects, TODAY)).toBe(false);
		expect(matchesFilter(t, filter({ area: 'work' }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ area: 'Home' }), projects, TODAY)).toBe(false);
		expect(matchesFilter(task({}), filter({ area: 'Work' }), projects, TODAY)).toBe(false);
	});

	it('applies date windows on the effective date', () => {
		const overdue = task({ scheduled: '2026-07-10' });
		const dueSoon = task({ due: '2026-07-21' });
		const undated = task({});
		expect(matchesFilter(overdue, filter({ date: 'overdue' }), projects, TODAY)).toBe(true);
		expect(matchesFilter(dueSoon, filter({ date: 'overdue' }), projects, TODAY)).toBe(false);
		expect(matchesFilter(dueSoon, filter({ date: 'this-week' }), projects, TODAY)).toBe(false);
		expect(matchesFilter(undated, filter({ date: 'none' }), projects, TODAY)).toBe(true);
		expect(matchesFilter(undated, filter({ date: 'has-date' }), projects, TODAY)).toBe(false);
	});

	it('matches title substrings case-insensitively', () => {
		const t = task({ title: 'Send weekly report' });
		expect(matchesFilter(t, filter({ text: 'WEEKLY' }), projects, TODAY)).toBe(true);
		expect(matchesFilter(t, filter({ text: 'monthly' }), projects, TODAY)).toBe(false);
	});

	it('combines criteria with AND', () => {
		const t = task({ project: 'P/Site.md', tags: ['work'], scheduled: '2026-07-10' });
		expect(
			matchesFilter(t, filter({ area: 'Work', tags: ['work'], date: 'overdue' }), projects, TODAY),
		).toBe(true);
		expect(
			matchesFilter(t, filter({ area: 'Work', tags: ['work'], date: 'none' }), projects, TODAY),
		).toBe(false);
	});
});

describe('selectFilterTasks', () => {
	it('filters and sorts by order', () => {
		const a = task({ tags: ['work'], order: 5 });
		const b = task({ tags: ['work'], order: 1 });
		const c = task({ tags: ['home'] });
		const tasks = Object.fromEntries([a, b, c].map((t) => [t.id, t]));
		expect(
			selectFilterTasks(tasks, filter({ tags: ['work'] }), projects, TODAY).map((t) => t.id),
		).toEqual([b.id, a.id]);
	});
});

describe('matchesFilter — TODO keywords', () => {
	it('matches any of the selected keywords', () => {
		const f = filter({ keywords: ['NEXT', 'WAITING'] });
		expect(matchesFilter(task({ keyword: 'NEXT' }), f, projects, TODAY)).toBe(true);
		expect(matchesFilter(task({ keyword: 'WAITING' }), f, projects, TODAY)).toBe(true);
		expect(matchesFilter(task({ keyword: 'TODO' }), f, projects, TODAY)).toBe(false);
	});

	it('matches any keyword when none are selected', () => {
		const f = filter({ keywords: [] });
		expect(matchesFilter(task({ keyword: 'WAITING' }), f, projects, TODAY)).toBe(true);
	});

	it('ANDs the keyword criterion against the others', () => {
		const f = filter({ keywords: ['NEXT'], tags: ['dev'] });
		expect(matchesFilter(task({ keyword: 'NEXT', tags: ['dev'] }), f, projects, TODAY)).toBe(true);
		expect(matchesFilter(task({ keyword: 'NEXT', tags: ['home'] }), f, projects, TODAY)).toBe(false);
	});
});
