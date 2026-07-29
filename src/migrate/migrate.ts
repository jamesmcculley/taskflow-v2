import { Notice, TFile, normalizePath } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { isExcludedPath, isTaskflowDisabled } from '../indexer/indexer';
import { convertContent } from './convert';
import type { ConvertedTask } from './convert';

export interface FileReport {
	path: string;
	tasks: ConvertedTask[];
	checklistItemsKept: number;
}

export interface MigrationReport {
	files: FileReport[];
	taskCount: number;
	checklistItemsKept: number;
	/** Tasks whose 🔁 text needed the `:REPEAT:` rrule fallback. */
	fallbackRules: { path: string; title: string; rule: string }[];
	/** Vault-relative folder the backups went to; absent on a dry run. */
	backupFolder?: string;
	skipped: { path: string; reason: string }[];
}

function stamp(now: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Rewrites v1 emoji task lines into v2 org blocks across the vault.
 *
 * Always runs in two phases: `plan()` reads every file and reports exactly what
 * would change without writing anything, and `apply()` re-runs that conversion
 * and writes it — after copying each touched file into a timestamped backup
 * folder inside the vault. Backups are copies, not moves, so a failed run
 * leaves the originals in place too.
 *
 * Task IDs survive the rewrite untouched, which is what lets the existing
 * `data.json` (manual sort order, completion log, completion timestamps) keep
 * pointing at the right tasks — nothing about the index needs migrating.
 */
export class Migrator {
	constructor(private plugin: TaskFlowPlugin) {}

	/** Reads the vault and reports what a migration would do. Writes nothing. */
	async plan(): Promise<MigrationReport> {
		return this.run(false);
	}

	/** Backs up and rewrites every file with v1 tasks in it. */
	async apply(): Promise<MigrationReport> {
		const report = await this.run(true);
		this.plugin.persisted.migratedAt = new Date().toISOString();
		await this.plugin.savePersisted();
		await this.plugin.rescan();
		return report;
	}

	private async run(write: boolean): Promise<MigrationReport> {
		const { app } = this.plugin;
		const idStyle = this.plugin.persisted.settings.idStyle;
		const backupFolder = normalizePath(`TaskFlow v1 backup ${stamp(new Date())}`);
		const report: MigrationReport = {
			files: [],
			taskCount: 0,
			checklistItemsKept: 0,
			fallbackRules: [],
			skipped: [],
		};

		let backupCreated = false;
		for (const file of app.vault.getMarkdownFiles()) {
			if (file.path.startsWith('TaskFlow v1 backup ')) continue;
			const cache = app.metadataCache.getFileCache(file);
			if (isExcludedPath(file.path, this.plugin.persisted.settings.excludedFolders)) {
				report.skipped.push({ path: file.path, reason: 'excluded folder' });
				continue;
			}
			if (isTaskflowDisabled(cache?.frontmatter)) {
				report.skipped.push({ path: file.path, reason: 'taskflow: false' });
				continue;
			}

			const original = await app.vault.read(file);
			const result = convertContent(original, idStyle);
			if (result.tasks.length === 0) continue;

			report.files.push({
				path: file.path,
				tasks: result.tasks,
				checklistItemsKept: result.checklistItemsKept,
			});
			report.taskCount += result.tasks.length;
			report.checklistItemsKept += result.checklistItemsKept;
			for (const task of result.tasks) {
				if (task.fallbackRule !== undefined) {
					report.fallbackRules.push({ path: file.path, title: task.title, rule: task.fallbackRule });
				}
			}

			if (!write) continue;
			if (!backupCreated) {
				await app.vault.createFolder(backupFolder);
				backupCreated = true;
			}
			await this.backup(backupFolder, file, original);
			// Re-convert inside process() so a concurrent edit between the read
			// above and the write here is converted too, never clobbered.
			await app.vault.process(file, (current) => convertContent(current, idStyle).content);
		}

		if (write && backupCreated) report.backupFolder = backupFolder;
		return report;
	}

	/** Copies one file into the backup folder, recreating its folder structure. */
	private async backup(root: string, file: TFile, content: string): Promise<void> {
		const { vault } = this.plugin.app;
		const dest = normalizePath(`${root}/${file.path}`);
		const parent = dest.slice(0, dest.lastIndexOf('/'));
		if (parent !== root && vault.getAbstractFileByPath(parent) === null) {
			// Nested folders have to exist before a file lands in them; a race
			// with another createFolder is harmless, so swallow that failure.
			await vault.createFolder(parent).catch(() => undefined);
		}
		const existing = vault.getAbstractFileByPath(dest);
		if (existing instanceof TFile) await vault.modify(existing, content);
		else await vault.create(dest, content);
	}
}

/** Renders a dry-run report as the markdown the preview modal and note show. */
export function formatReport(report: MigrationReport, applied: boolean): string {
	const lines: string[] = [];
	lines.push(applied ? '# TaskFlow v1 → v2 migration' : '# TaskFlow v1 → v2 migration (dry run)');
	lines.push('');
	lines.push(
		`**${report.taskCount}** task${report.taskCount === 1 ? '' : 's'} in **${report.files.length}** file${report.files.length === 1 ? '' : 's'} ${applied ? 'converted' : 'would be converted'}.`,
	);
	if (report.checklistItemsKept > 0) {
		lines.push(`${report.checklistItemsKept} nested checklist item(s) left as plain checkboxes.`);
	}
	if (report.backupFolder !== undefined) {
		lines.push(`Backups of every touched file: \`${report.backupFolder}/\``);
	}
	if (report.fallbackRules.length > 0) {
		lines.push('');
		lines.push('## Repeats kept as rrule text');
		lines.push('');
		lines.push('No org repeater expresses these, so they keep a `:REPEAT:` property instead:');
		lines.push('');
		for (const f of report.fallbackRules) {
			lines.push(`- \`${f.rule}\` — ${f.title} (${f.path})`);
		}
	}
	if (report.skipped.length > 0) {
		lines.push('');
		lines.push(`## Skipped (${report.skipped.length})`);
		lines.push('');
		for (const s of report.skipped) lines.push(`- ${s.path} — ${s.reason}`);
	}
	lines.push('');
	lines.push('## Changes');
	for (const file of report.files) {
		lines.push('');
		lines.push(`### ${file.path}`);
		lines.push('');
		for (const task of file.tasks) {
			lines.push('```diff');
			lines.push(`-${task.before}`);
			for (const after of task.after) lines.push(`+${after}`);
			lines.push('```');
		}
	}
	return lines.join('\n');
}

/** Writes the report to a note and opens it. */
export async function writeReportNote(
	plugin: TaskFlowPlugin,
	report: MigrationReport,
	applied: boolean,
): Promise<void> {
	const path = applied ? 'TaskFlow migration report.md' : 'TaskFlow migration dry run.md';
	const body = formatReport(report, applied);
	const existing = plugin.app.vault.getAbstractFileByPath(path);
	let file: TFile;
	if (existing instanceof TFile) {
		await plugin.app.vault.modify(existing, body);
		file = existing;
	} else {
		file = await plugin.app.vault.create(path, body);
	}
	await plugin.app.workspace.getLeaf(true).openFile(file);
	new Notice(`TaskFlow: ${applied ? 'migrated' : 'previewed'} ${report.taskCount} task(s) — see ${path}`);
}
