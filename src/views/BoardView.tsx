import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import {
	applyManualOrder,
	selectProjectGroups,
	selectProjectSomedayTasks,
} from '../store/selectors';
import { own } from '../utils';
import { TaskItem } from './components/TaskItem';
import type { TaskFlowView } from './TaskFlowView';

/**
 * Kanban layout for a project: columns are the project's headings, dragging a
 * card between columns moves the task line under the target heading.
 */
export function BoardView({
	plugin,
	view,
	path,
}: {
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	path: string;
}) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const orders = useStore(plugin.store, (s) => s.orders);
	// Same manual order the project's list view uses, so both layouts agree.
	const groups = useMemo(
		() =>
			selectProjectGroups(tasks, path).map((g) => ({
				...g,
				tasks: applyManualOrder(g.tasks, own(orders, `project:${path}`)),
			})),
		[tasks, orders, path],
	);
	const someday = useMemo(() => selectProjectSomedayTasks(tasks, path), [tasks, path]);
	const [dragId, setDragId] = useState<string | null>(null);

	if (groups.length === 0 && someday.length === 0) {
		return <div className="tf2-empty">No open tasks.</div>;
	}

	const dropOn = (heading: string | undefined) => {
		if (dragId) void plugin.actions.moveToHeading(dragId, heading);
		setDragId(null);
	};

	// Dropping onto Someday sends the task there instead of relocating it
	// under a heading; any card draggable into it is guaranteed not already
	// someday (selectProjectGroups excludes someday tasks from its columns),
	// so this can only ever turn it on, never accidentally toggle it off.
	const dropOnSomeday = () => {
		if (dragId) void plugin.actions.toggleSomeday(dragId);
		setDragId(null);
	};

	const column = (
		key: string,
		heading: string | undefined,
		list: typeof groups[number]['tasks'],
		dimmed = false,
	) => (
		<div
			key={key}
			className={`tf2-board-column ${dimmed ? 'is-dimmed' : ''}`}
			onDragOver={(e) => {
				if (dragId) e.preventDefault();
			}}
			onDrop={(e) => {
				e.preventDefault();
				if (dimmed) dropOnSomeday();
				else dropOn(heading);
			}}
		>
			<div className="tf2-board-column-header">
				{heading ?? 'No heading'}
				<span className="tf2-nav-count">{list.length}</span>
			</div>
			{list.map((t) => (
				<div
					key={t.id}
					draggable={!dimmed}
					className={dragId === t.id ? 'tf2-dragging' : ''}
					onDragStart={() => setDragId(t.id)}
					onDragEnd={() => setDragId(null)}
				>
					<TaskItem task={t} plugin={plugin} view={view} hideSource />
				</div>
			))}
		</div>
	);

	return (
		<div className="tf2-board">
			{groups.map(({ heading, tasks: list }) => column(`h:${heading ?? ''}`, heading, list))}
			{someday.length > 0 && column('__someday__', 'Someday', someday, true)}
		</div>
	);
}
