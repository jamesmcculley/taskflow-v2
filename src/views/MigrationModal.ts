import { Modal, Setting } from 'obsidian';
import type TaskFlowPlugin from '../main';
import type { MigrationReport } from '../migrate/migrate';

/**
 * The confirmation step between the dry run and the write. It shows the counts,
 * a sample of the actual before/after lines, and every caveat the report
 * turned up — because the migration rewrites files in place, and the only
 * honest way to ask for that is to show exactly what it will do first.
 */
export class MigrationModal extends Modal {
	constructor(
		private plugin: TaskFlowPlugin,
		private report: MigrationReport,
		private onConfirm: () => Promise<void>,
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		const { contentEl, report } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Migrate TaskFlow v1 → v2' });

		contentEl.createEl('p', {
			text: `${report.taskCount} task${report.taskCount === 1 ? '' : 's'} across ${report.files.length} file${report.files.length === 1 ? '' : 's'} will be rewritten from emoji tokens to Org syntax.`,
		});
		contentEl.createEl('p', {
			text: 'Every file it touches is copied into a timestamped backup folder in the vault first. Task IDs are preserved, so your history, manual sort order, and completion log carry over untouched.',
			cls: 'tf2-migration-note',
		});

		if (report.checklistItemsKept > 0) {
			contentEl.createEl('p', {
				text: `${report.checklistItemsKept} nested checklist item(s) stay as plain checkboxes — they aren't tasks in either version.`,
				cls: 'tf2-migration-note',
			});
		}

		if (report.fallbackRules.length > 0) {
			contentEl.createEl('h3', { text: 'Repeats that keep rrule text' });
			contentEl.createEl('p', {
				text: 'No org repeater expresses these, so they move to a :REPEAT: property and keep working the way they do now:',
				cls: 'tf2-migration-note',
			});
			const list = contentEl.createEl('ul');
			for (const f of report.fallbackRules.slice(0, 8)) {
				list.createEl('li', { text: `${f.rule} — ${f.title}` });
			}
			if (report.fallbackRules.length > 8) {
				list.createEl('li', { text: `…and ${report.fallbackRules.length - 8} more` });
			}
		}

		contentEl.createEl('h3', { text: 'Sample' });
		const sample = contentEl.createEl('pre', { cls: 'tf2-migration-sample' });
		let shown = 0;
		for (const file of report.files) {
			for (const task of file.tasks) {
				if (shown >= 5) break;
				sample.createEl('code', { text: `- ${task.before}\n` , cls: 'tf2-diff-before' });
				for (const after of task.after) {
					sample.createEl('code', { text: `+ ${after}\n`, cls: 'tf2-diff-after' });
				}
				sample.createEl('code', { text: '\n' });
				shown++;
			}
			if (shown >= 5) break;
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(`Convert ${report.taskCount} task${report.taskCount === 1 ? '' : 's'}`)
					.setCta()
					.onClick(async () => {
						this.close();
						await this.onConfirm();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
