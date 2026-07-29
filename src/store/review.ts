import {
	selectInboxTasks,
	selectProjectGroups,
	selectSomedayTasks,
	selectTodayGroups,
} from './selectors';
import type { ProjectInfo, Task } from '../types';

export interface ReviewStep {
	/** 'inbox' | 'overdue' | 'project:<path>' | 'someday' */
	key: string;
	title: string;
	blurb: string;
}

export interface ReviewState {
	tasks: Record<string, Task>;
	projects: Record<string, ProjectInfo>;
}

/**
 * The review walkthrough: Inbox → overdue → each active project → Someday.
 * Steps that are empty when the review starts are skipped; project order is
 * frozen at start so the walk is stable while items get processed.
 */
export function buildReviewSteps(state: ReviewState, today: string): ReviewStep[] {
	const steps: ReviewStep[] = [];
	if (selectInboxTasks(state.tasks).length > 0) {
		steps.push({
			key: 'inbox',
			title: 'Inbox',
			blurb: 'Clear it out: schedule, move to a project, or send to Someday.',
		});
	}
	if (selectTodayGroups(state.tasks, today).overdue.length > 0) {
		steps.push({
			key: 'overdue',
			title: 'Overdue',
			blurb: 'Reschedule or complete anything that slipped.',
		});
	}
	const active = Object.values(state.projects)
		.filter((p) => p.status === 'active')
		.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name));
	for (const p of active) {
		if (selectProjectGroups(state.tasks, p.path).length === 0) continue;
		steps.push({
			key: `project:${p.path}`,
			title: p.name,
			blurb: 'Is this project moving? Check next actions, dates, and what can be dropped.',
		});
	}
	if (selectSomedayTasks(state.tasks).length > 0) {
		steps.push({
			key: 'someday',
			title: 'Someday',
			blurb: 'Anything here ready to become active?',
		});
	}
	return steps;
}

/** Live task list for a step — items disappear as they get processed. */
export function selectReviewStepTasks(
	step: ReviewStep,
	state: ReviewState,
	today: string,
): Task[] {
	if (step.key === 'inbox') return selectInboxTasks(state.tasks);
	if (step.key === 'overdue') return selectTodayGroups(state.tasks, today).overdue;
	if (step.key === 'someday') return selectSomedayTasks(state.tasks);
	const path = step.key.slice('project:'.length);
	return selectProjectGroups(state.tasks, path).flatMap((g) => g.tasks);
}
