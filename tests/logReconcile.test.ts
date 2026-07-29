import { describe, expect, it } from 'vitest';
import { findStampDrift, findUnloggedCompletions, reconcileLog } from '../src/store/logReconcile';
import type { ExternalCompletionCandidate } from '../src/store/logReconcile';
import type { CompletionEntry, Task } from '../src/types';

function task(over: Partial<Task>): Task {
	return {
		id: 't-a',
		title: 'Test',
		file: 'Inbox.md',
		line: 0,
		keyword: 'TODO',
		status: 'todo',
		tags: [],
		order: 0,
		blockEnd: 0,
		...over,
	};
}

function entry(over: Partial<CompletionEntry>): CompletionEntry {
	return {
		taskId: 't-a',
		title: 'Test',
		status: 'done',
		completedAt: '2026-07-19T01:23:01.581Z',
		...over,
	};
}

describe('reconcileLog', () => {
	it('drops all entries for a non-recurring task that is open in markdown', () => {
		const log = [
			entry({ completedAt: '2026-07-19T01:23:01.581Z' }),
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'todo' })])).toEqual([]);
	});

	it('keeps only the latest entry for a closed non-recurring task', () => {
		const log = [
			entry({ completedAt: '2026-07-19T01:23:01.581Z' }),
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'done' })])).toEqual([
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		]);
	});

	it('keeps every entry for repeating tasks, even when open', () => {
		const log = [
			entry({ completedAt: '2026-07-12T09:00:00.000Z' }),
			entry({ completedAt: '2026-07-19T09:00:00.000Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'todo', repeater: '++1w' })])).toBeNull();
	});

	it('leaves entries of other tasks (incl. orphans) untouched', () => {
		const log = [entry({ taskId: 't-gone' }), entry({ taskId: 't-a' })];
		expect(reconcileLog(log, [task({ status: 'todo' })])).toEqual([
			entry({ taskId: 't-gone' }),
		]);
	});

	it('returns null when nothing changes', () => {
		expect(reconcileLog([entry({})], [task({ status: 'done' })])).toBeNull();
		expect(reconcileLog([], [task({ status: 'todo' })])).toBeNull();
	});

	it('handles cancelled like done', () => {
		const log = [
			entry({ status: 'cancelled', completedAt: '2026-07-18T00:00:00.000Z' }),
			entry({ status: 'cancelled', completedAt: '2026-07-19T00:00:00.000Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'cancelled' })])).toEqual([
			entry({ status: 'cancelled', completedAt: '2026-07-19T00:00:00.000Z' }),
		]);
	});
});

function candidate(over: Partial<ExternalCompletionCandidate>): ExternalCompletionCandidate {
	return { taskId: 't-a', title: 'Test', status: 'done', ...over };
}

describe('findUnloggedCompletions', () => {
	it('flags a done task with no matching log entry — the native-checkbox-click case', () => {
		// Reproduces the exact real-vault bug: checked off via Obsidian's own
		// checkbox (not the plugin), so nothing ever logged it.
		expect(findUnloggedCompletions([], [candidate({})])).toEqual([candidate({})]);
	});

	it('does not re-flag a completion the plugin already logged', () => {
		const log = [entry({})];
		expect(findUnloggedCompletions(log, [candidate({})])).toEqual([]);
	});

	it('distinguishes done from cancelled — a cancel entry does not cover a done candidate', () => {
		const log = [entry({ status: 'cancelled' })];
		expect(findUnloggedCompletions(log, [candidate({ status: 'done' })])).toEqual([
			candidate({ status: 'done' }),
		]);
	});

	it('matches by taskId + status, not just taskId — recurring tasks reuse one ID across many entries', () => {
		const log = [entry({ status: 'done', completedAt: '2026-07-01T12:00:00.000Z' })];
		expect(findUnloggedCompletions(log, [candidate({ status: 'done' })])).toEqual([]);
		expect(findUnloggedCompletions(log, [candidate({ status: 'cancelled' })])).toEqual([
			candidate({ status: 'cancelled' }),
		]);
	});

	it('carries the stamp date through untouched for later use', () => {
		const [result] = findUnloggedCompletions([], [candidate({ stampDate: '2026-07-15' })]);
		expect(result?.stampDate).toBe('2026-07-15');
	});
});

describe('findStampDrift', () => {
	it('flags a logged completion whose stamp was hand-edited afterward', () => {
		const log = [entry({ completedAt: '2026-07-19T12:00:00.000Z' })]; // day 07-19
		const drift = findStampDrift(log, [candidate({ stampDate: '2026-07-15' })]);
		expect(drift).toEqual([
			{ taskId: 't-a', oldCompletedAt: '2026-07-19T12:00:00.000Z', newDateISO: '2026-07-15' },
		]);
	});

	it('does nothing when the stamp already matches the logged day', () => {
		const log = [entry({ completedAt: '2026-07-19T12:00:00.000Z' })];
		expect(findStampDrift(log, [candidate({ stampDate: '2026-07-19' })])).toEqual([]);
	});

	it('ignores candidates with no stamp or with cancelled status (no ✅ date to compare)', () => {
		const log = [entry({ completedAt: '2026-07-19T12:00:00.000Z' })];
		expect(findStampDrift(log, [candidate({ stampDate: undefined })])).toEqual([]);
		expect(
			findStampDrift(log, [candidate({ status: 'cancelled', stampDate: '2026-07-15' })]),
		).toEqual([]);
	});

	it('skips ambiguous cases: more than one done entry for the same task (recurring history)', () => {
		const log = [
			entry({ completedAt: '2026-07-12T12:00:00.000Z' }),
			entry({ completedAt: '2026-07-19T12:00:00.000Z' }),
		];
		expect(findStampDrift(log, [candidate({ stampDate: '2026-07-15' })])).toEqual([]);
	});

	it('does nothing for an unlogged candidate (no entry to drift from)', () => {
		expect(findStampDrift([], [candidate({ stampDate: '2026-07-15' })])).toEqual([]);
	});
});
