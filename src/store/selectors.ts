import type { CompletionEntry, ProjectInfo, Task } from '../types';

export function todayISO(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Whole days from one ISO date to another (positive when `to` is later). */
export function diffDaysISO(fromISO: string, toISO: string): number {
	const utc = (iso: string) => {
		const [y, m, d] = iso.split('-').map(Number);
		return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	};
	return Math.round((utc(toISO) - utc(fromISO)) / 86400000);
}

export function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	return todayISO(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
}

/** Sunday of the week containing `today` (Monday-start weeks). */
export function endOfWeekISO(today: string): string {
	const [y, m, d] = today.split('-').map(Number);
	const dow = (new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7; // 0 = Monday
	return addDaysISO(today, 6 - dow);
}

/** The date a task sorts under: the earlier of scheduled/due. */
export function effectiveDate(t: Task): string | undefined {
	if (t.scheduled !== undefined && t.due !== undefined)
		return t.scheduled < t.due ? t.scheduled : t.due;
	return t.scheduled ?? t.due;
}

/**
 * Applies a per-list manual order on top of the natural sort: priority and
 * scheduled time still dominate, then the list's saved indexes, then the
 * natural comparator. Tasks absent from the map sort after ordered ones.
 */
export function applyManualOrder(
	tasks: Task[],
	order: Record<string, number> | undefined,
): Task[] {
	if (!order) return tasks;
	const rank = (t: Task) =>
		Object.prototype.hasOwnProperty.call(order, t.id)
			? (order[t.id] ?? Number.MAX_SAFE_INTEGER)
			: Number.MAX_SAFE_INTEGER;
	return [...tasks].sort((a, b) => {
		const priority = (a.priority ?? 9) - (b.priority ?? 9);
		if (priority !== 0) return priority;
		const at = a.scheduledTime ?? '~';
		const bt = b.scheduledTime ?? '~';
		if (at !== bt) return at < bt ? -1 : 1;
		return rank(a) - rank(b) || compareTasks(a, b);
	});
}

/**
 * Keyword sort weight. NEXT is org's "do this next" marker, so it floats above
 * plain TODOs; WAITING is parked on someone else and sinks below them.
 */
function keywordRank(t: Task): number {
	if (t.keyword === 'NEXT') return 0;
	if (t.keyword === 'WAITING') return 2;
	if (t.keyword === 'SOMEDAY') return 3;
	return 1;
}

export function compareTasks(a: Task, b: Task): number {
	// Priority beats manual order (Todoist-style); a scheduled time sorts the
	// day chronologically. Plain codepoint comparison ('~' > digits) — NOT
	// localeCompare, whose collation can sort '~' before numbers.
	const at = a.scheduledTime ?? '~';
	const bt = b.scheduledTime ?? '~';
	return (
		(a.priority ?? 9) - (b.priority ?? 9) ||
		keywordRank(a) - keywordRank(b) ||
		(at < bt ? -1 : at > bt ? 1 : 0) ||
		a.order - b.order ||
		a.file.localeCompare(b.file) ||
		a.line - b.line
	);
}

/** Someday at either level: a #someday tag on the task or a someday project. */
export function isSomedayTask(t: Task): boolean {
	return t.someday === true || t.projectStatus === 'someday';
}

/**
 * Open, unfiled, undated tasks — Inbox is a triage holding area, not a
 * permanent home. Scheduling a task (Today/Upcoming) or filing it into a
 * project/Someday moves it out automatically; clearing the date or removing
 * it from a project drops it back in, so nothing gets lost. Completed and
 * cancelled tasks never return to Inbox on edit (they're excluded by
 * status, independent of date/project), matching Someday/Whenever/Upcoming.
 */
export function selectInboxTasks(tasks: Record<string, Task>): Task[] {
	return Object.values(tasks)
		.filter(
			(t) =>
				t.status === 'todo' &&
				// Giving a task a keyword other than plain TODO *is* triage — a
				// NEXT item has been shortlisted and a WAITING one is parked on
				// someone else, so neither is still awaiting a decision. Leaving
				// them here contradicted Inbox's own rule that processing a task
				// moves it out, and put the one genuinely un-actionable state
				// (WAITING) in the list you work from.
				t.keyword === 'TODO' &&
				t.project === undefined &&
				!isSomedayTask(t) &&
				t.scheduled === undefined &&
				t.due === undefined,
		)
		.sort(compareTasks);
}

/** Open tasks scheduled ≤ today OR due ≤ today. ISO dates compare lexicographically. */
export function selectTodayTasks(tasks: Record<string, Task>, today: string): Task[] {
	return Object.values(tasks)
		.filter(
			(t) =>
				t.status === 'todo' &&
				!isSomedayTask(t) &&
				((t.scheduled !== undefined && t.scheduled <= today) ||
					(t.due !== undefined && t.due <= today)),
		)
		.sort(compareTasks);
}

function compareByEffectiveDate(a: Task, b: Task): number {
	return (effectiveDate(a) ?? '').localeCompare(effectiveDate(b) ?? '') || compareTasks(a, b);
}

export interface TodayGroups {
	/** Dated before today — surfaced above today's items, visually flagged. */
	overdue: Task[];
	today: Task[];
	/** 🌙-flagged tasks — the Tonight section. */
	evening: Task[];
}

export function selectTodayGroups(tasks: Record<string, Task>, today: string): TodayGroups {
	const all = selectTodayTasks(tasks, today);
	const overdue = all.filter((t) => (effectiveDate(t) ?? today) < today);
	const current = all.filter((t) => (effectiveDate(t) ?? today) >= today);
	return {
		overdue,
		today: current.filter((t) => t.evening !== true),
		evening: current.filter((t) => t.evening === true),
	};
}

export interface UpcomingGroup {
	date: string;
	tasks: Task[];
}

/** Open tasks dated after today, grouped by their effective date, ascending. */
export function selectUpcomingGroups(tasks: Record<string, Task>, today: string): UpcomingGroup[] {
	const byDate = new Map<string, Task[]>();
	for (const t of Object.values(tasks)) {
		if (t.status !== 'todo' || isSomedayTask(t)) continue;
		const date = effectiveDate(t);
		if (date === undefined || date <= today) continue;
		const list = byDate.get(date) ?? [];
		list.push(t);
		byDate.set(date, list);
	}
	return [...byDate.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, list]) => ({ date, tasks: list.sort(compareByEffectiveDate) }));
}

/** Upcoming group header: Tomorrow, weekday names this week, then "Jul 25". */
export function upcomingLabel(date: string, today: string): string {
	if (date === addDaysISO(today, 1)) return 'Tomorrow';
	const [y, m, d] = date.split('-').map(Number);
	const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	if (date <= endOfWeekISO(today)) return dt.toLocaleDateString(undefined, { weekday: 'long' });
	const sameYear = date.slice(0, 4) === today.slice(0, 4);
	return dt.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
	});
}

/** Whenever: open tasks in active projects with no scheduled date. */
export function selectWheneverTasks(tasks: Record<string, Task>): Task[] {
	return Object.values(tasks)
		.filter(
			(t) =>
				t.status === 'todo' &&
				t.projectStatus === 'active' &&
				t.scheduled === undefined &&
				!isSomedayTask(t),
		)
		.sort(compareTasks);
}

/** Someday: open tasks in someday projects or carrying a #someday tag anywhere. */
export function selectSomedayTasks(tasks: Record<string, Task>): Task[] {
	return Object.values(tasks)
		.filter((t) => t.status === 'todo' && isSomedayTask(t))
		.sort(compareTasks);
}

export interface AreaTaskGroup {
	project: ProjectInfo;
	tasks: Task[];
}

/** Open tasks across an area's projects, grouped by project. */
export function selectAreaTasks(
	tasks: Record<string, Task>,
	projects: Record<string, ProjectInfo>,
	area: string,
): AreaTaskGroup[] {
	return Object.values(projects)
		.filter((p) => p.status === 'active' && p.area === area)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((project) => ({
			project,
			tasks: Object.values(tasks)
				.filter((t) => t.project === project.path && t.status === 'todo' && !isSomedayTask(t))
				.sort(compareTasks),
		}))
		.filter((g) => g.tasks.length > 0);
}

export interface HistoryGroup {
	/** Local ISO day. */
	day: string;
	entries: CompletionEntry[];
}

/** Completion-log entries grouped by local completion day, newest first. */
export function selectHistoryGroups(log: CompletionEntry[]): HistoryGroup[] {
	const byDay = new Map<string, CompletionEntry[]>();
	for (const entry of log) {
		const day = todayISO(new Date(entry.completedAt));
		const list = byDay.get(day) ?? [];
		list.push(entry);
		byDay.set(day, list);
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([day, entries]) => ({
			day,
			entries: entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
		}));
}

export interface AreaGroups {
	/** Active projects grouped by area, areas sorted by name. */
	areas: { name: string; projects: ProjectInfo[] }[];
	/** Active projects without an area. */
	standalone: ProjectInfo[];
	/** Someday projects, shown dimmed at the bottom. */
	someday: ProjectInfo[];
}

export function selectAreaGroups(projects: Record<string, ProjectInfo>): AreaGroups {
	const byName = (a: ProjectInfo, b: ProjectInfo) => a.name.localeCompare(b.name);
	const all = Object.values(projects);
	const active = all.filter((p) => p.status === 'active');
	const areaMap = new Map<string, ProjectInfo[]>();
	for (const p of active) {
		if (p.area === undefined) continue;
		const list = areaMap.get(p.area) ?? [];
		list.push(p);
		areaMap.set(p.area, list);
	}
	return {
		areas: [...areaMap.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, list]) => ({ name, projects: list.sort(byName) })),
		standalone: active.filter((p) => p.area === undefined).sort(byName),
		someday: all.filter((p) => p.status === 'someday').sort(byName),
	};
}

/** Fraction of a project's tasks completed, for the progress pie. 0 when empty. */
export function projectProgress(tasks: Record<string, Task>, projectPath: string): number {
	let done = 0;
	let open = 0;
	for (const t of Object.values(tasks)) {
		if (t.project !== projectPath) continue;
		if (t.status === 'done') done++;
		else if (t.status === 'todo') open++;
	}
	const total = done + open;
	return total === 0 ? 0 : done / total;
}

/** Task-level someday items of one project, shown dimmed at the bottom. */
export function selectProjectSomedayTasks(
	tasks: Record<string, Task>,
	projectPath: string,
): Task[] {
	return Object.values(tasks)
		.filter((t) => t.project === projectPath && t.status === 'todo' && t.someday === true)
		.sort(compareTasks);
}

/** Open tasks of one project grouped by heading, preserving file order. */
export function selectProjectGroups(
	tasks: Record<string, Task>,
	projectPath: string,
): { heading: string | undefined; tasks: Task[] }[] {
	const open = Object.values(tasks)
		.filter((t) => t.project === projectPath && t.status === 'todo' && t.someday !== true)
		.sort(compareTasks);
	const groups: { heading: string | undefined; tasks: Task[] }[] = [];
	for (const t of open) {
		const last = groups[groups.length - 1];
		if (last && last.heading === t.heading) last.tasks.push(t);
		else groups.push({ heading: t.heading, tasks: [t] });
	}
	return groups;
}

export function selectTasksByProject(tasks: Record<string, Task>): Map<string, Task[]> {
	const byProject = new Map<string, Task[]>();
	for (const t of Object.values(tasks)) {
		if (t.project === undefined) continue;
		const list = byProject.get(t.project) ?? [];
		list.push(t);
		byProject.set(t.project, list);
	}
	for (const list of byProject.values()) list.sort(compareTasks);
	return byProject;
}
