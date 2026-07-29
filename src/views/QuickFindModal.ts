import { FuzzySuggestModal } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { isSomedayTask } from '../store/selectors';
import type { Route } from '../store/store';
import { LIST_META } from './components/Sidebar';

interface FindChoice {
	label: string;
	go: () => void;
}

/** Quick search: fuzzy search over lists, filters, areas, projects, tasks. */
export class QuickFindModal extends FuzzySuggestModal<FindChoice> {
	constructor(private plugin: TaskFlowPlugin) {
		super(plugin.app);
		this.setPlaceholder('Quick search — lists, projects, areas, tasks…');
	}

	override getItems(): FindChoice[] {
		const state = this.plugin.store.getState();
		const goTo = (route: Route, selectId: string | null = null) => {
			state.setRoute(route);
			state.select(selectId);
		};

		const lists: FindChoice[] = [
			...LIST_META.map(({ list, label }) => ({
				label,
				go: () => goTo({ kind: 'list', list }),
			})),
			{ label: 'Stats', go: () => goTo({ kind: 'list', list: 'stats' }) },
			{ label: 'Review', go: () => goTo({ kind: 'review' }) },
		];
		const filters: FindChoice[] = state.filters.map((f) => ({
			label: `${f.name} (filter)`,
			go: () => goTo({ kind: 'filter', id: f.id }),
		}));
		const projects = Object.values(state.projects);
		const areas: FindChoice[] = [...new Set(projects.flatMap((p) => (p.area ? [p.area] : [])))].map(
			(area) => ({
				label: `${area} (area)`,
				go: () => goTo({ kind: 'area', name: area }),
			}),
		);
		const projectChoices: FindChoice[] = projects.map((p) => ({
			label: `${p.name} (project)`,
			go: () => goTo({ kind: 'project', path: p.path }),
		}));
		const tasks: FindChoice[] = Object.values(state.tasks)
			.filter((t) => t.status === 'todo')
			.map((t) => {
				const projectName = t.project?.split('/').pop()?.replace(/\.md$/, '');
				const route: Route = t.project
					? { kind: 'project', path: t.project }
					: isSomedayTask(t)
						? { kind: 'list', list: 'someday' }
						: { kind: 'list', list: 'inbox' };
				return {
					label: projectName ? `${t.title} — ${projectName}` : t.title,
					go: () => goTo(route, t.id),
				};
			});

		return [...lists, ...filters, ...areas, ...projectChoices, ...tasks];
	}

	override getItemText(item: FindChoice): string {
		return item.label;
	}

	override onChooseItem(item: FindChoice): void {
		item.go();
	}
}
