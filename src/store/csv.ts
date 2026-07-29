import { todayISO } from './selectors';
import type { CompletionEntry, ProjectInfo } from '../types';

function escapeCell(value: string): string {
	// Neutralize spreadsheet formula injection: Excel/Sheets execute cells
	// starting with = + - @, and task titles are arbitrary vault content.
	const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
}

/** History log as CSV, newest-last (log order). */
export function buildHistoryCsv(
	log: CompletionEntry[],
	projects: Record<string, ProjectInfo>,
): string {
	const projectName = (path?: string) =>
		path === undefined
			? ''
			: (projects[path]?.name ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path);
	const rows = [
		'completedAt,day,status,title,project',
		...log.map((e) =>
			[
				e.completedAt,
				todayISO(new Date(e.completedAt)),
				e.status,
				escapeCell(e.title),
				escapeCell(projectName(e.project)),
			].join(','),
		),
	];
	return rows.join('\n') + '\n';
}
