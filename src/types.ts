import type { OrgKeyword } from './org/keywords';

export type TaskStatus = 'todo' | 'done' | 'cancelled';
export type ProjectStatus = 'active' | 'someday' | 'done';

/** A child checkbox rendered inside its parent task, not an independent task. */
export interface ChecklistItem {
	id: string;
	title: string;
	done: boolean;
	line: number;
}

export interface Task {
	id: string;
	/** Headline text with keyword, priority cookie, tags, and ID removed. */
	title: string;
	file: string;
	line: number;
	/** The TODO keyword as written. `status` is its coarse done/not-done view. */
	keyword: OrgKeyword;
	status: TaskStatus;
	/** ISO date from `SCHEDULED:` — when the task is planned to start. */
	scheduled?: string;
	/** ISO date from `DEADLINE:` (hard deadline). */
	due?: string;
	/** Org repeater as written, e.g. `+1w`, `.+2d`. Lives on the SCHEDULED/DEADLINE stamp. */
	repeater?: string;
	tags: string[];
	/** Project note path; undefined = Inbox. */
	project?: string;
	projectStatus?: ProjectStatus;
	/** Enclosing markdown heading (the task's section). */
	heading?: string;
	order: number;
	/** ISO datetime, index-only. */
	completedAt?: string;
	/** `:tonight:` tag — shows in Today's evening section. */
	evening?: boolean;
	/** Task-level Someday: the `:someday:` tag or the SOMEDAY keyword. */
	someday?: boolean;
	checklist?: ChecklistItem[];
	/** 1 = [#A], 2 = [#B], 3 = [#C]. Sorts above manual order. */
	priority?: 1 | 2 | 3;
	/** Optional HH:mm on the SCHEDULED stamp — sorts the agenda chronologically. */
	scheduledTime?: string;
	/** HH:mm end of a `09:30-10:15` range, shown as a duration in the agenda. */
	scheduledEndTime?: string;
	/** Last line of the task's block (planning line + drawers), inclusive. */
	blockEnd: number;
	/** Arbitrary `:PROPERTIES:` drawer entries, minus the ID. */
	properties?: Record<string, string>;
}

export interface ProjectInfo {
	path: string;
	name: string;
	status: ProjectStatus;
	/** Area grouping, from `area: <name>` frontmatter. */
	area?: string;
}

export type FilterDate = 'any' | 'overdue' | 'today' | 'this-week' | 'none' | 'has-date';

/** A pinned smart list, persisted in data.json and shown in the sidebar. */
export interface SavedFilter {
	id: string;
	name: string;
	/** Lucide icon name; default "filter". */
	icon?: string;
	/** Every listed tag must be present (nested tags match by prefix). */
	tags?: string[];
	/** Only tasks carrying one of these TODO keywords. */
	keywords?: OrgKeyword[];
	/** Project name, case-insensitive. */
	project?: string;
	/** Area name, case-insensitive. */
	area?: string;
	date?: FilterDate;
	/** Case-insensitive substring of the title. */
	text?: string;
}

/** One entry in the index-owned completion log (survives recurring rewrites). */
export interface CompletionEntry {
	taskId: string;
	title: string;
	/** Project note path at completion time; undefined = Inbox. */
	project?: string;
	status: 'done' | 'cancelled';
	/** ISO datetime. */
	completedAt: string;
}
