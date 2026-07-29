import { Notice, Plugin, TFile } from 'obsidian';
import type { Editor } from 'obsidian';
import { CaptureModal } from './capture/CaptureModal';
import { DailySync } from './daily/DailySync';
import { TaskIndexer } from './indexer/indexer';
import { Migrator, writeReportNote } from './migrate/migrate';
import { TaskActions } from './mutations/actions';
import { isTaskHeadline, parseTaskAt } from './org/parser';
import { DEFAULT_PERSISTED, DEFAULT_SETTINGS, TaskFlowSettingTab } from './settings';
import type { PersistedData } from './settings';
import { buildHistoryCsv } from './store/csv';
import { createTaskFlowStore } from './store/store';
import type { TaskFlowStore } from './store/store';
import { own } from './utils';
import { AgendaDispatchModal } from './views/AgendaDispatchModal';
import { DateSuggestModal } from './views/DateSuggestModal';
import { KeywordSuggestModal } from './views/KeywordSuggestModal';
import { MigrationModal } from './views/MigrationModal';
import { ProjectSuggestModal } from './views/ProjectSuggestModal';
import { QuickFindModal } from './views/QuickFindModal';
import { HOVER_SOURCE_TASKFLOW, TaskFlowView, VIEW_TYPE_TASKFLOW } from './views/TaskFlowView';

export default class TaskFlowPlugin extends Plugin {
	persisted: PersistedData = DEFAULT_PERSISTED;
	store: TaskFlowStore = createTaskFlowStore();
	actions: TaskActions = new TaskActions(this);
	dailySync: DailySync = new DailySync(this);
	migrator: Migrator = new Migrator(this);
	private indexer: TaskIndexer = new TaskIndexer(this);

	override async onload(): Promise<void> {
		await this.loadPersisted();

		this.registerView(VIEW_TYPE_TASKFLOW, (leaf) => new TaskFlowView(leaf, this));
		this.registerHoverLinkSource(HOVER_SOURCE_TASKFLOW, {
			display: 'TaskFlow',
			defaultMod: true,
		});

		this.addCommand({
			id: 'open-sidebar',
			name: 'Open sidebar',
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: 'open-agenda',
			name: 'Open agenda',
			callback: () => {
				this.store.getState().setRoute({ kind: 'agenda' });
				this.store.getState().setAgendaStart(null);
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'agenda-dispatch',
			name: 'Agenda dispatcher…',
			callback: () => new AgendaDispatchModal(this).open(),
		});
		this.addCommand({
			id: 'quick-capture',
			name: 'Quick capture',
			callback: () => new CaptureModal(this).open(),
		});
		this.addCommand({
			id: 'sync-daily-note',
			name: "Sync today's completions to daily note",
			callback: () => void this.dailySync.backfillToday(),
		});
		this.addCommand({
			id: 'clean-orphaned-journal-lines',
			name: 'Clean up daily-note lines with no matching History entry',
			callback: () => void this.dailySync.cleanOrphanedJournalLines(),
		});
		this.addCommand({
			id: 'quick-find',
			name: 'Quick search',
			callback: () => new QuickFindModal(this).open(),
		});
		this.addCommand({
			id: 'weekly-review',
			name: 'Start weekly review',
			callback: () => {
				this.store.getState().setRoute({ kind: 'review' });
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'roll-overdue',
			name: 'Roll all overdue tasks to today',
			callback: () => void this.actions.rollOverdueToToday(),
		});
		this.addCommand({
			id: 'export-history-csv',
			name: 'Export History as CSV',
			callback: () => void this.exportHistoryCsv(),
		});

		this.addCommand({
			id: 'migrate-v1-preview',
			name: 'Migrate from TaskFlow v1: preview changes (dry run)',
			callback: () => void this.previewMigration(),
		});
		this.addCommand({
			id: 'migrate-v1-run',
			name: 'Migrate from TaskFlow v1: convert vault…',
			callback: () => void this.runMigration(),
		});

		this.addTaskCommand('cycle-keyword', 'Cycle TODO keyword of task under cursor', (id) =>
			void this.actions.cycleKeyword(id),
		);
		this.addTaskCommand('set-keyword', 'Set TODO keyword of task under cursor…', (id) => {
			new KeywordSuggestModal(this.app, (keyword) => void this.actions.setKeyword(id, keyword)).open();
		});
		this.addTaskCommand('priority-a', 'Toggle priority [#A] for task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			void this.actions.setTaskPriority(id, task?.priority === 1 ? null : 1);
		});
		this.addTaskCommand('priority-b', 'Toggle priority [#B] for task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			void this.actions.setTaskPriority(id, task?.priority === 2 ? null : 2);
		});
		this.addTaskCommand('priority-c', 'Toggle priority [#C] for task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			void this.actions.setTaskPriority(id, task?.priority === 3 ? null : 3);
		});
		this.addTaskCommand('toggle-evening', 'Toggle Tonight for task under cursor', (id) =>
			void this.actions.toggleEvening(id),
		);
		this.addTaskCommand('toggle-someday', 'Toggle Someday for task under cursor', (id) =>
			void this.actions.toggleSomeday(id),
		);
		this.addTaskCommand('toggle-complete', 'Complete/uncomplete task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			if (task?.status === 'done') void this.actions.uncompleteTask(id);
			else void this.actions.completeTask(id);
		});
		this.addTaskCommand('cancel-task', 'Cancel task under cursor', (id) =>
			void this.actions.cancelTask(id),
		);
		this.addTaskCommand('schedule-today', 'Schedule task under cursor: today', (id) =>
			void this.actions.scheduleTask(id, 'today'),
		);
		this.addTaskCommand('schedule-tomorrow', 'Schedule task under cursor: tomorrow', (id) =>
			void this.actions.scheduleTask(id, 'tomorrow'),
		);
		this.addTaskCommand('clear-schedule', 'Clear SCHEDULED date of task under cursor', (id) =>
			void this.actions.scheduleTask(id, null),
		);
		this.addTaskCommand('schedule-pick', 'Schedule task under cursor: pick date…', (id) => {
			const task = this.store.getState().tasks[id];
			new DateSuggestModal(this.app, 'Schedule', task?.scheduled !== undefined, (date) => {
				void this.actions.scheduleTask(id, date);
			}).open();
		});
		this.addTaskCommand('due-pick', 'Set DEADLINE of task under cursor: pick date…', (id) => {
			const task = this.store.getState().tasks[id];
			new DateSuggestModal(this.app, 'Deadline', task?.due !== undefined, (date) => {
				void this.actions.setDue(id, date);
			}).open();
		});
		this.addTaskCommand('move-to-project', 'Move task under cursor to project…', (id) => {
			new ProjectSuggestModal(this, (choice) => {
				void this.actions.moveToProject(id, choice.path);
			}).open();
		});

		this.addSettingTab(new TaskFlowSettingTab(this.app, this));
		this.store.getState().setAgendaSpan(this.persisted.settings.agendaSpan);
		this.indexer.start();
	}

	override onunload(): void {
		this.indexer.stop();
	}

	/**
	 * Registers an editor command that resolves the task the cursor is in.
	 * A v2 task spans several lines, so the cursor counts as "on" a task
	 * anywhere inside its block, not just on the headline.
	 */
	private addTaskCommand(id: string, name: string, run: (taskId: string) => void): void {
		this.addCommand({
			id,
			name,
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor().line;
				let taskId: string | undefined;
				for (let i = cursor; i >= 0 && i > cursor - 12; i--) {
					if (!isTaskHeadline(editor.getLine(i))) continue;
					const lines: string[] = [];
					for (let j = i; j < editor.lineCount() && j <= cursor + 12; j++) lines.push(editor.getLine(j));
					const org = parseTaskAt(lines, 0);
					if (org && i + org.end >= cursor) taskId = org.blockId;
					break;
				}
				const task = taskId === undefined ? undefined : own(this.store.getState().tasks, taskId);
				if (!task) {
					new Notice('TaskFlow: no indexed task at the cursor.');
					return;
				}
				run(task.id);
			},
		});
	}

	/** Full re-index — used after settings changes that alter what gets indexed. */
	async rescan(): Promise<void> {
		await this.indexer.fullScan();
	}

	private async previewMigration(): Promise<void> {
		new Notice('TaskFlow: scanning vault…');
		const report = await this.migrator.plan();
		if (report.taskCount === 0) {
			new Notice('TaskFlow: no v1 tasks found — nothing to migrate.');
			return;
		}
		await writeReportNote(this, report, false);
	}

	private async runMigration(): Promise<void> {
		new Notice('TaskFlow: scanning vault…');
		const report = await this.migrator.plan();
		if (report.taskCount === 0) {
			new Notice('TaskFlow: no v1 tasks found — nothing to migrate.');
			return;
		}
		new MigrationModal(this, report, async () => {
			const applied = await this.migrator.apply();
			await writeReportNote(this, applied, true);
		}).open();
	}

	private async exportHistoryCsv(): Promise<void> {
		const csv = buildHistoryCsv(this.persisted.log, this.store.getState().projects);
		const path = 'TaskFlow History.csv';
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, csv);
		else await this.app.vault.create(path, csv);
		new Notice(`TaskFlow: exported ${this.persisted.log.length} entries to ${path}`);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKFLOW)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_TASKFLOW, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async loadPersisted(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<PersistedData>;
		this.persisted = {
			settings: { ...DEFAULT_SETTINGS, ...raw.settings },
			// A v1 data.json drops straight in: task IDs are unchanged by the
			// migration, so orders, completedAt, and the log all still resolve.
			orders: raw.orders ?? {},
			completedAt: raw.completedAt ?? {},
			log: raw.log ?? [],
			filters: raw.filters ?? [],
			lastReview: raw.lastReview,
			migratedAt: raw.migratedAt,
		};
		this.store.getState().setLog([...this.persisted.log]);
		this.store.getState().setFilters([...this.persisted.filters]);
		this.store.getState().setOrders({ ...this.persisted.orders });
	}

	async savePersisted(): Promise<void> {
		await this.saveData(this.persisted);
	}
}
