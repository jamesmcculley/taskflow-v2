import { TFile } from 'obsidian';
import type { CachedMetadata, HeadingCache } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { splitLines } from '../mutations/blockEdits';
import { priorityRank, statusOf } from '../org/keywords';
import { REPEAT_PROPERTY, SOMEDAY_TAG, TONIGHT_TAG } from '../org/tags';
import { isTaskHeadline, parseTaskAt } from '../org/parser';
import type { OrgTask } from '../org/parser';
import { editTaskBlock } from '../org/serialize';
import { inactiveStamp } from '../org/timestamp';
import { findStampDrift, findUnloggedCompletions, reconcileLog } from '../store/logReconcile';
import type { ExternalCompletionCandidate, StampDrift } from '../store/logReconcile';
import { todayISO } from '../store/selectors';
import type { ChecklistItem, ProjectInfo, ProjectStatus, Task } from '../types';
import { own } from '../utils';
import { generateTaskId } from './ids';

const DEBOUNCE_MS = 250;


/** True when `path` is inside any of the configured excluded folders. */
export function isExcludedPath(path: string, folders: string[]): boolean {
	for (const raw of folders) {
		const folder = raw.trim().replace(/^\/+|\/+$/g, '');
		if (folder === '') continue;
		if (path === folder || path.startsWith(`${folder}/`)) return true;
	}
	return false;
}

/**
 * True when frontmatter opts the whole note out (`taskflow: false`). Accepts
 * the boolean and the string forms alike — Obsidian's property UI quotes
 * values typed into a "Text" field (`taskflow: "false"`), which YAML then
 * parses as a string, not the boolean.
 */
export function isTaskflowDisabled(frontmatter: Record<string, unknown> | undefined): boolean {
	const value = frontmatter?.taskflow;
	if (value === false) return true;
	if (typeof value === 'string') return ['false', 'ignore', 'off', 'no'].includes(value.toLowerCase());
	return false;
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
	return value === 'someday' || value === 'done' ? value : 'active';
}

function findEnclosingHeading(headings: HeadingCache[], line: number): string | undefined {
	let current: string | undefined;
	for (const h of headings) {
		if (h.position.start.line > line) break;
		current = h.heading;
	}
	return current;
}

/** The repeater text off whichever planning stamp carries one. */
function repeaterText(org: OrgTask): string | undefined {
	const r = org.scheduled?.repeater ?? org.deadline?.repeater;
	return r ? `${r.kind}${r.value}${r.unit}` : undefined;
}

/**
 * A cheap pre-filter: files with no uppercase word at the start of a line
 * can't hold a headline. v1 could ask the metadataCache "does this file have
 * checkboxes?"; keyword headlines aren't cached, so this stands in for it.
 */
const MAYBE_HEADLINE_RE = /^[\s]*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX-]\]\s+)?[A-Z]{2,12}\b/m;

const CHECKLIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;
const CHECKLIST_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

export class TaskIndexer {
	private debounceTimers = new Map<string, number>();
	private resolvedScanDone = false;

	constructor(private plugin: TaskFlowPlugin) {}

	start(): void {
		const { app } = this.plugin;
		this.plugin.registerEvent(
			app.metadataCache.on('changed', (file) => this.scheduleReindex(file)),
		);
		// The metadataCache resolves asynchronously after layout-ready; on a
		// cold start some files have no cache yet during the first scan. Rescan
		// once when the cache reports everything resolved.
		this.plugin.registerEvent(
			app.metadataCache.on('resolved', () => {
				if (this.resolvedScanDone) return;
				this.resolvedScanDone = true;
				void this.fullScan();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				this.plugin.store.getState().renameFile(oldPath, file.path);
				this.scheduleReindex(file);
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('delete', (file) => {
				this.clearTimer(file.path);
				this.plugin.store.getState().removeFile(file.path);
			}),
		);
		app.workspace.onLayoutReady(() => void this.fullScan());
	}

	stop(): void {
		for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
		this.debounceTimers.clear();
	}

	async fullScan(): Promise<void> {
		const t0 = performance.now();
		const files = this.plugin.app.vault.getMarkdownFiles();
		let taskCount = 0;
		await Promise.all(
			files.map(async (file) => {
				const cache = this.plugin.app.metadataCache.getFileCache(file);
				if (!cache) return;
				if (this.isFileExcluded(file.path, cache)) {
					this.plugin.store.getState().removeFile(file.path);
					return;
				}
				const isProject = cache.frontmatter?.type === 'project';
				const content = await this.plugin.app.vault.cachedRead(file);
				if (!isProject && !MAYBE_HEADLINE_RE.test(content)) return;
				taskCount += this.indexFile(file, content, cache);
			}),
		);
		this.log(
			`full scan: ${files.length} files, ${taskCount} tasks in ${(performance.now() - t0).toFixed(1)}ms`,
		);
	}

	private scheduleReindex(file: TFile): void {
		this.clearTimer(file.path);
		this.debounceTimers.set(
			file.path,
			window.setTimeout(() => {
				this.debounceTimers.delete(file.path);
				void this.reindexFile(file);
			}, DEBOUNCE_MS),
		);
	}

	private clearTimer(path: string): void {
		const timer = this.debounceTimers.get(path);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.debounceTimers.delete(path);
		}
	}

	private async reindexFile(file: TFile): Promise<void> {
		// Re-read cache and content after the debounce window; the payload from
		// the original 'changed' event may be stale by now.
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (!cache) return;
		const t0 = performance.now();
		const content = await this.plugin.app.vault.cachedRead(file);
		const count = this.indexFile(file, content, cache);
		this.log(`reindex ${file.path}: ${count} tasks in ${(performance.now() - t0).toFixed(1)}ms`);
	}

	private isFileExcluded(path: string, cache: CachedMetadata): boolean {
		return (
			isExcludedPath(path, this.plugin.persisted.settings.excludedFolders) ||
			isTaskflowDisabled(cache.frontmatter)
		);
	}

	/** Parses one file into tasks and pushes them into the store. Returns the task count. */
	private indexFile(file: TFile, content: string, cache: CachedMetadata): number {
		const store = this.plugin.store.getState();
		if (this.isFileExcluded(file.path, cache)) {
			store.removeFile(file.path);
			return 0;
		}
		const fm = cache.frontmatter;
		const isProject = fm?.type === 'project';
		const project: ProjectInfo | null = isProject
			? {
					path: file.path,
					name: file.basename,
					status: normalizeProjectStatus(fm?.status),
					area: typeof fm?.area === 'string' ? fm.area : undefined,
				}
			: null;

		const { lines } = splitLines(content);
		const headings = cache.headings ?? [];
		const storeTasks = store.tasks;
		const existingIds = new Set(Object.keys(storeTasks));
		const tasks: Task[] = [];
		const missingIds: { line: number; id: string; replaces?: string }[] = [];
		const completionCandidates: ExternalCompletionCandidate[] = [];
		const seenInFile = new Set<string>();

		for (let i = 0; i < lines.length; i++) {
			if (!isTaskHeadline(lines[i] ?? '')) continue;
			const org = parseTaskAt(lines, i);
			if (!org) continue;

			let id = org.blockId;
			if (id !== undefined) {
				// Copy-pasted blocks can carry duplicate IDs (within this file or
				// clashing with a task in another file) — reassign the duplicate.
				const existing = own(storeTasks, id);
				const clashesOtherFile = existing !== undefined && existing.file !== file.path;
				if (seenInFile.has(id) || clashesOtherFile) {
					const fresh = generateTaskId(existingIds);
					missingIds.push({ line: i, id: fresh, replaces: id });
					id = fresh;
				}
			} else {
				id = generateTaskId(existingIds);
				missingIds.push({ line: i, id });
			}
			existingIds.add(id);
			seenInFile.add(id);

			const status = statusOf(org.keyword);
			const properties = { ...org.properties };
			delete properties.ID;

			const task: Task = {
				id,
				title: org.title,
				file: file.path,
				line: i,
				blockEnd: org.end,
				keyword: org.keyword,
				status,
				scheduled: org.scheduled?.date,
				scheduledTime: org.scheduled?.time,
				scheduledEndTime: org.scheduled?.endTime,
				due: org.deadline?.date,
				repeater: repeaterText(org),
				tags: org.tags,
				project: isProject ? file.path : undefined,
				projectStatus: project?.status,
				heading: findEnclosingHeading(headings, i),
				order: i,
				completedAt: own(this.plugin.persisted.completedAt, id),
				evening: org.tags.includes(TONIGHT_TAG) || undefined,
				someday: org.keyword === 'SOMEDAY' || org.tags.includes(SOMEDAY_TAG) || undefined,
				priority: priorityRank(org.priority),
				properties: Object.keys(properties).length > 0 ? properties : undefined,
			};
			const checklist = this.collectChecklist(lines, org, existingIds, missingIds, seenInFile);
			if (checklist.length > 0) task.checklist = checklist;
			tasks.push(task);

			// A task already done/cancelled on this pass might be one the plugin
			// never itself completed (a hand-typed DONE, an externally synced
			// change) — flag it for the unlogged-completion check below,
			// regardless of how it got here.
			if (status !== 'todo') {
				completionCandidates.push({
					taskId: id,
					title: task.title,
					project: task.project,
					status: status === 'cancelled' ? 'cancelled' : 'done',
					stampDate: org.closed?.date,
				});
			}
			i = org.end;
		}

		this.reconcilePersisted(tasks);
		store.setFileIndex(file.path, tasks, project);
		if (missingIds.length > 0) void this.assignIds(file, missingIds);
		const unlogged = findUnloggedCompletions(this.plugin.persisted.log, completionCandidates);
		if (unlogged.length > 0) void this.recordUnloggedCompletions(file, unlogged);
		const drift = findStampDrift(this.plugin.persisted.log, completionCandidates);
		if (drift.length > 0) void this.applyStampDrift(drift);
		return tasks.length;
	}

	/**
	 * Plain `- [ ]` checkboxes indented under a task are its checklist items.
	 * A nested *keyword* headline is never a checklist item — in org a subtree
	 * carrying its own TODO is its own task, and the main loop picks it up.
	 */
	private collectChecklist(
		lines: string[],
		org: OrgTask,
		existingIds: Set<string>,
		missingIds: { line: number; id: string; replaces?: string }[],
		seenInFile: Set<string>,
	): ChecklistItem[] {
		const items: ChecklistItem[] = [];
		const baseIndent = org.indent.length;
		for (let i = org.end + 1; i < lines.length; i++) {
			const raw = lines[i];
			if (raw === undefined || raw.trim() === '' || isTaskHeadline(raw)) break;
			const m = CHECKLIST_RE.exec(raw);
			if (!m || (m[1] ?? '').length <= baseIndent) break;

			let body = m[3] ?? '';
			const idm = CHECKLIST_ID_RE.exec(body);
			let id = idm?.[1];
			if (idm) body = body.slice(0, idm.index);
			if (id === undefined || seenInFile.has(id)) {
				const fresh = generateTaskId(existingIds);
				missingIds.push({ line: i, id: fresh, replaces: id });
				id = fresh;
			}
			existingIds.add(id);
			seenInFile.add(id);
			items.push({
				id,
				title: body.replace(/\s+/g, ' ').trim(),
				done: (m[2] ?? ' ') !== ' ',
				line: i,
			});
		}
		return items;
	}

	/**
	 * Keeps the completion log/timestamps consistent with markdown state, so
	 * completions undone outside the plugin (changing DONE back to TODO in the
	 * note) disappear from the History — and from the daily journal too.
	 */
	private reconcilePersisted(tasks: Task[]): void {
		const persisted = this.plugin.persisted;
		let changed = false;
		const before = persisted.log;
		const pruned = reconcileLog(before, tasks);
		if (pruned) {
			const stillPresent = new Set(pruned);
			for (const entry of before) {
				if (!stillPresent.has(entry) && entry.status === 'done') {
					void this.plugin.dailySync.remove(entry);
				}
			}
			persisted.log = pruned;
			this.plugin.store.getState().setLog([...pruned]);
			changed = true;
		}
		for (const task of tasks) {
			if (
				task.status === 'todo' &&
				task.repeater === undefined &&
				task.properties?.[REPEAT_PROPERTY] === undefined &&
				persisted.completedAt[task.id] !== undefined
			) {
				delete persisted.completedAt[task.id];
				task.completedAt = undefined;
				changed = true;
			}
		}
		if (changed) void this.plugin.savePersisted();
	}

	/**
	 * Writes IDs onto tasks that lack one (or replaces a duplicate), batched
	 * per file through vault.process() so concurrent edits are never clobbered.
	 * Task IDs go wherever the ID style says — a `^ref` on the headline or an
	 * `:ID:` property; checklist items always take the `^ref`, being plain
	 * checkboxes with no drawer of their own.
	 *
	 * Edits run bottom-up: adding an `:ID:` property grows the block, which
	 * would shift every line number below it.
	 */
	private async assignIds(
		file: TFile,
		missing: { line: number; id: string; replaces?: string }[],
	): Promise<void> {
		const idStyle = this.plugin.persisted.settings.idStyle;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			for (const { line, id, replaces } of [...missing].sort((a, b) => b.line - a.line)) {
				const raw = lines[line];
				if (raw === undefined) continue;
				if (isTaskHeadline(raw)) {
					editTaskBlock(lines, line, idStyle, (task) => {
						// If a line moved or changed since parsing, leave it alone:
						// the resulting 'changed' event re-indexes and retries.
						if (task.blockId === undefined || task.blockId === replaces) task.blockId = id;
					});
				} else if (replaces === undefined) {
					lines[line] = raw.replace(/\s*$/, '') + ` ^${id}`;
				} else {
					lines[line] = raw.replace(/\^[A-Za-z0-9-]+(\s*)$/, `^${id}$1`);
				}
			}
			return lines.join(sep);
		});
	}

	/**
	 * Backfills History for completions the plugin's own actions never saw:
	 * adds the missing CLOSED stamp (batched into one write, same pattern as
	 * assignIds) for 'done' tasks that don't have one, then logs every
	 * candidate — mirroring exactly what completing a task through the plugin
	 * does, just triggered by noticing the change instead of causing it.
	 */
	private async recordUnloggedCompletions(
		file: TFile,
		items: ExternalCompletionCandidate[],
	): Promise<void> {
		const today = todayISO();
		const idStyle = this.plugin.persisted.settings.idStyle;
		const needsStamp = new Set(
			items.filter((i) => i.status === 'done' && i.stampDate === undefined).map((i) => i.taskId),
		);
		if (needsStamp.size > 0) {
			await this.plugin.app.vault.process(file, (content) => {
				const { lines, sep } = splitLines(content);
				for (let i = lines.length - 1; i >= 0; i--) {
					if (!isTaskHeadline(lines[i] ?? '')) continue;
					const org = parseTaskAt(lines, i);
					if (org?.blockId === undefined || !needsStamp.has(org.blockId) || org.closed) continue;
					editTaskBlock(lines, i, idStyle, (task) => {
						task.closed = inactiveStamp(today, '00:00');
					});
				}
				return lines.join(sep);
			});
		}
		for (const item of items) {
			await this.plugin.actions.recordExternalCompletion(item, item.stampDate ?? today);
		}
		this.log(`recovered ${items.length} unlogged completion(s) in ${file.path}`);
	}

	/**
	 * Syncs an already-logged completion's date to a hand-edited CLOSED stamp —
	 * reuses the same action the "Edit date…" History menu item calls, since
	 * the effect is identical (correct the log entry, move the daily journal
	 * line); the only difference is what triggered it.
	 */
	private async applyStampDrift(drift: StampDrift[]): Promise<void> {
		for (const d of drift) {
			await this.plugin.actions.editCompletionDate(d.taskId, d.oldCompletedAt, d.newDateISO);
		}
		this.log(`synced ${drift.length} completion date(s) to their CLOSED stamp`);
	}

	private log(message: string): void {
		if (this.plugin.persisted.settings.debugPerf) console.log(`TaskFlow: ${message}`);
	}
}
