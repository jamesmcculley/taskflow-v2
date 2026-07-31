import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type TaskFlowPlugin from './main';
import type { IdStyle } from './org/serialize';
import type { CompletionEntry, PeriodNote, SavedFilter } from './types';

export interface TaskFlowSettings {
	debugPerf: boolean;
	/** Mirror completions into the day's daily note. */
	dailySync: boolean;
	/** Heading (without #s) the journal lines go under. */
	dailySyncHeading: string;
	/** Vault folders whose tasks are never indexed. */
	excludedFolders: string[];
	/**
	 * Where a task's stable ID is written. `blockref` keeps v1's trailing
	 * `^t-xxxxxx`, which is also a working Obsidian block link; `properties`
	 * uses org's own `:ID:` drawer entry at the cost of three extra lines per
	 * task and no linkable anchor. Both are read either way.
	 */
	idStyle: IdStyle;
	/** Days the agenda spans by default (org's `org-agenda-span`). */
	agendaSpan: 1 | 3 | 7 | 14;
	/** Days ahead a DEADLINE starts appearing in the agenda (`org-deadline-warning-days`). */
	deadlineWarningDays: number;
	/** Show tasks whose SCHEDULED date has passed on every day until done. */
	showScheduledPast: boolean;
	/** Folder review notes are written to. Empty = vault root. */
	reviewFolder: string;
}

export const DEFAULT_SETTINGS: TaskFlowSettings = {
	debugPerf: false,
	dailySync: true,
	dailySyncHeading: 'Completed',
	excludedFolders: [],
	idStyle: 'blockref',
	agendaSpan: 7,
	deadlineWarningDays: 14,
	showScheduledPast: true,
	reviewFolder: 'Reviews',
};

/**
 * Everything persisted via saveData. Markdown is the source of truth for all
 * task fields; this only owns sort order, completion history, and recurrence
 * bookkeeping. Deleting data.json loses nothing else.
 */
export interface PersistedData {
	settings: TaskFlowSettings;
	/** Manual sort order, scoped per list: orderKey -> taskId -> index. */
	orders: Record<string, Record<string, number>>;
	/** Completion timestamps by task ID (ISO datetime). */
	completedAt: Record<string, string>;
	/** Completion log for the History (survives repeating-task rewrites). */
	log: CompletionEntry[];
	/** Pinned smart-list filters shown in the sidebar. */
	filters: SavedFilter[];
	/** Per-period review notes, keyed `2026-W31` / `2026-07` / `2026-Q3`. */
	reviews: Record<string, PeriodNote>;
	/** ISO datetime of the last v1 -> v2 migration run, if any. */
	migratedAt?: string;
}

export const DEFAULT_PERSISTED: PersistedData = {
	settings: DEFAULT_SETTINGS,
	orders: {},
	completedAt: {},
	log: [],
	filters: [],
	reviews: {},
};

export class TaskFlowSettingTab extends PluginSettingTab {
	private excludedFoldersTimer = 0;

	constructor(
		app: App,
		private plugin: TaskFlowPlugin,
	) {
		super(app, plugin);
	}

	/** Closing the tab mid-edit must still apply (and not leave a timer armed). */
	override hide(): void {
		if (this.excludedFoldersTimer !== 0) {
			window.clearTimeout(this.excludedFoldersTimer);
			this.excludedFoldersTimer = 0;
			void (async () => {
				await this.plugin.savePersisted();
				await this.plugin.rescan();
			})();
		}
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Agenda').setHeading();
		new Setting(containerEl)
			.setName('Agenda span')
			.setDesc('How many days the agenda shows at once.')
			.addDropdown((drop) =>
				drop
					.addOptions({ '1': 'Day', '3': '3 days', '7': 'Week', '14': 'Fortnight' })
					.setValue(String(this.plugin.persisted.settings.agendaSpan))
					.onChange(async (value) => {
						this.plugin.persisted.settings.agendaSpan = Number(value) as 1 | 3 | 7 | 14;
						await this.plugin.savePersisted();
					}),
			);
		new Setting(containerEl)
			.setName('Deadline warning days')
			.setDesc('How many days before a DEADLINE it starts showing in the agenda.')
			.addText((text) =>
				text
					.setValue(String(this.plugin.persisted.settings.deadlineWarningDays))
					.onChange(async (value) => {
						const n = Number(value);
						this.plugin.persisted.settings.deadlineWarningDays =
							Number.isFinite(n) && n >= 0 ? Math.floor(n) : 14;
						await this.plugin.savePersisted();
					}),
			);
		new Setting(containerEl)
			.setName('Carry past scheduled items forward')
			.setDesc('Show a task whose SCHEDULED date has passed on every day until it is done.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.persisted.settings.showScheduledPast).onChange(async (value) => {
					this.plugin.persisted.settings.showScheduledPast = value;
					await this.plugin.savePersisted();
				}),
			);

		new Setting(containerEl).setName('Files').setHeading();
		new Setting(containerEl)
			.setName('Task ID style')
			.setDesc(
				'Where the stable task ID is written. Block ref keeps it on the headline and stays linkable from other notes; the PROPERTIES drawer is org-native but adds three lines per task. Existing tasks are read either way.',
			)
			.addDropdown((drop) =>
				drop
					.addOptions({ blockref: 'Block ref (^t-xxxxxx)', properties: 'PROPERTIES drawer (:ID:)' })
					.setValue(this.plugin.persisted.settings.idStyle)
					.onChange(async (value) => {
						this.plugin.persisted.settings.idStyle = value as IdStyle;
						await this.plugin.savePersisted();
					}),
			);
		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('One folder per line. Tasks in these folders are never indexed and never get IDs.')
			.addTextArea((text) =>
				text
					.setPlaceholder('Templates\nArchive')
					.setValue(this.plugin.persisted.settings.excludedFolders.join('\n'))
					// Debounced: onChange fires per keystroke, and applying it
					// re-reads every markdown file in the vault. Typing "Templates"
					// used to cost nine full scans and nine writes to data.json.
					.onChange((value) => {
						this.plugin.persisted.settings.excludedFolders = value
							.split('\n')
							.map((s) => s.trim())
							.filter((s) => s !== '');
						window.clearTimeout(this.excludedFoldersTimer);
						this.excludedFoldersTimer = window.setTimeout(() => {
							void (async () => {
								await this.plugin.savePersisted();
								await this.plugin.rescan();
							})();
						}, 600);
					}),
			);

		new Setting(containerEl).setName('Review').setHeading();
		new Setting(containerEl)
			.setName('Review folder')
			.setDesc('Where review notes are written. Leave empty for the vault root.')
			.addText((text) =>
				text
					.setPlaceholder('Reviews')
					.setValue(this.plugin.persisted.settings.reviewFolder)
					.onChange(async (value) => {
						this.plugin.persisted.settings.reviewFolder = value.trim();
						await this.plugin.savePersisted();
					}),
			);

		new Setting(containerEl).setName('Daily notes').setHeading();
		new Setting(containerEl)
			.setName('Sync completions to daily note')
			.setDesc('Append a journal line to the day’s daily note when a task is completed.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.persisted.settings.dailySync).onChange(async (value) => {
					this.plugin.persisted.settings.dailySync = value;
					await this.plugin.savePersisted();
				}),
			);
		new Setting(containerEl)
			.setName('Daily note heading')
			.setDesc('Heading the completion lines are grouped under (created if missing).')
			.addText((text) =>
				text
					.setValue(this.plugin.persisted.settings.dailySyncHeading)
					.onChange(async (value) => {
						this.plugin.persisted.settings.dailySyncHeading =
							value.replace(/^#+\s*/, '').trim() || 'Completed';
						await this.plugin.savePersisted();
					}),
			);

		new Setting(containerEl).setName('Advanced').setHeading();
		new Setting(containerEl)
			.setName('Debug performance logging')
			.setDesc('Log indexer timings to the developer console.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.persisted.settings.debugPerf).onChange(async (value) => {
					this.plugin.persisted.settings.debugPerf = value;
					await this.plugin.savePersisted();
				}),
			);
	}
}
