/**
 * Pure helpers for the daily-note completion journal. Lines are deliberately
 * NOT checkboxes so the indexer never picks them up as tasks, and each carries
 * a hidden `%%taskId%%` comment marker so uncompleting can remove it later.
 */

export function formatCompletionLine(
	taskId: string,
	title: string,
	projectName: string | undefined,
	completedAt: string,
): string {
	const d = new Date(completedAt);
	const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	const project = projectName !== undefined ? ` ([[${projectName}]])` : '';
	return `- ✅ ${time} ${title}${project} %%${taskId}%%`;
}

/** Removes the last journal line carrying the task's marker. Null if absent. */
export function removeCompletionLine(content: string, taskId: string): string | null {
	const marker = `%%${taskId}%%`;
	const lines = content.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i]?.includes(marker)) {
			lines.splice(i, 1);
			return lines.join('\n');
		}
	}
	return null;
}

export function hasCompletionLine(content: string, line: string): boolean {
	// Tolerate CRLF files: compare with trailing \r stripped.
	return content.split('\n').some((l) => (l.endsWith('\r') ? l.slice(0, -1) : l) === line);
}

// Matches TaskFlow's own journal-line shape specifically (bullet, ✅, time,
// …, trailing marker) rather than a bare `%%…%%`, which is Obsidian's own
// general-purpose comment syntax and could appear in a note for unrelated
// reasons — a loose match would risk deleting someone else's comment.
const JOURNAL_LINE_RE = /^-\s+✅\s+\d{2}:\d{2}\s+.*%%([^%]+)%%\s*$/u;

/** The taskId marker on a journal line, if it's one of ours. */
export function extractJournalTaskId(line: string): string | undefined {
	const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
	return JOURNAL_LINE_RE.exec(trimmed)?.[1];
}
