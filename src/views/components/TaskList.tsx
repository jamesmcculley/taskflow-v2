import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../../main';
import { applyManualOrder } from '../../store/selectors';
import type { Task } from '../../types';
import { own } from '../../utils';
import type { TaskFlowView } from '../TaskFlowView';
import { TaskItem } from './TaskItem';

const LINGER_MS = 1600;

interface LingerEntry {
	task: Task;
	index: number;
}

/**
 * Keeps just-completed tasks visible (checked, fading) for a moment before
 * they leave the list — a brief completion linger.
 */
function useLingeringTasks(
	tasks: Task[],
	plugin: TaskFlowPlugin,
): { merged: Task[]; lingerIds: Set<string> } {
	const [linger, setLinger] = useState<LingerEntry[]>([]);
	const prevRef = useRef<Task[]>(tasks);
	const timersRef = useRef<number[]>([]);
	const allTasks = useStore(plugin.store, (s) => s.tasks);

	useEffect(() => {
		const timers = timersRef.current;
		return () => timers.forEach((t) => window.clearTimeout(t));
	}, []);

	useEffect(() => {
		const prev = prevRef.current;
		prevRef.current = tasks;
		const currentIds = new Set(tasks.map((t) => t.id));
		const departed = prev
			.map((t, index) => ({ task: own(allTasks, t.id) ?? t, index }))
			.filter(({ task }) => !currentIds.has(task.id) && task.status !== 'todo');
		if (departed.length === 0) return;
		setLinger((l) => [...l, ...departed.filter((d) => !l.some((x) => x.task.id === d.task.id))]);
		const ids = departed.map((d) => d.task.id);
		timersRef.current.push(
			window.setTimeout(
				() => setLinger((l) => l.filter((x) => !ids.includes(x.task.id))),
				LINGER_MS,
			),
		);
	}, [tasks, allTasks]);

	const merged = [...tasks];
	const lingerIds = new Set<string>();
	for (const { task, index } of linger) {
		if (merged.some((t) => t.id === task.id)) continue;
		merged.splice(Math.min(index, merged.length), 0, task);
		lingerIds.add(task.id);
	}
	return { merged, lingerIds };
}

interface TaskRowsProps {
	tasks: Task[];
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	hideSource?: boolean;
	/** Presence enables drag-reorder, scoped to this key (e.g. "list:today"). */
	orderKey?: string;
	/** Rendered when there are no rows (including lingering ones). */
	emptyMessage?: string;
}

/** The shared row renderer: completion linger + optional drag-and-drop reorder. */
export function TaskRows({
	tasks,
	plugin,
	view,
	hideSource,
	orderKey,
	emptyMessage,
}: TaskRowsProps) {
	const orders = useStore(plugin.store, (s) => s.orders);
	const ordered = orderKey !== undefined ? applyManualOrder(tasks, own(orders, orderKey)) : tasks;
	const { merged, lingerIds } = useLingeringTasks(ordered, plugin);
	const [dragId, setDragId] = useState<string | null>(null);
	const reorderable = orderKey !== undefined;

	if (merged.length === 0) {
		return emptyMessage ? <div className="tf2-empty">{emptyMessage}</div> : null;
	}

	const dropOn = (targetId: string) => {
		if (!dragId || dragId === targetId || orderKey === undefined) return;
		const ids = ordered.map((t) => t.id);
		const from = ids.indexOf(dragId);
		const to = ids.indexOf(targetId);
		if (from === -1 || to === -1) return;
		ids.splice(to, 0, ...ids.splice(from, 1));
		void plugin.actions.reorderTasks(orderKey, ids);
	};

	return (
		<>
			{merged.map((task) => (
				<div
					key={task.id}
					draggable={reorderable && !lingerIds.has(task.id)}
					className={dragId === task.id ? 'tf2-dragging' : ''}
					onDragStart={() => setDragId(task.id)}
					onDragEnd={() => setDragId(null)}
					onDragOver={(e) => {
						if (dragId) e.preventDefault();
					}}
					onDrop={(e) => {
						e.preventDefault();
						dropOn(task.id);
						setDragId(null);
					}}
				>
					<TaskItem
						task={task}
						plugin={plugin}
						view={view}
						hideSource={hideSource}
						lingering={lingerIds.has(task.id)}
					/>
				</div>
			))}
		</>
	);
}

export function TaskList(props: TaskRowsProps & { emptyMessage: string }) {
	return (
		<div className="tf2-list">
			<TaskRows {...props} />
		</div>
	);
}
