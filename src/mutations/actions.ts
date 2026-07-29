import { Notice, TFile } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { REPEAT_PROPERTY, SOMEDAY_TAG, TONIGHT_TAG } from '../org/tags';
import { keywordForStatus, priorityFromRank, statusOf } from '../org/keywords';
import type { OrgKeyword } from '../org/keywords';
import type { OrgTask } from '../org/parser';
import { appendLogbookEntry, editTaskBlock, formatTaskBlock, newTaskBlock } from '../org/serialize';
import { formatTimestamp, inactiveStamp, splitISODateTime, timestamp } from '../org/timestamp';
import { advanceRecurrence } from '../recurrence/recurrence';
import { addDaysISO, todayISO } from '../store/selectors';
import type { SavedFilter, Task, TaskStatus } from '../types';
import { own } from '../utils';
import {
	extractTaskBlock,
	findChecklistLine,
	findTaskBlock,
	insertTaskBlock,
	insertTaskBlockBeforeHeadings,
	setCheckboxState,
	splitLines,
} from './blockEdits';

export type ScheduleTarget = string | 'today' | 'tomorrow' | null;

function noonISO(dateISO: string): string {
	const [y, m, d] = dateISO.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toISOString();
}

/**
 * All task mutations flow through here. v1 rewrote a single markdown line with
 * per-token regexes; a v2 task spans a headline, a planning line, and drawers,
 * so every edit instead parses the block, mutates the parsed object, and lets
 * the serializer re-emit it. The write goes through vault.process() (atomic
 * read-modify-write, safe against concurrent edits) and the store is patched
 * optimistically; the debounced reindex reconciles everything else.
 */
export class TaskActions {
	constructor(private plugin: TaskFlowPlugin) {}

	private getTask(id: string): Task | undefined {
		return own(this.plugin.store.getState().tasks, id);
	}

	private get idStyle() {
		return this.plugin.persisted.settings.idStyle;
	}

	/** Parses the task's block, applies `mutate`, and writes it back. */
	private async editTask(task: Task, mutate: (org: OrgTask) => void): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(file instanceof TFile)) return false;
		let edited = false;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			const found = findTaskBlock(lines, task.id, task.line);
			if (!found) return content;
			editTaskBlock(lines, found.start, this.idStyle, mutate);
			edited = true;
			return lines.join(sep);
		});
		if (!edited) new Notice('TaskFlow: task block not found — it may have been edited.');
		return edited;
	}

	/** Completes a task; `asOf` (ISO date) backdates the stamp, log, and journal line. */
	async completeTask(id: string, asOf?: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'done') return;
		const today = asOf ?? todayISO();
		const previous = task.keyword;

		const repeats = task.repeater !== undefined || task.properties?.[REPEAT_PROPERTY] !== undefined;
		if (repeats) {
			const next = advanceRecurrence(
				{
					scheduled: task.scheduled,
					due: task.due,
					repeater: task.repeater,
					ruleText: task.properties?.[REPEAT_PROPERTY],
				},
				today,
			);
			if (next) {
				// Org's own behaviour: the headline goes back to its TODO state
				// with the stamps advanced, and the occurrence is recorded as a
				// LOGBOOK line. The completion itself lives in the index log.
				const ok = await this.editTask(task, (org) => {
					org.keyword = previous === 'DONE' ? 'TODO' : previous;
					org.closed = undefined;
					if (next.scheduled !== undefined && org.scheduled) org.scheduled.date = next.scheduled;
					if (next.due !== undefined && org.deadline) org.deadline.date = next.due;
					const { date, time } = splitISODateTime(asOf ? noonISO(asOf) : new Date().toISOString());
					appendLogbookEntry(org, previous, 'DONE', formatTimestamp(inactiveStamp(date, time)));
				});
				if (!ok) return;
				await this.recordCompletion(task, 'done', asOf);
				this.plugin.store.getState().patchTask(id, {
					keyword: previous === 'DONE' ? 'TODO' : previous,
					status: 'todo',
					scheduled: next.scheduled ?? task.scheduled,
					due: next.due ?? task.due,
				});
				return;
			}
			new Notice(`TaskFlow: couldn't parse the repeater on “${task.title}” — completing without repeat.`);
		}

		const { date, time } = splitISODateTime(asOf ? noonISO(asOf) : new Date().toISOString());
		const ok = await this.editTask(task, (org) => {
			org.keyword = 'DONE';
			org.closed = inactiveStamp(date, time);
		});
		if (!ok) return;
		const completedAt = await this.recordCompletion(task, 'done', asOf);
		this.plugin.store.getState().patchTask(id, { keyword: 'DONE', status: 'done', completedAt });
	}

	async uncompleteTask(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'todo') return;
		if (
			!(await this.editTask(task, (org) => {
				org.keyword = 'TODO';
				org.closed = undefined;
			}))
		) {
			return;
		}
		delete this.plugin.persisted.completedAt[id];
		// Drop the most recent log entry for this task so the History stays honest.
		const log = this.plugin.persisted.log;
		let removed: (typeof log)[number] | undefined;
		for (let i = log.length - 1; i >= 0; i--) {
			if (log[i]?.taskId === id) {
				removed = log.splice(i, 1)[0];
				break;
			}
		}
		this.plugin.store.getState().setLog([...log]);
		await this.plugin.savePersisted();
		// Only 'done' entries ever wrote a daily-note line; removing on a
		// cancelled entry could delete an older completion's line for the task.
		if (removed?.status === 'done') await this.plugin.dailySync.remove(removed);
		this.plugin.store.getState().patchTask(id, { keyword: 'TODO', status: 'todo', completedAt: undefined });
	}

	async cancelTask(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'cancelled') return;
		if (!(await this.editTask(task, (org) => void (org.keyword = 'CANCELLED')))) return;
		// Index-only timestamp so History can group cancelled tasks by day; org
		// reserves CLOSED for completions, so no stamp is written.
		const completedAt = await this.recordCompletion(task, 'cancelled');
		this.plugin.store.getState().patchTask(id, { keyword: 'CANCELLED', status: 'cancelled', completedAt });
	}

	/**
	 * Sets any TODO keyword directly — the org-native move v1 had no equivalent
	 * for. Routing DONE/CANCELLED through complete/cancel keeps the CLOSED
	 * stamp, History, and daily journal in step.
	 */
	async setKeyword(id: string, keyword: OrgKeyword): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.keyword === keyword) return;
		if (keyword === 'DONE') return this.completeTask(id);
		if (keyword === 'CANCELLED') return this.cancelTask(id);
		if (task.status !== 'todo') {
			await this.uncompleteTask(id);
		}
		if (!(await this.editTask(task, (org) => void (org.keyword = keyword)))) return;
		this.plugin.store.getState().patchTask(id, {
			keyword,
			status: statusOf(keyword),
			someday: keyword === 'SOMEDAY' || task.tags.includes(SOMEDAY_TAG) || undefined,
		});
	}

	/** Cycles TODO → NEXT → WAITING → TODO, org's `C-c C-t` in miniature. */
	async cycleKeyword(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const order: OrgKeyword[] = ['TODO', 'NEXT', 'WAITING'];
		const idx = order.indexOf(task.keyword);
		await this.setKeyword(id, order[(idx + 1) % order.length] ?? 'TODO');
	}

	/** Toggles the Tonight tag; enabling also schedules today when undated. */
	async toggleEvening(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const on = task.evening !== true;
		const today = todayISO();
		const needsSchedule =
			on && (task.scheduled === undefined || task.scheduled > today) && (task.due === undefined || task.due > today);
		const ok = await this.editTask(task, (org) => {
			setTag(org, TONIGHT_TAG, on);
			if (needsSchedule) org.scheduled = timestamp(today);
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, {
			evening: on || undefined,
			tags: on ? [...task.tags, TONIGHT_TAG] : task.tags.filter((t) => t !== TONIGHT_TAG),
			scheduled: needsSchedule ? today : task.scheduled,
		});
	}

	/**
	 * Toggles task-level Someday, writing org's own SOMEDAY keyword. v1 encoded
	 * this as a `:someday:` tag and v2 still *reads* that (see the indexer and
	 * isSomedayTask), so migrated and hand-written vaults keep working — but the
	 * keyword is the canonical form, and a toggle clears any legacy tag it finds
	 * rather than leaving the state spelled two ways on one headline.
	 *
	 * Turning it off only rewrites the keyword when it is the SOMEDAY keyword
	 * doing the work: a NEXT or WAITING task that merely carried the old tag
	 * keeps its keyword and just loses the tag.
	 */
	async toggleSomeday(id: string): Promise<void> {
		const task = this.getTask(id);
		// Someday is a state for open work; reopening a closed task is
		// uncompleteTask's job, not this one's.
		if (!task || task.status !== 'todo') return;
		const on = task.someday !== true;
		const keyword: OrgKeyword = on ? 'SOMEDAY' : task.keyword === 'SOMEDAY' ? 'TODO' : task.keyword;
		const ok = await this.editTask(task, (org) => {
			org.keyword = keyword;
			setTag(org, SOMEDAY_TAG, false);
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, {
			keyword,
			status: statusOf(keyword),
			someday: on || undefined,
			tags: task.tags.filter((t) => t !== SOMEDAY_TAG),
		});
	}

	/** Toggles one checklist item of a task by the item's block ID. */
	async toggleChecklistItem(parentId: string, itemId: string): Promise<void> {
		const parent = this.getTask(parentId);
		const item = parent?.checklist?.find((c) => c.id === itemId);
		if (!parent || !item) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(parent.file);
		if (!(file instanceof TFile)) return;
		const on = !item.done;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			const idx = findChecklistLine(lines, itemId);
			if (idx === -1) return content;
			lines[idx] = setCheckboxState(lines[idx] ?? '', on);
			return lines.join(sep);
		});
		this.plugin.store.getState().patchTask(parentId, {
			checklist: parent.checklist?.map((c) => (c.id === itemId ? { ...c, done: on } : c)),
		});
	}

	/** Sets or clears the `[#A]`/`[#B]`/`[#C]` priority cookie. */
	async setTaskPriority(id: string, priority: 1 | 2 | 3 | null): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const cookie = priorityFromRank(priority ?? undefined);
		if (!(await this.editTask(task, (org) => void (org.priority = cookie)))) return;
		this.plugin.store.getState().patchTask(id, { priority: priority ?? undefined });
	}

	/** Reschedules every overdue open task to today. Returns the count. */
	async rollOverdueToToday(): Promise<number> {
		const today = todayISO();
		const state = this.plugin.store.getState();
		const overdue = Object.values(state.tasks).filter((t) => {
			if (t.status !== 'todo' || t.someday === true || t.projectStatus === 'someday') return false;
			const date =
				t.scheduled !== undefined && t.due !== undefined
					? t.scheduled < t.due
						? t.scheduled
						: t.due
					: (t.scheduled ?? t.due);
			return date !== undefined && date < today;
		});
		for (const t of overdue) await this.scheduleTask(t.id, today);
		if (overdue.length > 0) {
			new Notice(`TaskFlow: rolled ${overdue.length} task${overdue.length === 1 ? '' : 's'} to today.`);
		}
		return overdue.length;
	}

	/** Moves a task under a different heading within its own file (board drag). */
	async moveToHeading(id: string, heading: string | undefined): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.heading === heading) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(file instanceof TFile)) return;
		await this.plugin.app.vault.process(file, (content) => {
			const lifted = extractTaskBlock(content, id, task.line);
			if (!lifted) return content;
			return heading !== undefined
				? insertTaskBlock(lifted.rest, lifted.block, heading)
				: insertTaskBlockBeforeHeadings(lifted.rest, lifted.block);
		});
		this.plugin.store.getState().patchTask(id, { heading });
	}

	/** Persists a manual sort order for one list: index within `ids` wins. */
	async reorderTasks(orderKey: string, ids: string[]): Promise<void> {
		this.plugin.persisted.orders[orderKey] = Object.fromEntries(ids.map((id, i) => [id, i]));
		this.plugin.store.getState().setOrders({ ...this.plugin.persisted.orders });
		await this.plugin.savePersisted();
	}

	/** Removes one History entry (for orphans whose task block no longer exists). */
	async removeLogEntry(taskId: string, completedAt: string): Promise<void> {
		const log = this.plugin.persisted.log;
		const idx = log.findIndex((e) => e.taskId === taskId && e.completedAt === completedAt);
		if (idx === -1) return;
		const [removed] = log.splice(idx, 1);
		this.plugin.store.getState().setLog([...log]);
		await this.plugin.savePersisted();
		if (removed?.status === 'done') await this.plugin.dailySync.remove(removed);
	}

	/** Appends a completion-log entry and persists; returns the timestamp. */
	private async recordCompletion(
		task: Pick<Task, 'id' | 'title' | 'project'>,
		status: 'done' | 'cancelled',
		asOf?: string,
	): Promise<string> {
		// Backdated completions get noon local on the chosen day so History,
		// stats, and the daily journal all group under that date.
		const completedAt = asOf ? noonISO(asOf) : new Date().toISOString();
		this.plugin.persisted.completedAt[task.id] = completedAt;
		this.plugin.persisted.log.push({
			taskId: task.id,
			title: task.title,
			project: task.project,
			status,
			completedAt,
		});
		this.plugin.store.getState().setLog([...this.plugin.persisted.log]);
		await this.plugin.savePersisted();
		if (status === 'done') {
			await this.plugin.dailySync.record(task.id, task.title, task.project, completedAt);
		}
		return completedAt;
	}

	/**
	 * Logs a completion/cancellation the plugin didn't itself perform — a
	 * hand-typed DONE or an externally synced change. Called by the indexer
	 * when it notices a done/cancelled task with no matching History entry; the
	 * keyword (and, for 'done', its CLOSED stamp) is already correct by the
	 * time this runs — this only creates the History entry and journal line.
	 */
	async recordExternalCompletion(
		info: { taskId: string; title: string; project?: string; status: 'done' | 'cancelled' },
		dateISO: string,
	): Promise<void> {
		await this.recordCompletion(
			{ id: info.taskId, title: info.title, project: info.project },
			info.status,
			dateISO,
		);
	}

	/**
	 * Corrects the date of one History entry (identified the same way
	 * removeLogEntry finds it: taskId + its current completedAt). If this entry
	 * is still the task's live completion — its block still shows the CLOSED
	 * stamp — that stamp is corrected too; a historical entry whose task has
	 * since moved on (a repeating task's earlier occurrence) only gets its log
	 * + daily-journal date corrected.
	 */
	async editCompletionDate(taskId: string, oldCompletedAt: string, newDateISO: string): Promise<void> {
		const log = this.plugin.persisted.log;
		const idx = log.findIndex((e) => e.taskId === taskId && e.completedAt === oldCompletedAt);
		const entry = idx === -1 ? undefined : log[idx];
		if (!entry) {
			new Notice('TaskFlow: history entry not found.');
			return;
		}
		if (entry.status !== 'done') return; // Only completions have a CLOSED date to correct.

		const task = this.getTask(taskId);
		const isLiveCompletion = task?.status === 'done' && task.completedAt === entry.completedAt;
		if (isLiveCompletion && task) {
			const existingTime = splitISODateTime(entry.completedAt).time;
			await this.editTask(task, (org) => {
				org.closed = inactiveStamp(newDateISO, org.closed?.time ?? existingTime);
			});
		}

		await this.plugin.dailySync.remove(entry);
		const newCompletedAt = noonISO(newDateISO);
		log[idx] = { ...entry, completedAt: newCompletedAt };
		this.plugin.store.getState().setLog([...log]);
		if (isLiveCompletion) {
			this.plugin.persisted.completedAt[taskId] = newCompletedAt;
			this.plugin.store.getState().patchTask(taskId, { completedAt: newCompletedAt });
		}
		await this.plugin.savePersisted();
		await this.plugin.dailySync.record(taskId, entry.title, entry.project, newCompletedAt);
	}

	/** Creates or updates a pinned filter. */
	async saveFilter(filter: SavedFilter): Promise<void> {
		const filters = this.plugin.persisted.filters;
		const idx = filters.findIndex((f) => f.id === filter.id);
		if (idx === -1) filters.push(filter);
		else filters[idx] = filter;
		this.plugin.store.getState().setFilters([...filters]);
		await this.plugin.savePersisted();
	}

	async deleteFilter(id: string): Promise<void> {
		const filters = this.plugin.persisted.filters.filter((f) => f.id !== id);
		this.plugin.persisted.filters = filters;
		this.plugin.store.getState().setFilters([...filters]);
		const route = this.plugin.store.getState().route;
		if (route.kind === 'filter' && route.id === id) {
			this.plugin.store.getState().setRoute({ kind: 'agenda' });
		}
		await this.plugin.savePersisted();
	}

	async scheduleTask(id: string, target: ScheduleTarget, time?: string): Promise<void> {
		const date = this.resolveDate(target);
		const task = this.getTask(id);
		if (!task) return;
		const ok = await this.editTask(task, (org) => {
			if (date === null) {
				org.scheduled = undefined;
				return;
			}
			// Keep any time-of-day and repeater already on the stamp: rescheduling
			// a weekly 09:00 standup shouldn't silently drop either.
			org.scheduled = {
				date,
				time: time ?? org.scheduled?.time,
				endTime: time === undefined ? org.scheduled?.endTime : undefined,
				repeater: org.scheduled?.repeater,
				active: true,
			};
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, {
			scheduled: date ?? undefined,
			scheduledTime: date === null ? undefined : (time ?? task.scheduledTime),
		});
	}

	async setDue(id: string, date: string | null): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const ok = await this.editTask(task, (org) => {
			org.deadline =
				date === null
					? undefined
					: { date, time: org.deadline?.time, repeater: org.deadline?.repeater, active: true };
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, { due: date ?? undefined });
	}

	/** Sets or clears the org repeater on the SCHEDULED stamp (`+1w`, `.+2d`). */
	async setRepeater(id: string, repeater: string | null): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const parsed = repeater === null ? null : parseRepeaterOrNull(repeater);
		if (repeater !== null && parsed === null) {
			new Notice(`TaskFlow: “${repeater}” isn't a valid org repeater (try +1w, ++2d, .+1m).`);
			return;
		}
		const ok = await this.editTask(task, (org) => {
			// A repeater needs a stamp to live on; default to today when there's none.
			org.scheduled ??= org.deadline ? undefined : timestamp(todayISO());
			const stamp = org.scheduled ?? org.deadline;
			if (stamp) stamp.repeater = parsed ?? undefined;
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, { repeater: repeater ?? undefined });
	}

	/**
	 * Moves the task block between files. Inserted into the target first, then
	 * removed from the source — a crash in between leaves a duplicate rather
	 * than a lost task. targetPath null moves to the Inbox.
	 */
	async moveToProject(id: string, targetPath: string | null, heading?: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const destPath = targetPath ?? 'Inbox.md';
		if (destPath === task.file) return;

		const source = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(source instanceof TFile)) return;
		const content = await this.plugin.app.vault.read(source);
		const lifted = extractTaskBlock(content, id, task.line);
		if (!lifted) {
			new Notice('TaskFlow: task block not found — it may have been edited.');
			return;
		}

		const dest = await this.ensureFile(destPath);
		await this.plugin.app.vault.process(dest, (destContent) =>
			insertTaskBlock(destContent, lifted.block, heading),
		);
		await this.plugin.app.vault.process(source, (srcContent) => {
			const again = extractTaskBlock(srcContent, id, task.line);
			return again ? again.rest : srcContent;
		});

		const project = targetPath ? this.plugin.store.getState().projects[targetPath] : undefined;
		this.plugin.store.getState().patchTask(id, {
			file: destPath,
			project: targetPath ?? undefined,
			projectStatus: project?.status,
			heading,
		});
	}

	/** Renders a new task block for capture; the indexer assigns the ID. */
	renderNewTask(fields: {
		title: string;
		keyword?: OrgKeyword;
		priority?: 1 | 2 | 3;
		scheduled?: string;
		scheduledTime?: string;
		due?: string;
		repeater?: string;
		ruleText?: string;
		tags?: string[];
	}): string[] {
		const org = newTaskBlock({
			keyword: fields.keyword ?? 'TODO',
			title: fields.title,
			priority: priorityFromRank(fields.priority),
			tags: fields.tags ?? [],
		});
		if (fields.scheduled !== undefined) {
			org.scheduled = timestamp(
				fields.scheduled,
				fields.scheduledTime,
				fields.repeater === undefined ? undefined : (parseRepeaterOrNull(fields.repeater) ?? undefined),
			);
		}
		if (fields.due !== undefined) org.deadline = timestamp(fields.due);
		if (fields.ruleText !== undefined) org.properties[REPEAT_PROPERTY] = fields.ruleText;
		return formatTaskBlock(org, this.idStyle);
	}

	async ensureFile(path: string): Promise<TFile> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return this.plugin.app.vault.create(path, '');
	}

	private resolveDate(target: ScheduleTarget): string | null {
		if (target === 'today') return todayISO();
		if (target === 'tomorrow') return addDaysISO(todayISO(), 1);
		return target;
	}
}

/** Adds or removes a tag on a parsed block, preserving order. */
function setTag(org: OrgTask, tag: string, on: boolean): void {
	const has = org.tags.includes(tag);
	if (on && !has) org.tags.push(tag);
	else if (!on && has) org.tags = org.tags.filter((t) => t !== tag);
}

function parseRepeaterOrNull(text: string) {
	const m = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/.exec(text.trim());
	if (!m) return null;
	return {
		kind: m[1] as '+' | '++' | '.+',
		value: Number(m[2]),
		unit: (m[3] ?? 'd') as 'h' | 'd' | 'w' | 'm' | 'y',
	};
}

export { keywordForStatus };
export type { TaskStatus };
