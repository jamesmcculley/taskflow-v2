import { describe, expect, it } from 'vitest';
import {
	addDaysISO,
	applyManualOrder,
	diffDaysISO,
	endOfWeekISO,
	projectProgress,
	selectWheneverTasks,
	selectAreaGroups,
	selectAreaTasks,
	selectInboxTasks,
	selectHistoryGroups,
	selectProjectGroups,
	selectProjectSomedayTasks,
	selectSomedayTasks,
	selectTasksByProject,
	selectTodayGroups,
	selectTodayTasks,
	selectUpcomingGroups,
	todayISO,
	upcomingLabel,
} from '../src/store/selectors';
import { selectVisibleTasks } from '../src/store/visible';
import type { ProjectInfo, Task } from '../src/types';

const TODAY = '2026-07-18';

let nextLine = 0;
function task(overrides: Partial<Task>): Task {
	nextLine += 1;
	return {
		id: `t-${String(nextLine).padStart(6, '0')}`,
		title: 'Task',
		file: 'Inbox.md',
		line: nextLine,
		keyword: 'TODO',
		status: 'todo',
		tags: [],
		order: nextLine,
		blockEnd: nextLine,
		...overrides,
	};
}

function byId(list: Task[]): Record<string, Task> {
	return Object.fromEntries(list.map((t) => [t.id, t]));
}

describe('selectTodayTasks', () => {
	it('includes tasks scheduled today or earlier', () => {
		const tasks = byId([
			task({ id: 'a', scheduled: '2026-07-18' }),
			task({ id: 'b', scheduled: '2026-07-01' }),
			task({ id: 'c', scheduled: '2026-07-19' }),
		]);
		expect(selectTodayTasks(tasks, TODAY).map((t) => t.id)).toEqual(['a', 'b']);
	});

	it('includes tasks due today or earlier', () => {
		const tasks = byId([
			task({ id: 'a', due: '2026-07-18' }),
			task({ id: 'b', due: '2026-07-10' }),
			task({ id: 'c', due: '2026-08-01' }),
		]);
		expect(selectTodayTasks(tasks, TODAY).map((t) => t.id)).toEqual(['a', 'b']);
	});

	it('includes a future-due task when scheduled today', () => {
		const tasks = byId([task({ id: 'a', scheduled: '2026-07-18', due: '2026-08-01' })]);
		expect(selectTodayTasks(tasks, TODAY)).toHaveLength(1);
	});

	it('excludes done and cancelled tasks', () => {
		const tasks = byId([
			task({ id: 'a', scheduled: '2026-07-18', status: 'done' }),
			task({ id: 'b', scheduled: '2026-07-18', status: 'cancelled' }),
			task({ id: 'c', scheduled: '2026-07-18' }),
		]);
		expect(selectTodayTasks(tasks, TODAY).map((t) => t.id)).toEqual(['c']);
	});

	it('excludes tasks with no dates', () => {
		expect(selectTodayTasks(byId([task({ id: 'a' })]), TODAY)).toEqual([]);
	});

	it('sorts by order', () => {
		const tasks = byId([
			task({ id: 'a', scheduled: '2026-07-18', order: 5 }),
			task({ id: 'b', scheduled: '2026-07-18', order: 1 }),
		]);
		expect(selectTodayTasks(tasks, TODAY).map((t) => t.id)).toEqual(['b', 'a']);
	});

	it('applyManualOrder: list order wins within a priority/time band, unknowns last', () => {
		const list = [
			task({ id: 'a', order: 1 }),
			task({ id: 'b', order: 2 }),
			task({ id: 'c', order: 3 }),
			task({ id: 'p1', order: 4, priority: 1 }),
		];
		const ordered = applyManualOrder(list, { c: 0, a: 1 });
		expect(ordered.map((t) => t.id)).toEqual(['p1', 'c', 'a', 'b']);
		expect(applyManualOrder(list, undefined).map((t) => t.id)).toEqual(['a', 'b', 'c', 'p1']);
	});

	it('priority beats order, time beats order, priority beats time', () => {
		const tasks = byId([
			task({ id: 'plain', scheduled: '2026-07-18', order: 0 }),
			task({ id: 'p1', scheduled: '2026-07-18', order: 9, priority: 1 }),
			task({ id: 'p2', scheduled: '2026-07-18', order: 9, priority: 2 }),
			task({ id: 'timed', scheduled: '2026-07-18', order: 9, scheduledTime: '09:00' }),
		]);
		expect(selectTodayTasks(tasks, TODAY).map((t) => t.id)).toEqual([
			'p1',
			'p2',
			'timed',
			'plain',
		]);
	});
});

describe('selectInboxTasks', () => {
	it('includes only open, unfiled, undated tasks', () => {
		const tasks = byId([
			task({ id: 'a' }),
			task({ id: 'b', project: 'Projects/X.md', file: 'Projects/X.md' }),
			task({ id: 'c', status: 'done' }),
			task({ id: 'd', status: 'cancelled' }),
			task({ id: 'e', scheduled: '2026-07-25' }),
			task({ id: 'f', due: '2026-08-01' }),
		]);
		expect(selectInboxTasks(tasks).map((t) => t.id)).toEqual(['a']);
	});

	it('is a triage holding area: scheduling removes, clearing the date restores', () => {
		// Same task, same file — only the presence of a date changes.
		const scheduled = byId([task({ id: 'a', scheduled: '2026-07-25' })]);
		expect(selectInboxTasks(scheduled)).toEqual([]);
		const cleared = byId([task({ id: 'a' })]);
		expect(selectInboxTasks(cleared).map((t) => t.id)).toEqual(['a']);
	});

	it('a completed dated task never reappears in Inbox merely by editing', () => {
		const tasks = byId([task({ id: 'a', status: 'done', scheduled: '2026-07-25' })]);
		expect(selectInboxTasks(tasks)).toEqual([]);
	});
});

describe('selectTasksByProject', () => {
	it('groups tasks by project path, ignoring inbox tasks', () => {
		const tasks = byId([
			task({ id: 'a', project: 'Projects/X.md' }),
			task({ id: 'b', project: 'Projects/Y.md' }),
			task({ id: 'c', project: 'Projects/X.md' }),
			task({ id: 'd' }),
		]);
		const grouped = selectTasksByProject(tasks);
		expect([...grouped.keys()].sort()).toEqual(['Projects/X.md', 'Projects/Y.md']);
		expect(grouped.get('Projects/X.md')?.map((t) => t.id)).toEqual(['a', 'c']);
	});
});

describe('week helpers', () => {
	it('addDaysISO crosses month boundaries', () => {
		expect(addDaysISO('2026-07-31', 1)).toBe('2026-08-01');
		expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('endOfWeekISO returns Sunday of a Monday-start week', () => {
		expect(endOfWeekISO('2026-07-13')).toBe('2026-07-19'); // Monday
		expect(endOfWeekISO('2026-07-18')).toBe('2026-07-19'); // Saturday
		expect(endOfWeekISO('2026-07-19')).toBe('2026-07-19'); // Sunday
		expect(endOfWeekISO('2026-07-20')).toBe('2026-07-26'); // next Monday
	});
});

describe('selectTodayGroups', () => {
	it('splits overdue, today, and tonight', () => {
		const tasks = byId([
			task({ id: 'over', scheduled: '2026-07-10' }),
			task({ id: 'now', scheduled: '2026-07-18' }),
			task({ id: 'dueOver', due: '2026-07-15' }),
			task({ id: 'eve', scheduled: '2026-07-18', evening: true }),
		]);
		const groups = selectTodayGroups(tasks, TODAY);
		expect(groups.overdue.map((t) => t.id)).toEqual(['over', 'dueOver']);
		expect(groups.today.map((t) => t.id)).toEqual(['now']);
		expect(groups.evening.map((t) => t.id)).toEqual(['eve']);
	});

	it('excludes someday tasks from Today', () => {
		const tasks = byId([
			task({ id: 'a', scheduled: '2026-07-18', someday: true }),
			task({ id: 'b', scheduled: '2026-07-18', projectStatus: 'someday' }),
		]);
		const groups = selectTodayGroups(tasks, TODAY);
		expect(groups.overdue.length + groups.today.length + groups.evening.length).toBe(0);
	});
});

describe('task-level someday', () => {
	const tasks = byId([
		task({ id: 'plain' }),
		task({ id: 'tagged', someday: true }),
		task({ id: 'inProj', project: 'P/A.md', projectStatus: 'active', someday: true }),
		task({ id: 'projSomeday', project: 'P/S.md', projectStatus: 'someday' }),
	]);

	it('someday view unions tag-level and project-level', () => {
		expect(selectSomedayTasks(tasks).map((t) => t.id)).toEqual([
			'tagged',
			'inProj',
			'projSomeday',
		]);
	});

	it('inbox and whenever exclude someday tasks', () => {
		expect(selectInboxTasks(tasks).map((t) => t.id)).toEqual(['plain']);
		expect(selectWheneverTasks(tasks)).toEqual([]);
	});

	it('project heading groups exclude someday; dedicated selector returns them', () => {
		expect(selectProjectGroups(tasks, 'P/A.md')).toEqual([]);
		expect(selectProjectSomedayTasks(tasks, 'P/A.md').map((t) => t.id)).toEqual(['inProj']);
	});
});

describe('selectAreaTasks', () => {
	it('groups an area’s open tasks by project', () => {
		const projects: Record<string, ProjectInfo> = {
			'P/Site.md': { path: 'P/Site.md', name: 'Site', status: 'active', area: 'Work' },
			'P/App.md': { path: 'P/App.md', name: 'App', status: 'active', area: 'Work' },
			'P/Reno.md': { path: 'P/Reno.md', name: 'Reno', status: 'active', area: 'Home' },
		};
		const tasks = byId([
			task({ id: 'a', project: 'P/Site.md', projectStatus: 'active' }),
			task({ id: 'b', project: 'P/App.md', projectStatus: 'active' }),
			task({ id: 'c', project: 'P/Reno.md', projectStatus: 'active' }),
			task({ id: 'd', project: 'P/Site.md', projectStatus: 'active', status: 'done' }),
		]);
		const groups = selectAreaTasks(tasks, projects, 'Work');
		expect(groups.map((g) => g.project.name)).toEqual(['App', 'Site']);
		expect(groups[1]?.tasks.map((t) => t.id)).toEqual(['a']);
	});
});

describe('selectUpcomingGroups / upcomingLabel', () => {
	it('groups future tasks by effective date ascending, open only', () => {
		const tasks = byId([
			task({ id: 'a', scheduled: '2026-07-20' }),
			task({ id: 'b', scheduled: '2026-07-19' }),
			task({ id: 'c', scheduled: '2026-07-20', status: 'done' }),
			task({ id: 'd', due: '2026-07-19' }),
			task({ id: 'past', scheduled: '2026-07-18' }),
			task({ id: 'undated' }),
		]);
		const groups = selectUpcomingGroups(tasks, TODAY);
		expect(groups.map((g) => g.date)).toEqual(['2026-07-19', '2026-07-20']);
		expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['b', 'd']);
		expect(groups[1]?.tasks.map((t) => t.id)).toEqual(['a']);
	});

	it('labels: Tomorrow, weekday within this week, then short date', () => {
		// TODAY is Sat 2026-07-18; the week ends Sun 07-19.
		expect(upcomingLabel('2026-07-19', TODAY)).toBe('Tomorrow');
		expect(upcomingLabel('2026-07-19', '2026-07-17')).toBe('Sunday');
		expect(upcomingLabel('2026-07-25', TODAY)).toMatch(/Jul(y)? 25/);
		expect(upcomingLabel('2027-01-05', TODAY)).toMatch(/2027/);
	});
});

describe('selectWheneverTasks / selectSomedayTasks', () => {
	const tasks = byId([
		task({ id: 'a', project: 'P/A.md', projectStatus: 'active' }),
		task({ id: 'b', project: 'P/A.md', projectStatus: 'active', scheduled: '2026-07-20' }),
		task({ id: 'c', project: 'P/S.md', projectStatus: 'someday' }),
		task({ id: 'd' }),
		task({ id: 'e', project: 'P/A.md', projectStatus: 'active', status: 'done' }),
		task({ id: 'f', project: 'P/A.md', projectStatus: 'active', due: '2026-08-01' }),
	]);

	it('whenever: unscheduled open tasks in active projects (due allowed)', () => {
		expect(selectWheneverTasks(tasks).map((t) => t.id)).toEqual(['a', 'f']);
	});

	it('someday: open tasks in someday projects', () => {
		expect(selectSomedayTasks(tasks).map((t) => t.id)).toEqual(['c']);
	});
});

describe('selectHistoryGroups', () => {
	it('groups by local day, newest first', () => {
		const groups = selectHistoryGroups([
			{ taskId: 'a', title: 'A', status: 'done', completedAt: '2026-07-17T10:00:00.000Z' },
			{ taskId: 'b', title: 'B', status: 'done', completedAt: '2026-07-18T09:00:00.000Z' },
			{ taskId: 'c', title: 'C', status: 'cancelled', completedAt: '2026-07-18T11:00:00.000Z' },
		]);
		expect(groups.map((g) => g.day)).toEqual(
			[...groups.map((g) => g.day)].sort().reverse(),
		);
		const latestDay = groups[0];
		expect(latestDay?.entries[0]?.taskId).toBe('c');
	});
});

describe('selectAreaGroups / projectProgress', () => {
	const project = (over: Partial<ProjectInfo>): ProjectInfo => ({
		path: 'x.md',
		name: 'X',
		status: 'active',
		...over,
	});

	it('groups active projects by area, standalone and someday separate', () => {
		const groups = selectAreaGroups({
			'w1.md': project({ path: 'w1.md', name: 'Site', area: 'Work' }),
			'w2.md': project({ path: 'w2.md', name: 'App', area: 'Work' }),
			'h.md': project({ path: 'h.md', name: 'Reno', area: 'Home' }),
			's.md': project({ path: 's.md', name: 'Solo' }),
			'sd.md': project({ path: 'sd.md', name: 'Spanish', status: 'someday' }),
		});
		expect(groups.areas.map((a) => a.name)).toEqual(['Home', 'Work']);
		expect(groups.areas[1]?.projects.map((p) => p.name)).toEqual(['App', 'Site']);
		expect(groups.standalone.map((p) => p.name)).toEqual(['Solo']);
		expect(groups.someday.map((p) => p.name)).toEqual(['Spanish']);
	});

	it('computes progress as done / (done + open)', () => {
		const tasks = byId([
			task({ id: 'a', project: 'p.md', status: 'done' }),
			task({ id: 'b', project: 'p.md' }),
			task({ id: 'c', project: 'p.md', status: 'cancelled' }),
			task({ id: 'd', project: 'other.md' }),
		]);
		expect(projectProgress(tasks, 'p.md')).toBe(0.5);
		expect(projectProgress(tasks, 'empty.md')).toBe(0);
	});
});

describe('selectProjectGroups', () => {
	it('groups open tasks by heading in file order', () => {
		const tasks = byId([
			task({ id: 'a', project: 'p.md', heading: 'Design', line: 1 }),
			task({ id: 'b', project: 'p.md', heading: 'Design', line: 2 }),
			task({ id: 'c', project: 'p.md', heading: 'Build', line: 5 }),
			task({ id: 'done', project: 'p.md', heading: 'Build', line: 6, status: 'done' }),
			task({ id: 'x', project: 'q.md', line: 1 }),
		]);
		const groups = selectProjectGroups(tasks, 'p.md');
		expect(groups.map((g) => g.heading)).toEqual(['Design', 'Build']);
		expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['a', 'b']);
		expect(groups[1]?.tasks.map((t) => t.id)).toEqual(['c']);
	});
});

describe('diffDaysISO', () => {
	it('computes signed day differences across boundaries', () => {
		expect(diffDaysISO('2026-07-18', '2026-07-21')).toBe(3);
		expect(diffDaysISO('2026-07-18', '2026-07-18')).toBe(0);
		expect(diffDaysISO('2026-07-18', '2026-07-15')).toBe(-3);
		expect(diffDaysISO('2026-12-30', '2027-01-02')).toBe(3);
	});
});

describe('selectVisibleTasks', () => {
	const tasks = byId([
		task({ id: 'inbox1' }),
		task({ id: 'over', scheduled: '2026-07-10' }),
		task({ id: 'now', scheduled: '2026-07-18' }),
		task({ id: 'soon', scheduled: '2026-07-20' }),
		task({ id: 'proj', project: 'P/A.md', projectStatus: 'active', heading: 'Build' }),
	]);
	const state = (filters = {}) => ({ tasks, projects: {}, filters: [], ...filters });

	it('today: overdue first, then today', () => {
		expect(
			selectVisibleTasks({ kind: 'list', list: 'today' }, state(), TODAY).map((t) => t.id),
		).toEqual(['over', 'now']);
	});

	it('project routes flatten heading groups', () => {
		expect(
			selectVisibleTasks({ kind: 'project', path: 'P/A.md' }, state(), TODAY).map((t) => t.id),
		).toEqual(['proj']);
	});

	it('history has no navigable tasks', () => {
		expect(selectVisibleTasks({ kind: 'list', list: 'history' }, state(), TODAY)).toEqual([]);
	});

	it('upcoming flattens date groups in order', () => {
		expect(
			selectVisibleTasks({ kind: 'list', list: 'upcoming' }, state(), TODAY).map((t) => t.id),
		).toEqual(['soon']);
	});

	it('filter routes resolve the saved filter', () => {
		const withFilter = state({
			filters: [{ id: 'f-1', name: 'Overdue', date: 'overdue' as const }],
		});
		expect(
			selectVisibleTasks({ kind: 'filter', id: 'f-1' }, withFilter, TODAY).map((t) => t.id),
		).toEqual(['over']);
		expect(selectVisibleTasks({ kind: 'filter', id: 'f-gone' }, withFilter, TODAY)).toEqual([]);
	});
});

describe('todayISO', () => {
	it('formats a local date as YYYY-MM-DD', () => {
		expect(todayISO(new Date(2026, 6, 18, 23, 59))).toBe('2026-07-18');
		expect(todayISO(new Date(2026, 0, 3))).toBe('2026-01-03');
	});
});

describe('list membership boundaries', () => {
	const t = (over: Partial<Task>): Task =>
		({
			id: over.id ?? 'x',
			title: 't',
			file: 'f.md',
			line: 0,
			blockEnd: 0,
			keyword: 'TODO',
			status: 'todo',
			tags: [],
			order: 0,
			...over,
		}) as Task;

	// Inbox is triage: a keyword other than TODO means the task has already been
	// processed, so it must not still be sitting there awaiting a decision.
	it('keeps NEXT and WAITING out of Inbox', () => {
		const tasks = {
			a: t({ id: 'a', keyword: 'NEXT' }),
			b: t({ id: 'b', keyword: 'WAITING' }),
			c: t({ id: 'c' }),
		};
		expect(selectInboxTasks(tasks).map((x) => x.id)).toEqual(['c']);
	});

	it('still keeps a plain undated, unfiled TODO in Inbox', () => {
		const tasks = { c: t({ id: 'c' }) };
		expect(selectInboxTasks(tasks).map((x) => x.id)).toEqual(['c']);
	});
});
