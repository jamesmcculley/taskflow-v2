import { describe, expect, it } from 'vitest';
import { applyIdAssignments, generateTaskId, stripTrailingIds } from '../src/indexer/ids';
import type { IdAssignment } from '../src/indexer/ids';
import { parseHeadline, parseTaskAt } from '../src/org/parser';

/**
 * The duplicate-ID bug: a task or checklist item ending up with two `^t-xxxxxx`
 * refs on one line.
 *
 * indexFile queues ID writes without awaiting them, so two index passes could
 * both read a file whose lines had no IDs, both decide the same line needed
 * one, and both write. The headline path re-checked the line inside the write
 * and skipped; the checklist path appended unconditionally. Line numbers can
 * also shift under a pending plan when a sibling write-back inserts a line.
 *
 * Each test here runs two *independently planned* assignments over the same
 * starting lines — exactly what the race produced.
 */
describe('applyIdAssignments', () => {
	const secondPassOf = (line: number): IdAssignment[] => [{ line, id: 't-second' }];

	it('does not append a second ID to a checklist item (the reported bug)', () => {
		const lines = ['- TODO Parent ^t-parent', '\t- [ ] Child'];
		applyIdAssignments(lines, [{ line: 1, id: 't-first' }], 'blockref');
		expect(lines[1]).toBe('\t- [ ] Child ^t-first');

		// Second pass planned from the pre-write content.
		applyIdAssignments(lines, secondPassOf(1), 'blockref');
		expect(lines[1]).toBe('\t- [ ] Child ^t-first');
		expect(lines[1]?.match(/\^t-/g)).toHaveLength(1);
	});

	it('does not append a second ID to a task headline', () => {
		const lines = ['- TODO Buy milk'];
		applyIdAssignments(lines, [{ line: 0, id: 't-first' }], 'blockref');
		expect(lines[0]).toBe('- TODO Buy milk ^t-first');

		applyIdAssignments(lines, secondPassOf(0), 'blockref');
		expect(lines[0]?.match(/\^t-/g)).toHaveLength(1);
	});

	it('reassigns a duplicated checklist ID, but only the one it planned to replace', () => {
		const lines = ['- TODO Parent ^t-parent', '\t- [ ] Child ^t-dupe'];
		applyIdAssignments(lines, [{ line: 1, id: 't-fresh', replaces: 't-dupe' }], 'blockref');
		expect(lines[1]).toBe('\t- [ ] Child ^t-fresh');

		// Replaying the same stale plan must not touch the now-correct line.
		applyIdAssignments(lines, [{ line: 1, id: 't-other', replaces: 't-dupe' }], 'blockref');
		expect(lines[1]).toBe('\t- [ ] Child ^t-fresh');
	});

	it('skips a line that is no longer a task or checkbox (line numbers shifted)', () => {
		// A CLOSED backfill inserted a line, so the plan's index now points at
		// the planning line rather than the checkbox it was computed for.
		const lines = ['- DONE Parent ^t-parent', '  CLOSED: [2026-07-30 Thu 09:00]', '\t- [ ] Child'];
		applyIdAssignments(lines, [{ line: 1, id: 't-stray' }], 'blockref');
		expect(lines[1]).toBe('  CLOSED: [2026-07-30 Thu 09:00]');
		expect(lines.join('\n')).not.toContain('t-stray');
	});

	it('applies bottom-up so growing one block cannot shift the lines below it', () => {
		const lines = ['- TODO First', '- TODO Second'];
		applyIdAssignments(
			lines,
			[
				{ line: 0, id: 't-aaaaaa' },
				{ line: 1, id: 't-bbbbbb' },
			],
			'blockref',
		);
		expect(lines[0]).toBe('- TODO First ^t-aaaaaa');
		expect(lines[1]).toBe('- TODO Second ^t-bbbbbb');
	});
});

describe('parsing already-damaged lines', () => {
	it('keeps the last ID and drops the stray one from the title', () => {
		const parsed = parseHeadline('- TODO Buy milk ^t-aaaaaa ^t-bbbbbb');
		expect(parsed?.title).toBe('Buy milk');
		expect(parsed?.blockId).toBe('t-bbbbbb');
	});

	it('re-emits a damaged headline with exactly one ID', () => {
		const lines = ['- TODO Buy milk ^t-aaaaaa ^t-bbbbbb'];
		// Any write re-emits from the parsed block, so the repair rides along.
		applyIdAssignments(lines, [{ line: 0, id: 't-ignored' }], 'blockref');
		expect(lines[0]).toBe('- TODO Buy milk ^t-bbbbbb');
		expect(lines[0]?.match(/\^t-/g)).toHaveLength(1);
	});

	it('still parses the block around a damaged headline', () => {
		const lines = ['- TODO Ship it ^t-aaaaaa ^t-bbbbbb', '  SCHEDULED: <2026-07-30 Thu>'];
		const org = parseTaskAt(lines, 0);
		expect(org?.blockId).toBe('t-bbbbbb');
		expect(org?.title).toBe('Ship it');
		expect(org?.scheduled?.date).toBe('2026-07-30');
	});

	it('leaves a single ID alone', () => {
		expect(stripTrailingIds('Child ^t-aaaaaa')).toEqual({ rest: 'Child', ids: ['t-aaaaaa'] });
		expect(stripTrailingIds('Child')).toEqual({ rest: 'Child', ids: [] });
	});
});

describe('generateTaskId', () => {
	it('avoids ids already in use', () => {
		const taken = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const id = generateTaskId(taken);
			expect(taken.has(id)).toBe(false);
			expect(id).toMatch(/^t-[0-9a-z]{6}$/);
			taken.add(id);
		}
	});
});
