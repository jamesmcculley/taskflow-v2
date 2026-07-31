import { buildAgenda, selectByKeyword } from './agenda';
import { selectFilterTasks } from './filters';
import {
	applyManualOrder,
	selectWheneverTasks,
	selectAreaTasks,
	selectInboxTasks,
	selectProjectGroups,
	selectProjectSomedayTasks,
	selectSomedayTasks,
	selectTodayGroups,
	selectUpcomingGroups,
} from './selectors';
import type { Route } from './store';
import type { ProjectInfo, SavedFilter, Task } from '../types';
import { own } from '../utils';

/** Agenda window, so keyboard navigation walks the same days the view shows. */
export interface AgendaNavOptions {
	start?: string;
	span?: number;
	deadlineWarningDays?: number;
	showScheduledPast?: boolean;
}

export interface VisibleState {
	tasks: Record<string, Task>;
	projects: Record<string, ProjectInfo>;
	filters: SavedFilter[];
	/** Per-list manual orders — keeps keyboard order matching render order. */
	orders?: Record<string, Record<string, number>>;
}

/** The flat, in-render-order task list for a route — drives keyboard navigation. */
export function selectVisibleTasks(route: Route, state: VisibleState, today: string, agenda?: AgendaNavOptions): Task[] {
	const { tasks, projects, filters } = state;
	const orders = state.orders ?? {};
	const inOrder = (list: Task[], key: string) => applyManualOrder(list, own(orders, key));
	if (route.kind === 'agenda') {
		// One task can occupy several agenda lines; keyboard navigation walks
		// distinct tasks, so the duplicates collapse here.
		const seen = new Set<string>();
		const out: Task[] = [];
		for (const day of buildAgenda(tasks, { start: agenda?.start, span: agenda?.span ?? 7, deadlineWarningDays: agenda?.deadlineWarningDays ?? 14, showScheduledPast: agenda?.showScheduledPast ?? true })) {
			for (const entry of [...day.timed, ...day.untimed]) {
				if (seen.has(entry.task.id)) continue;
				seen.add(entry.task.id);
				out.push(entry.task);
			}
		}
		return out;
	}
	if (route.kind === 'project') {
		const key = `project:${route.path}`;
		return [
			...selectProjectGroups(tasks, route.path).flatMap((g) => inOrder(g.tasks, key)),
			...selectProjectSomedayTasks(tasks, route.path),
		];
	}
	if (route.kind === 'filter') {
		const filter = filters.find((f) => f.id === route.id);
		return filter ? selectFilterTasks(tasks, filter, projects, today) : [];
	}
	if (route.kind === 'area') {
		return selectAreaTasks(tasks, projects, route.name).flatMap((g) => g.tasks);
	}
	if (route.kind === 'review') return [];
	switch (route.list) {
		case 'inbox':
			return inOrder(selectInboxTasks(tasks), 'list:inbox');
		case 'today': {
			const groups = selectTodayGroups(tasks, today);
			return [
				...groups.overdue,
				...inOrder(groups.today, 'list:today'),
				...inOrder(groups.evening, 'list:today-evening'),
			];
		}
		case 'upcoming':
			return selectUpcomingGroups(tasks, today).flatMap((g) => g.tasks);
		case 'whenever':
			return inOrder(selectWheneverTasks(tasks), 'list:whenever');
		case 'someday':
			return inOrder(selectSomedayTasks(tasks), 'list:someday');
		case 'next':
			return inOrder(selectByKeyword(tasks, 'NEXT'), 'list:next');
		case 'waiting':
			return inOrder(selectByKeyword(tasks, 'WAITING'), 'list:waiting');
		case 'history':
			return [];
	}
}
