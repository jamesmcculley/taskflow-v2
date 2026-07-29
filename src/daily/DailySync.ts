import { Notice, TFile, moment, normalizePath } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { insertTaskBlock, splitLines } from '../mutations/blockEdits';
import type { CompletionEntry } from '../types';
import {
	extractJournalTaskId,
	formatCompletionLine,
	hasCompletionLine,
	removeCompletionLine,
} from './dailyLog';

interface DailyNotesOptions {
	folder?: string;
	format?: string;
}

/**
 * Mirrors completions into the day's daily note under a configurable heading.
 * Folder and filename format come from the Daily Notes core plugin so lines
 * land in the user's real journal.
 */
export class DailySync {
	constructor(private plugin: TaskFlowPlugin) {}

	private get enabled(): boolean {
		return this.plugin.persisted.settings.dailySync;
	}

	private get heading(): string {
		// Strip any leading #s the user typed into the setting — the heading
		// matcher/creator supplies its own markup.
		const raw = this.plugin.persisted.settings.dailySyncHeading;
		return raw.replace(/^#+\s*/, '').trim() || 'Completed';
	}

	private dailyNoteOptions(): Required<DailyNotesOptions> {
		const app = this.plugin.app as unknown as {
			internalPlugins?: {
				getPluginById?: (id: string) => { instance?: { options?: DailyNotesOptions } } | null;
			};
		};
		const options = app.internalPlugins?.getPluginById?.('daily-notes')?.instance?.options ?? {};
		return {
			folder: options.folder?.trim() ?? '',
			format: options.format?.trim() || 'YYYY-MM-DD',
		};
	}

	/** Vault path of the daily note for the local day of `completedAt`. */
	notePathFor(completedAt: string): string {
		const { folder, format } = this.dailyNoteOptions();
		// obsidian's bundled moment is callable despite the namespace typing.
		const momentFn = moment as unknown as (input: Date) => { format: (fmt: string) => string };
		const name = momentFn(new Date(completedAt)).format(format);
		return normalizePath(folder === '' ? `${name}.md` : `${folder}/${name}.md`);
	}

	private projectName(projectPath: string | undefined): string | undefined {
		if (projectPath === undefined) return undefined;
		return (
			this.plugin.store.getState().projects[projectPath]?.name ??
			projectPath.split('/').pop()?.replace(/\.md$/, '')
		);
	}

	/**
	 * Sourced from raw fields (not a live Task) so a historical completion —
	 * whose task line has since moved on, e.g. a recurring task's earlier
	 * occurrence, or one being date-corrected after the fact — can still be
	 * journaled correctly.
	 */
	async record(
		taskId: string,
		title: string,
		projectPath: string | undefined,
		completedAt: string,
	): Promise<void> {
		if (!this.enabled) return;
		const line = formatCompletionLine(taskId, title, this.projectName(projectPath), completedAt);
		await this.appendLine(this.notePathFor(completedAt), line);
	}

	async remove(entry: CompletionEntry): Promise<void> {
		// Not gated on the sync setting: a line written while sync was on
		// should still be cleaned up after the user turns sync off.
		const path = this.notePathFor(entry.completedAt);
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		await this.plugin.app.vault.process(file, (content) => {
			return removeCompletionLine(content, entry.taskId) ?? content;
		});
	}

	/** Ensures every 'done' entry from today's log has a line in today's note. */
	async backfillToday(): Promise<void> {
		const localDay = (iso: string) => {
			const d = new Date(iso);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		};
		const today = localDay(new Date().toISOString());
		const entries = this.plugin.persisted.log.filter(
			(e) => e.status === 'done' && localDay(e.completedAt) === today,
		);
		if (entries.length === 0) {
			new Notice('TaskFlow: no completions today.');
			return;
		}
		let added = 0;
		for (const entry of entries) {
			const line = formatCompletionLine(
				entry.taskId,
				entry.title,
				this.projectName(entry.project),
				entry.completedAt,
			);
			const appended = await this.appendLine(this.notePathFor(entry.completedAt), line, true);
			if (appended) added++;
		}
		new Notice(`TaskFlow: synced ${added} completion${added === 1 ? '' : 's'} to the daily note.`);
	}

	/**
	 * One-time repair for drift that accumulated before every code path that
	 * removes a completion also learned to remove its journal line (fixed
	 * for reconcilePersisted's pruning and removeLogEntry, but that only
	 * prevents new drift — this cleans up whatever's already sitting in the
	 * vault from before the fix). Scans every note for lines in TaskFlow's
	 * own journal shape and removes any whose taskId has no 'done' entry
	 * anywhere in the log. Coarse by design: checking "does this taskId have
	 * a completion at all" rather than matching the entry's exact day, since
	 * reverse-parsing an arbitrary daily-note date format back out of a
	 * filename isn't reliable — good enough for the common case (a task
	 * isn't usually completed, uncompleted, and recompleted across
	 * different days for the same non-recurring line).
	 */
	async cleanOrphanedJournalLines(): Promise<void> {
		const loggedTaskIds = new Set(
			this.plugin.persisted.log.filter((e) => e.status === 'done').map((e) => e.taskId),
		);
		let removedCount = 0;
		let filesTouched = 0;
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const snapshot = await this.plugin.app.vault.cachedRead(file);
			if (!snapshot.includes('%%')) continue; // cheap pre-filter; real check runs on fresh content below
			let fileRemoved = 0;
			await this.plugin.app.vault.process(file, (content) => {
				const { lines, sep } = splitLines(content);
				const kept = lines.filter((line: string) => {
					const taskId = extractJournalTaskId(line);
					if (taskId === undefined || loggedTaskIds.has(taskId)) return true;
					fileRemoved++;
					return false;
				});
				return fileRemoved > 0 ? kept.join(sep) : content;
			});
			if (fileRemoved > 0) {
				removedCount += fileRemoved;
				filesTouched++;
			}
		}
		new Notice(
			removedCount > 0
				? `TaskFlow: removed ${removedCount} orphaned journal line${removedCount === 1 ? '' : 's'} across ${filesTouched} note${filesTouched === 1 ? '' : 's'}.`
				: 'TaskFlow: no orphaned journal lines found — daily notes already match History.',
		);
	}

	private async appendLine(path: string, line: string, skipIfPresent = false): Promise<boolean> {
		const file = await this.ensureNote(path);
		let appended = false;
		await this.plugin.app.vault.process(file, (content) => {
			if (skipIfPresent && hasCompletionLine(content, line)) return content;
			appended = true;
			// A journal line is a single plain list item, not a task block —
			// insertTaskBlock just places it under the right heading.
			return insertTaskBlock(content, [line], this.heading);
		});
		return appended;
	}

	private async ensureNote(path: string): Promise<TFile> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		// Create folders level by level — nested daily-note formats like
		// YYYY/MM/YYYY-MM-DD need every intermediate directory.
		const parts = path.split('/').slice(0, -1);
		let current = '';
		for (const part of parts) {
			current = current === '' ? part : `${current}/${part}`;
			if (this.plugin.app.vault.getAbstractFileByPath(current) === null) {
				try {
					await this.plugin.app.vault.createFolder(current);
				} catch {
					// Folder may have been created concurrently.
				}
			}
		}
		return this.plugin.app.vault.create(path, '');
	}
}
