import { isTaskHeadline } from '../org/parser';
import { editTaskBlock } from '../org/serialize';
import type { IdStyle } from '../org/serialize';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Generates a stable task ID of the form `t-xxxxxx` (6 chars base36). */
export function generateTaskId(existing?: ReadonlySet<string>): string {
	for (;;) {
		const bytes = new Uint8Array(6);
		globalThis.crypto.getRandomValues(bytes);
		let id = 't-';
		for (const b of bytes) id += ALPHABET[b % 36];
		if (!existing?.has(id)) return id;
	}
}

export const CHECKLIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;
export const CHECKLIST_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

/** One planned ID write: `replaces` is set when reassigning a duplicate. */
export interface IdAssignment {
	line: number;
	id: string;
	replaces?: string;
}

/**
 * Applies planned ID writes to `lines`, in place.
 *
 * Every branch re-checks the line as it stands *now* rather than trusting the
 * parse that produced the plan. indexFile fires this without awaiting it, so a
 * second index pass can read the file, decide the same line still needs an ID,
 * and queue a second write before the first one lands — and line numbers can
 * shift underneath a plan when a sibling write-back (a CLOSED backfill) inserts
 * a line. Without the re-checks the second write appended a *second* `^id` to a
 * line that already had one, which is the duplicate-ID bug.
 *
 * Bottom-up, so an edit that grows a block can't invalidate the lines below it.
 */
export function applyIdAssignments(
	lines: string[],
	missing: readonly IdAssignment[],
	idStyle: IdStyle,
): void {
	for (const { line, id, replaces } of [...missing].sort((a, b) => b.line - a.line)) {
		const raw = lines[line];
		if (raw === undefined) continue;

		if (isTaskHeadline(raw)) {
			editTaskBlock(lines, line, idStyle, (task) => {
				// Already carries an ID that isn't the one we set out to replace:
				// another pass got here first, so leave it alone.
				if (task.blockId === undefined || task.blockId === replaces) task.blockId = id;
			});
			continue;
		}

		// Not a headline and not a checkbox either — the line moved or was
		// rewritten since it was parsed. Writing an ID onto whatever is here now
		// would brand an unrelated line, so skip and let the resulting 'changed'
		// event re-index and retry.
		if (!CHECKLIST_RE.test(raw)) continue;

		const existing = CHECKLIST_ID_RE.exec(raw);
		if (existing === null) {
			// Only append when nothing was supposed to be there. A plan that meant
			// to *replace* an ID has nothing to replace, so it's stale.
			if (replaces === undefined) lines[line] = raw.replace(/\s*$/, '') + ` ^${id}`;
		} else if (existing[1] === replaces) {
			lines[line] = raw.replace(CHECKLIST_ID_RE, ` ^${id}`);
		}
		// else: the line already has an ID nobody asked to replace — another pass
		// won the race. Appending here is exactly what produced `^aaa ^bbb`.
	}
}

/**
 * Strips every trailing `^id` from a line's tail, returning the ids in the
 * order they appear. Repeated ids only exist as damage from the duplicate-ID
 * bug; parsing them all is what lets a damaged line be rewritten with one.
 */
export function stripTrailingIds(text: string): { rest: string; ids: string[] } {
	let rest = text;
	const ids: string[] = [];
	for (;;) {
		const m = CHECKLIST_ID_RE.exec(rest);
		if (!m) break;
		ids.unshift(m[1] ?? '');
		rest = rest.slice(0, m.index);
	}
	return { rest, ids };
}
