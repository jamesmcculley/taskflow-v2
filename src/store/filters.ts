import { compareTasks, effectiveDate, endOfWeekISO } from './selectors';
import type { ProjectInfo, SavedFilter, Task } from '../types';

/** Pinned filters match open tasks only. */
export function matchesFilter(
	task: Task,
	filter: SavedFilter,
	projects: Record<string, ProjectInfo>,
	today: string,
): boolean {
	if (task.status !== 'todo') return false;

	// Keywords are an OR within the criterion (any listed keyword matches) and
	// AND against everything else, matching how tags/project/date combine.
	if (filter.keywords && filter.keywords.length > 0) {
		if (!filter.keywords.includes(task.keyword)) return false;
	}

	if (filter.tags && filter.tags.length > 0) {
		// Obsidian treats tags case-insensitively; so do we. Nested tags match
		// by prefix (filter "dev" matches "dev/backend").
		const taskTags = task.tags.map((t) => t.toLowerCase());
		const ok = filter.tags.every((tag) => {
			const wanted = tag.toLowerCase();
			return taskTags.some((t) => t === wanted || t.startsWith(`${wanted}/`));
		});
		if (!ok) return false;
	}

	const project = task.project !== undefined ? projects[task.project] : undefined;
	if (filter.project !== undefined) {
		if (project === undefined || project.name.toLowerCase() !== filter.project.toLowerCase())
			return false;
	}
	if (filter.area !== undefined) {
		if ((project?.area ?? '').toLowerCase() !== filter.area.toLowerCase()) return false;
	}

	if (filter.text !== undefined && filter.text !== '') {
		if (!task.title.toLowerCase().includes(filter.text.toLowerCase())) return false;
	}

	const date = effectiveDate(task);
	switch (filter.date ?? 'any') {
		case 'any':
			return true;
		case 'overdue':
			return date !== undefined && date < today;
		case 'today':
			return date !== undefined && date <= today;
		case 'this-week':
			return date !== undefined && date <= endOfWeekISO(today);
		case 'none':
			return date === undefined;
		case 'has-date':
			return date !== undefined;
	}
}

export function selectFilterTasks(
	tasks: Record<string, Task>,
	filter: SavedFilter,
	projects: Record<string, ProjectInfo>,
	today: string,
): Task[] {
	return Object.values(tasks)
		.filter((t) => matchesFilter(t, filter, projects, today))
		.sort(compareTasks);
}
