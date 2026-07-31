import { Menu, Notice } from 'obsidian';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../../main';
import { selectByKeyword } from '../../store/agenda';
import { selectFilterTasks } from '../../store/filters';
import {
	projectProgress,
	selectAreaGroups,
	selectInboxTasks,
	selectTodayTasks,
	todayISO,
} from '../../store/selectors';
import type { ListId, Route } from '../../store/store';
import type { ProjectInfo, SavedFilter } from '../../types';
import { FilterModal } from '../FilterModal';
import { QuickFindModal } from '../QuickFindModal';
import { ObsidianIcon } from './ObsidianIcon';
import { ProgressPie } from './ProgressPie';

export const LIST_META: { list: ListId; label: string; icon: string }[] = [
	{ list: 'inbox', label: 'Inbox', icon: 'inbox' },
	{ list: 'today', label: 'Today', icon: 'sun' },
	{ list: 'next', label: 'Next', icon: 'chevrons-right' },
	{ list: 'upcoming', label: 'Upcoming', icon: 'calendar' },
	{ list: 'waiting', label: 'Waiting', icon: 'pause-circle' },
	{ list: 'whenever', label: 'Whenever', icon: 'list-todo' },
	{ list: 'someday', label: 'Someday', icon: 'archive' },
	{ list: 'history', label: 'History', icon: 'history' },
];

function routeIsList(route: Route, list: ListId): boolean {
	return route.kind === 'list' && route.list === list;
}

export function Sidebar({
	plugin,
	onNavigate,
}: {
	plugin: TaskFlowPlugin;
	onNavigate?: () => void;
}) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const filters = useStore(plugin.store, (s) => s.filters);
	const route = useStore(plugin.store, (s) => s.route);
	const setRoute = useStore(plugin.store, (s) => s.setRoute);
	const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});

	const counts = useMemo(() => {
		const today = todayISO();
		return {
			inbox: selectInboxTasks(tasks).length,
			today: selectTodayTasks(tasks, today).length,
			next: selectByKeyword(tasks, 'NEXT').length,
			waiting: selectByKeyword(tasks, 'WAITING').length,
			// The agenda badge counts today's items, not the whole span — a
			// week's worth of numbers next to a nav row means nothing.
			agenda: selectTodayTasks(tasks, today).length,
		};
	}, [tasks]);

	const areaGroups = useMemo(() => selectAreaGroups(projects), [projects]);

	const go = (r: Route) => {
		setRoute(r);
		onNavigate?.();
	};

	const projectRow = (p: ProjectInfo, dimmed = false) => (
		<button
			key={p.path}
			className={`tf2-nav-row tf2-nav-project ${dimmed ? 'is-dimmed' : ''} ${
				route.kind === 'project' && route.path === p.path ? 'is-active' : ''
			}`}
			onClick={() => go({ kind: 'project', path: p.path })}
		>
			<ProgressPie fraction={projectProgress(tasks, p.path)} />
			<span className="tf2-nav-label">{p.name}</span>
		</button>
	);

	return (
		<nav className="tf2-sidebar">
			<button
				className="tf2-nav-row tf2-nav-quickfind"
				onClick={() => {
					onNavigate?.();
					new QuickFindModal(plugin).open();
				}}
			>
				<ObsidianIcon name="search" />
				<span className="tf2-nav-label">Quick search</span>
			</button>
			{/* The agenda leads the nav: it's v2's primary view, the way the
			    six fixed lists were v1's. */}
			<button
				className={`tf2-nav-row tf2-nav-agenda ${route.kind === 'agenda' ? 'is-active' : ''}`}
				onClick={() => go({ kind: 'agenda' })}
			>
				<ObsidianIcon name="calendar-days" className="tf2-list-icon-agenda" />
				<span className="tf2-nav-label">Agenda</span>
				{counts.agenda > 0 && <span className="tf2-nav-count">{counts.agenda}</span>}
			</button>
			{LIST_META.map(({ list, label, icon }) => (
				<button
					key={list}
					className={`tf2-nav-row tf2-nav-${list} ${routeIsList(route, list) ? 'is-active' : ''}`}
					onClick={() => go({ kind: 'list', list })}
				>
					<ObsidianIcon name={icon} className={`tf2-list-icon-${list}`} />
					<span className="tf2-nav-label">{label}</span>
					{list === 'inbox' && counts.inbox > 0 && (
						<span className="tf2-nav-count">{counts.inbox}</span>
					)}
					{list === 'today' && counts.today > 0 && (
						<span className="tf2-nav-count">{counts.today}</span>
					)}
					{list === 'next' && counts.next > 0 && (
						<span className="tf2-nav-count">{counts.next}</span>
					)}
					{list === 'waiting' && counts.waiting > 0 && (
						<span className="tf2-nav-count">{counts.waiting}</span>
					)}
				</button>
			))}

			<button
				className={`tf2-nav-row tf2-nav-review ${route.kind === 'review' ? 'is-active' : ''}`}
				onClick={() => go({ kind: 'review' })}
			>
				<ObsidianIcon name="clipboard-check" className="tf2-list-icon-review" />
				<span className="tf2-nav-label">Review</span>
			</button>

			<div className="tf2-nav-divider" />

			{filters.map((filter) => (
				<FilterRow
					key={filter.id}
					filter={filter}
					plugin={plugin}
					active={route.kind === 'filter' && route.id === filter.id}
					count={selectFilterTasks(tasks, filter, projects, todayISO()).length}
					onClick={() => go({ kind: 'filter', id: filter.id })}
				/>
			))}
			<button
				className="tf2-nav-row tf2-nav-new-filter"
				onClick={() => new FilterModal(plugin).open()}
			>
				<ObsidianIcon name="plus" />
				<span className="tf2-nav-label">New filter</span>
			</button>

			{(areaGroups.areas.length > 0 ||
				areaGroups.standalone.length > 0 ||
				areaGroups.someday.length > 0) && <div className="tf2-nav-divider" />}

			{areaGroups.areas.map(({ name, projects: areaProjects }) => {
				const collapsed = collapsedAreas[name] ?? false;
				return (
					<div key={name} className="tf2-nav-area">
						<div
							className={`tf2-nav-row tf2-nav-area-header ${
								route.kind === 'area' && route.name === name ? 'is-active' : ''
							}`}
						>
							<button
								className="tf2-nav-chevron"
								aria-label={collapsed ? 'Expand area' : 'Collapse area'}
								onClick={() => setCollapsedAreas((c) => ({ ...c, [name]: !collapsed }))}
							>
								<ObsidianIcon name={collapsed ? 'chevron-right' : 'chevron-down'} />
							</button>
							<button
								className="tf2-nav-area-name"
								onClick={() => go({ kind: 'area', name })}
							>
								<span className="tf2-nav-label">{name}</span>
							</button>
						</div>
						{!collapsed && areaProjects.map((p) => projectRow(p))}
					</div>
				);
			})}

			{areaGroups.standalone.map((p) => projectRow(p))}
			{areaGroups.someday.map((p) => projectRow(p, true))}

			<div className="tf2-sidebar-version">
				<span>TaskFlow v{bundleVersion(plugin)}</span>
				<button
					className="tf2-reload"
					aria-label="Reload TaskFlow"
					title="Reload TaskFlow"
					onClick={() => void reloadPlugin(plugin)}
				>
					<ObsidianIcon name="refresh-cw" />
				</button>
			</div>
		</nav>
	);
}

/**
 * The build-time version baked in by esbuild, falling back to the manifest if
 * a bundler ever misses the define — a missing constant must never crash the UI.
 */
function bundleVersion(plugin: TaskFlowPlugin): string {
	try {
		return __TASKFLOW_VERSION__;
	} catch {
		return plugin.manifest.version;
	}
}

/** Disable + re-enable the plugin — Obsidian re-reads main.js from disk. */
async function reloadPlugin(plugin: TaskFlowPlugin): Promise<void> {
	// app.plugins is an internal (undocumented) API; fail with a message
	// rather than a broken sidebar if a future Obsidian changes it.
	try {
		const manager = (
			plugin.app as unknown as {
				plugins?: {
					disablePlugin?: (id: string) => Promise<void>;
					enablePlugin?: (id: string) => Promise<void>;
					loadManifests?: () => Promise<void>;
				};
			}
		).plugins;
		if (!manager?.disablePlugin || !manager.enablePlugin) throw new Error('plugin API unavailable');
		const id = plugin.manifest.id;
		await manager.disablePlugin(id);
		// Refresh the manifest registry (cached at app launch) so manifest-based
		// version displays elsewhere in Obsidian update too.
		await manager.loadManifests?.();
		await manager.enablePlugin(id);
	} catch (e) {
		new Notice('TaskFlow: reload failed — toggle the plugin in Settings instead.');
		console.error('TaskFlow reload failed', e);
	}
}

function FilterRow({
	filter,
	plugin,
	active,
	count,
	onClick,
}: {
	filter: SavedFilter;
	plugin: TaskFlowPlugin;
	active: boolean;
	count: number;
	onClick: () => void;
}) {
	return (
		<button
			className={`tf2-nav-row tf2-nav-filter ${active ? 'is-active' : ''}`}
			onClick={onClick}
			onContextMenu={(e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((i) =>
					i.setTitle('Edit filter…').setIcon('pencil').onClick(() => {
						new FilterModal(plugin, filter).open();
					}),
				);
				menu.addItem((i) =>
					i.setTitle('Delete filter').setIcon('trash').onClick(() => {
						void plugin.actions.deleteFilter(filter.id);
					}),
				);
				menu.showAtMouseEvent(e.nativeEvent);
			}}
		>
			<ObsidianIcon name={filter.icon ?? 'filter'} className="tf2-list-icon-filter" />
			<span className="tf2-nav-label">{filter.name}</span>
			{count > 0 && <span className="tf2-nav-count">{count}</span>}
		</button>
	);
}
