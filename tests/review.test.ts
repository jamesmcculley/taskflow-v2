import { describe, expect, it } from 'vitest';
import { buildReviewSteps, selectReviewStepTasks } from '../src/store/review';
import type { ProjectInfo, Task } from '../src/types';

const TODAY = '2026-07-19';

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

const projects: Record<string, ProjectInfo> = {
	'P/Site.md': { path: 'P/Site.md', name: 'Site', status: 'active', area: 'Work' },
	'P/Reno.md': { path: 'P/Reno.md', name: 'Reno', status: 'active', area: 'Home' },
	'P/Spanish.md': { path: 'P/Spanish.md', name: 'Spanish', status: 'someday' },
};

function state(list: Task[]) {
	return { tasks: Object.fromEntries(list.map((t) => [t.id, t])), projects };
}

describe('buildReviewSteps', () => {
	it('walks inbox → overdue → active projects (by area, name) → someday', () => {
		const s = state([
			task({ id: 'in' }),
			task({ id: 'over', scheduled: '2026-07-01' }),
			task({ id: 'site', project: 'P/Site.md', projectStatus: 'active', file: 'P/Site.md' }),
			task({ id: 'reno', project: 'P/Reno.md', projectStatus: 'active', file: 'P/Reno.md' }),
			task({ id: 'sd', project: 'P/Spanish.md', projectStatus: 'someday', file: 'P/Spanish.md' }),
		]);
		expect(buildReviewSteps(s, TODAY).map((st) => st.key)).toEqual([
			'inbox',
			'overdue',
			'project:P/Reno.md',
			'project:P/Site.md',
			'someday',
		]);
	});

	it('skips empty groups', () => {
		const s = state([task({ id: 'site', project: 'P/Site.md', projectStatus: 'active' })]);
		expect(buildReviewSteps(s, TODAY).map((st) => st.key)).toEqual(['project:P/Site.md']);
	});

	it('returns no steps for an empty system', () => {
		expect(buildReviewSteps(state([]), TODAY)).toEqual([]);
	});
});

describe('selectReviewStepTasks', () => {
	it('resolves live tasks per step', () => {
		const s = state([
			task({ id: 'in' }),
			task({ id: 'over', due: '2026-07-01', project: 'P/Reno.md', projectStatus: 'active' }),
			task({ id: 'site', project: 'P/Site.md', projectStatus: 'active' }),
		]);
		const [inbox, overdue] = buildReviewSteps(s, TODAY);
		expect(selectReviewStepTasks(inbox!, s, TODAY).map((t) => t.id)).toEqual(['in']);
		expect(selectReviewStepTasks(overdue!, s, TODAY).map((t) => t.id)).toEqual(['over']);
	});

	it('an unfiled overdue task appears only in Overdue, not Inbox (Inbox is undated triage only)', () => {
		const s = state([task({ id: 'both', due: '2026-07-01' })]);
		const steps = buildReviewSteps(s, TODAY);
		expect(steps.map((st) => st.key)).toEqual(['overdue']);
		expect(selectReviewStepTasks(steps[0]!, s, TODAY).map((t) => t.id)).toEqual(['both']);
	});
});
