import { Menu } from 'obsidian';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import { selectByKeyword } from '../store/agenda';
import { selectFilterTasks } from '../store/filters';
import {
	selectWheneverTasks,
	selectAreaTasks,
	selectInboxTasks,
	selectHistoryGroups,
	selectProjectGroups,
	selectProjectSomedayTasks,
	selectSomedayTasks,
	todayISO,
} from '../store/selectors';
import type { Route } from '../store/store';
import type { CompletionEntry } from '../types';
import { LIST_META } from './components/Sidebar';
import { ObsidianIcon } from './components/ObsidianIcon';
import { TaskList, TaskRows } from './components/TaskList';
import { AgendaView } from './AgendaView';
import { DateSuggestModal } from './DateSuggestModal';
import { ReviewView } from './ReviewView';
import type { TaskFlowView } from './TaskFlowView';

interface ViewProps {
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
}

function dayLabel(day: string): string {
	const today = todayISO();
	if (day === today) return 'Today';
	const [y, m, d] = day.split('-').map(Number);
	const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function AreaView({ plugin, view, name }: ViewProps & { name: string }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const groups = useMemo(() => selectAreaTasks(tasks, projects, name), [tasks, projects, name]);
	if (groups.length === 0) return <div className="tf2-empty">No open tasks in this area.</div>;
	return (
		<div className="tf2-list">
			{groups.map(({ project, tasks: list }) => (
				<div key={project.path}>
					<div className="tf2-group-header">{project.name}</div>
					<TaskRows tasks={list} plugin={plugin} view={view} hideSource />
				</div>
			))}
		</div>
	);
}

function HistoryEntry({ entry, plugin }: { entry: CompletionEntry; plugin: TaskFlowPlugin }) {
	const projects = useStore(plugin.store, (s) => s.projects);
	const projectName = entry.project
		? (projects[entry.project]?.name ??
			entry.project.split('/').pop()?.replace(/\.md$/, ''))
		: undefined;
	return (
		<div
			className="tf2-task tf2-history-entry"
			onContextMenu={(e) => {
				e.preventDefault();
				const menu = new Menu();
				if (entry.status === 'done') {
					menu.addItem((i) =>
						i
							.setTitle('Edit date…')
							.setIcon('calendar-cog')
							.onClick(() => {
								new DateSuggestModal(plugin.app, 'Completed on', false, (date) => {
									if (date) void plugin.actions.editCompletionDate(entry.taskId, entry.completedAt, date);
								}).open();
							}),
					);
				}
				menu.addItem((i) =>
					i
						.setTitle('Remove from History')
						.setIcon('trash')
						.onClick(() => void plugin.actions.removeLogEntry(entry.taskId, entry.completedAt)),
				);
				menu.showAtMouseEvent(e.nativeEvent);
			}}>
			<ObsidianIcon
				name={entry.status === 'done' ? 'check' : 'x'}
				className={entry.status === 'done' ? 'tf2-log-done' : 'tf2-log-cancelled'}
			/>
			<div className="tf2-task-body">
				<div className="tf2-task-title is-closed">{entry.title}</div>
				{projectName && (
					<div className="tf2-task-meta">
						<span className="tf2-chip tf2-chip-source">{projectName}</span>
					</div>
				)}
			</div>
		</div>
	);
}

function HistoryView({ plugin }: ViewProps) {
	const log = useStore(plugin.store, (s) => s.log);
	const groups = useMemo(() => selectHistoryGroups(log), [log]);
	if (groups.length === 0) {
		return <div className="tf2-empty">Completed tasks will appear here.</div>;
	}
	return (
		<div className="tf2-list">
			{groups.map(({ day, entries }) => (
				<div key={day}>
					<div className="tf2-group-header">{dayLabel(day)}</div>
					{entries.map((entry, i) => (
						<HistoryEntry key={`${entry.taskId}-${entry.completedAt}-${i}`} entry={entry} plugin={plugin} />
					))}
				</div>
			))}
		</div>
	);
}

function ProjectView({ plugin, view, path }: ViewProps & { path: string }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const groups = useMemo(() => selectProjectGroups(tasks, path), [tasks, path]);
	const someday = useMemo(() => selectProjectSomedayTasks(tasks, path), [tasks, path]);
	if (groups.length === 0 && someday.length === 0)
		return <div className="tf2-empty">No open tasks.</div>;
	return (
		<div className="tf2-list">
			{groups.map(({ heading, tasks: list }) => (
				<div key={heading ?? ''}>
					{heading !== undefined && <div className="tf2-group-header">{heading}</div>}
					<TaskRows tasks={list} plugin={plugin} view={view} hideSource orderKey={`project:${path}`} />
				</div>
			))}
			{someday.length > 0 && (
				<div className="tf2-project-someday">
					<div className="tf2-group-header">Someday</div>
					<TaskRows tasks={someday} plugin={plugin} view={view} hideSource />
				</div>
			)}
		</div>
	);
}

export function contentTitle(route: Route, plugin: TaskFlowPlugin): { title: string; icon: string } {
	if (route.kind === 'agenda') {
		return { title: 'Agenda', icon: 'calendar-days' };
	}
	if (route.kind === 'project') {
		const project = plugin.store.getState().projects[route.path];
		return { title: project?.name ?? route.path, icon: 'circle-dashed' };
	}
	if (route.kind === 'filter') {
		const filter = plugin.store.getState().filters.find((f) => f.id === route.id);
		return { title: filter?.name ?? 'Filter', icon: filter?.icon ?? 'filter' };
	}
	if (route.kind === 'area') {
		return { title: route.name, icon: 'folder' };
	}
	if (route.kind === 'review') {
		return { title: 'Review', icon: 'clipboard-check' };
	}
	const meta = LIST_META.find((m) => m.list === route.list);
	return { title: meta?.label ?? '', icon: meta?.icon ?? 'list' };
}

export function Content({ plugin, view }: ViewProps) {
	const route = useStore(plugin.store, (s) => s.route);
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const filters = useStore(plugin.store, (s) => s.filters);

	if (route.kind === 'agenda') {
		return <AgendaView plugin={plugin} view={view} />;
	}
	if (route.kind === 'project') {
		return <ProjectView plugin={plugin} view={view} path={route.path} />;
	}
	if (route.kind === 'area') {
		return <AreaView plugin={plugin} view={view} name={route.name} />;
	}
	if (route.kind === 'review') {
		return <ReviewView plugin={plugin} />;
	}
	if (route.kind === 'filter') {
		const filter = filters.find((f) => f.id === route.id);
		if (!filter) return <div className="tf2-empty">Filter not found.</div>;
		return (
			<TaskList
				tasks={selectFilterTasks(tasks, filter, projects, todayISO())}
				plugin={plugin}
				view={view}
				emptyMessage="No tasks match this filter."
			/>
		);
	}
	switch (route.list) {
		case 'history':
			return <HistoryView plugin={plugin} view={view} />;
		case 'inbox':
			return (
				<TaskList
					tasks={selectInboxTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:inbox"
					emptyMessage="Inbox is empty."
				/>
			);
		case 'whenever':
			return (
				<TaskList
					tasks={selectWheneverTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:whenever"
					emptyMessage="No unscheduled tasks in active projects."
				/>
			);
		case 'someday':
			return (
				<TaskList
					tasks={selectSomedayTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:someday"
					emptyMessage="No someday tasks."
				/>
			);
		case 'next':
			return (
				<TaskList
					tasks={selectByKeyword(tasks, 'NEXT')}
					plugin={plugin}
					view={view}
					orderKey="list:next"
					emptyMessage="No NEXT actions. Mark a task NEXT to shortlist it."
				/>
			);
		case 'waiting':
			return (
				<TaskList
					tasks={selectByKeyword(tasks, 'WAITING')}
					plugin={plugin}
					view={view}
					orderKey="list:waiting"
					emptyMessage="Nothing is WAITING on anyone."
				/>
			);
	}
}
