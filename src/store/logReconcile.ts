import { todayISO } from './selectors';
import type { CompletionEntry, Task } from '../types';

/**
 * Markdown is the source of truth for task status, so the History must follow
 * it: a non-repeating task that is open in markdown has no business in the log
 * (its completion was undone outside the plugin — e.g. DONE was edited back to
 * TODO in the note), and a closed one keeps only its most recent entry.
 * Repeating tasks are exempt: their headlines go back to TODO on completion and
 * the log is the only history of past occurrences.
 * Returns the pruned log, or null if nothing changed.
 */
export function reconcileLog(log: CompletionEntry[], tasks: Task[]): CompletionEntry[] | null {
	const drop = new Set<CompletionEntry>();
	for (const task of tasks) {
		if (task.repeater !== undefined || task.properties?.REPEAT !== undefined) continue;
		const entries = log.filter((e) => e.taskId === task.id);
		if (entries.length === 0) continue;
		const keep =
			task.status === 'todo'
				? null
				: entries.reduce((a, b) => (a.completedAt >= b.completedAt ? a : b));
		for (const e of entries) {
			if (e !== keep) drop.add(e);
		}
	}
	if (drop.size === 0) return null;
	return log.filter((e) => !drop.has(e));
}

/** A done/cancelled task line found during indexing, candidate for auto-logging. */
export interface ExternalCompletionCandidate {
	taskId: string;
	title: string;
	project?: string;
	status: 'done' | 'cancelled';
	/** ISO date from the line's own ✅ stamp, if it already has one (done only). */
	stampDate?: string;
}

/**
 * Finds done/cancelled tasks with no matching History entry yet — completed
 * by some means other than the plugin's own actions (Obsidian's native
 * checkbox, hand-typing `[x]`, an externally synced change), so nothing ever
 * logged them. Every candidate returned needs a completion recorded for it.
 */
export function findUnloggedCompletions(
	log: CompletionEntry[],
	candidates: ExternalCompletionCandidate[],
): ExternalCompletionCandidate[] {
	return candidates.filter((c) => !log.some((e) => e.taskId === c.taskId && e.status === c.status));
}

export interface StampDrift {
	taskId: string;
	oldCompletedAt: string;
	newDateISO: string;
}

/**
 * Finds already-logged 'done' completions whose local day no longer matches
 * the task's current ✅ stamp — the user hand-edited the date directly in
 * markdown after it was already logged. Markdown wins: History, Stats, and
 * the daily journal should follow. Skipped when a task has more than one
 * 'done' entry (recurring tasks accumulate one per past occurrence) since
 * it's ambiguous which entry the line's single stamp corresponds to — the
 * per-entry "Edit date…" action handles that disambiguated case instead.
 */
export function findStampDrift(
	log: CompletionEntry[],
	candidates: ExternalCompletionCandidate[],
): StampDrift[] {
	const drift: StampDrift[] = [];
	for (const c of candidates) {
		if (c.status !== 'done' || c.stampDate === undefined) continue;
		const entries = log.filter((e) => e.taskId === c.taskId && e.status === 'done');
		if (entries.length !== 1) continue;
		const entry = entries[0]!;
		if (todayISO(new Date(entry.completedAt)) !== c.stampDate) {
			drift.push({ taskId: c.taskId, oldCompletedAt: entry.completedAt, newDateISO: c.stampDate });
		}
	}
	return drift;
}
