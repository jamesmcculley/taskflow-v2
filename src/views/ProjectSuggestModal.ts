import { FuzzySuggestModal } from 'obsidian';
import type TaskFlowPlugin from '../main';

export interface ProjectChoice {
	/** null = Inbox */
	path: string | null;
	name: string;
}

export class ProjectSuggestModal extends FuzzySuggestModal<ProjectChoice> {
	constructor(
		private plugin: TaskFlowPlugin,
		private onChoose: (choice: ProjectChoice) => void,
	) {
		super(plugin.app);
		this.setPlaceholder('Move to project…');
	}

	override getItems(): ProjectChoice[] {
		const projects = Object.values(this.plugin.store.getState().projects).sort(
			(a, b) =>
				(a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) ||
				a.name.localeCompare(b.name),
		);
		return [
			{ path: null, name: 'Inbox' },
			...projects.map((p) => ({ path: p.path, name: p.name })),
		];
	}

	override getItemText(item: ProjectChoice): string {
		return item.name;
	}

	override onChooseItem(item: ProjectChoice): void {
		this.onChoose(item);
	}
}
