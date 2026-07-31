import { isWithin, narrowerKeysWithin, periodDateRangeLabel, periodLabel, periodRange } from './period';
import { selectInboxTasks, selectTodayGroups } from './selectors';
import type { CompletionEntry, PeriodNote, ProjectInfo, Task } from '../types';

/**
 * The review looks two ways over one period: back at what was finished, and
 * forward at what should be true by the end of the next one.
 *
 * Looking back is assembled from the completion log rather than from live
 * tasks, because a task that was completed and then edited, moved, or deleted
 * still happened. Completions group by area first and project second — the
 * shape you think in when accounting for a stretch of work, and the shape that
 * survives being read months later, when "what did I actually do in July" is a
 * question you can no longer answer from memory.
 *
 * Highlights are the load-bearing idea. Starring a completion costs one click
 * in the week you did it, and a starred item rolls up: the month's review shows
 * its weeks' highlights, the quarter's shows its months' and weeks'. So the long
 * look-back is assembled continuously instead of reconstructed from nothing at
 * the end, which is the part everyone gets wrong.
 */

export interface ProjectCompletions {
	/** Project note path; undefined for tasks that had no project. */
	path?: string;
	name: string;
	entries: CompletionEntry[];
}

export interface AreaCompletions {
	/** Area name; undefined for projects with no area, and for unfiled work. */
	area?: string;
	projects: ProjectCompletions[];
	total: number;
}

const UNFILED = 'Unfiled';

/** Completions inside a period, newest first. */
export function selectPeriodCompletions(
	log: readonly CompletionEntry[],
	key: string,
): CompletionEntry[] {
	const range = periodRange(key);
	if (!range) return [];
	return log
		.filter((e) => e.status === 'done' && isWithin(e.completedAt.slice(0, 10), range))
		.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

/** Groups completions by area, then project, both alphabetically. */
export function groupCompletionsByArea(
	entries: readonly CompletionEntry[],
	projects: Record<string, ProjectInfo>,
): AreaCompletions[] {
	const byArea = new Map<string, Map<string, ProjectCompletions>>();
	for (const entry of entries) {
		const project = entry.project === undefined ? undefined : projects[entry.project];
		const areaKey = project?.area ?? UNFILED;
		const projectKey = entry.project ?? UNFILED;
		const areaBucket = byArea.get(areaKey) ?? new Map<string, ProjectCompletions>();
		const bucket = areaBucket.get(projectKey) ?? {
			path: entry.project,
			name: project?.name ?? entry.project?.split('/').pop()?.replace(/\.md$/, '') ?? UNFILED,
			entries: [],
		};
		bucket.entries.push(entry);
		areaBucket.set(projectKey, bucket);
		byArea.set(areaKey, areaBucket);
	}
	return [...byArea.entries()]
		.map(([area, projectMap]) => ({
			area: area === UNFILED ? undefined : area,
			projects: [...projectMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
			total: [...projectMap.values()].reduce((n, p) => n + p.entries.length, 0),
		}))
		// Unfiled work sorts last: it's the least likely to be worth writing up.
		.sort((a, b) =>
			a.area === undefined ? 1 : b.area === undefined ? -1 : a.area.localeCompare(b.area),
		);
}

export interface RolledHighlight {
	/** The shorter period this came from, e.g. `2026-W31`. */
	fromKey: string;
	entry: CompletionEntry;
}

/**
 * Highlights starred in shorter periods overlapping this one — a quarter's view
 * of the weeks and months inside it. Deduplicated by task: starring the same
 * completion in both its week and its month shouldn't list it twice.
 */
export function selectRolledHighlights(
	key: string,
	reviews: Record<string, PeriodNote>,
	log: readonly CompletionEntry[],
): RolledHighlight[] {
	const byTask = new Map<string, CompletionEntry>();
	for (const entry of log) {
		if (entry.status !== 'done') continue;
		const existing = byTask.get(entry.taskId);
		if (!existing || entry.completedAt > existing.completedAt) byTask.set(entry.taskId, entry);
	}
	const out: RolledHighlight[] = [];
	const seen = new Set<string>();
	for (const fromKey of narrowerKeysWithin(key, Object.keys(reviews))) {
		for (const taskId of reviews[fromKey]?.highlights ?? []) {
			if (seen.has(taskId)) continue;
			const entry = byTask.get(taskId);
			if (!entry) continue;
			seen.add(taskId);
			out.push({ fromKey, entry });
		}
	}
	return out;
}

/** Open threads worth a glance before closing out a period. */
export interface LooseEnds {
	overdue: number;
	inbox: number;
}

export function selectLooseEnds(tasks: Record<string, Task>, today: string): LooseEnds {
	return {
		overdue: selectTodayGroups(tasks, today).overdue.length,
		inbox: selectInboxTasks(tasks).length,
	};
}

export interface ReviewNoteInput {
	key: string;
	note: PeriodNote;
	completions: readonly CompletionEntry[];
	grouped: readonly AreaCompletions[];
	rolled: readonly RolledHighlight[];
	projects: Record<string, ProjectInfo>;
}

/**
 * Renders the review as a markdown note.
 *
 * Deliberately plain: headings a person would write, no plugin syntax, nothing
 * that needs TaskFlow installed to read. The point is that this file can be
 * copied somewhere else wholesale — it is the artefact, not a view of one.
 */
export function buildReviewNote(input: ReviewNoteInput): string {
	const { key, note, completions, grouped, rolled, projects } = input;
	const nameOf = (path?: string) =>
		path === undefined
			? undefined
			: (projects[path]?.name ?? path.split('/').pop()?.replace(/\.md$/, ''));
	const bullet = (entry: CompletionEntry) => {
		const where = nameOf(entry.project);
		return `- ${entry.title}${where === undefined ? '' : ` — ${where}`}`;
	};

	const lines: string[] = [`# Review — ${periodLabel(key)}`, '', `*${periodDateRangeLabel(key)}*`, ''];

	const highlightEntries = note.highlights
		.map((id) => completions.find((e) => e.taskId === id))
		.filter((e): e is CompletionEntry => e !== undefined);

	if (highlightEntries.length > 0 || rolled.length > 0) {
		lines.push('## Highlights', '');
		for (const entry of highlightEntries) lines.push(bullet(entry));
		// Rolled-up items are labelled by where they came from, so a quarter
		// reads as a record of when things landed, not one undated heap.
		for (const { fromKey, entry } of rolled) lines.push(`${bullet(entry)} *(${periodLabel(fromKey)})*`);
		lines.push('');
	}

	if (grouped.length > 0) {
		lines.push('## By area', '');
		for (const area of grouped) {
			lines.push(`### ${area.area ?? UNFILED} — ${area.total} completed`, '');
			for (const project of area.projects) {
				lines.push(`**${project.name}** — ${project.entries.length}`, '');
				for (const entry of project.entries) lines.push(`- ${entry.title}`);
				lines.push('');
			}
		}
	}

	if (note.focus !== undefined && note.focus.trim() !== '') {
		lines.push('## Looking ahead', '', note.focus.trim(), '');
	}
	if (note.narrative !== undefined && note.narrative.trim() !== '') {
		lines.push('## Notes', '', note.narrative.trim(), '');
	}
	if (completions.length === 0 && rolled.length === 0) {
		lines.push('_No completions recorded for this period._', '');
	}
	return lines.join('\n');
}

/** Vault path for a period's review note. */
export function reviewNotePath(key: string, folder: string): string {
	const clean = folder.replace(/^\/+|\/+$/g, '').trim();
	const name = `Review ${key}.md`;
	return clean === '' ? name : `${clean}/${name}`;
}
