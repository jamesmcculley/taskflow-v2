import type { TaskStatus } from '../types';

/**
 * The TODO keyword set, in org's own `#+TODO:` order — active keywords first,
 * then the `|` separator, then the done-type ones.
 *
 * Org lets each file redefine this; TaskFlow fixes the vocabulary instead so
 * every view has a stable meaning for "open" and "finished". A keyword the
 * plugin doesn't know is still indexed (as TODO) rather than dropped, matching
 * v1's rule that unknown checkbox chars never make a task disappear.
 */
export const TODO_KEYWORDS = ['TODO', 'NEXT', 'WAITING', 'SOMEDAY'] as const;
export const DONE_KEYWORDS = ['DONE', 'CANCELLED'] as const;

export type TodoKeyword = (typeof TODO_KEYWORDS)[number];
export type DoneKeyword = (typeof DONE_KEYWORDS)[number];
export type OrgKeyword = TodoKeyword | DoneKeyword;

export const ALL_KEYWORDS: readonly OrgKeyword[] = [...TODO_KEYWORDS, ...DONE_KEYWORDS];

const KEYWORD_SET = new Set<string>(ALL_KEYWORDS);

export function isOrgKeyword(word: string): word is OrgKeyword {
	return KEYWORD_SET.has(word);
}

export function isDoneKeyword(keyword: OrgKeyword): boolean {
	return keyword === 'DONE' || keyword === 'CANCELLED';
}

/**
 * The coarse status the whole app filters on. WAITING and SOMEDAY are open
 * work, so they stay 'todo' — the distinction lives in `keyword` and drives
 * the NEXT/Waiting agenda views, not the done/not-done split.
 */
export function statusOf(keyword: OrgKeyword): TaskStatus {
	if (keyword === 'DONE') return 'done';
	if (keyword === 'CANCELLED') return 'cancelled';
	return 'todo';
}

/**
 * The keyword to write when a status changes without one being named — used by
 * completing, cancelling, and unticking. Reopening lands on TODO: the keyword a
 * task carried before it was finished isn't recoverable from the line alone.
 */
export function keywordForStatus(status: TaskStatus): OrgKeyword {
	if (status === 'done') return 'DONE';
	if (status === 'cancelled') return 'CANCELLED';
	return 'TODO';
}

/** Org priority cookies. `[#A]` is the most urgent; absent means unprioritized. */
export const PRIORITIES = ['A', 'B', 'C'] as const;
export type OrgPriority = (typeof PRIORITIES)[number];

export function isOrgPriority(value: string): value is OrgPriority {
	return value === 'A' || value === 'B' || value === 'C';
}

/** Priority as a sort rank: A=1 … C=3, matching v1's `priority` numbering. */
export function priorityRank(priority: OrgPriority | undefined): 1 | 2 | 3 | undefined {
	if (priority === 'A') return 1;
	if (priority === 'B') return 2;
	if (priority === 'C') return 3;
	return undefined;
}

export function priorityFromRank(rank: 1 | 2 | 3 | undefined): OrgPriority | undefined {
	if (rank === 1) return 'A';
	if (rank === 2) return 'B';
	if (rank === 3) return 'C';
	return undefined;
}
