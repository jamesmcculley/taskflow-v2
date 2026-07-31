import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { CaptureModal } from '../capture/CaptureModal';
import type TaskFlowPlugin from '../main';
import { todayISO } from '../store/selectors';
import { selectVisibleTasks } from '../store/visible';
import { own } from '../utils';
import { Content, contentTitle } from './Content';
import { ObsidianIcon } from './components/ObsidianIcon';
import { LIST_META, Sidebar } from './components/Sidebar';
import { openTaskSource } from './components/TaskItem';
import type { TaskFlowView } from './TaskFlowView';

const TWO_PANE_MIN_WIDTH = 480;

export function App({ plugin, view }: { plugin: TaskFlowPlugin; view: TaskFlowView }) {
	const route = useStore(plugin.store, (s) => s.route);
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const filters = useStore(plugin.store, (s) => s.filters);
	const setRoute = useStore(plugin.store, (s) => s.setRoute);
	const rootRef = useRef<HTMLDivElement>(null);
	const [wide, setWide] = useState(false);
	const [navOpen, setNavOpen] = useState(false);
	const selectedId = useStore(plugin.store, (s) => s.selectedId);
	const setSelectedId = useStore(plugin.store, (s) => s.select);

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const observer = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? 0;
			setWide(width >= TWO_PANE_MIN_WIDTH);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const routeKey =
		route.kind === 'list'
			? route.list
			: route.kind === 'project'
				? route.path
				: route.kind === 'filter'
					? route.id
					: route.kind === 'area'
						? route.name
						: 'review';
	const routeKeyRef = useRef(routeKey);
	useEffect(() => {
		// Reset selection on navigation — except when Quick search just set both
		// route and selection together (selection newer than the route change).
		if (routeKeyRef.current !== routeKey) {
			routeKeyRef.current = routeKey;
			if (selectedId !== null && own(plugin.store.getState().tasks, selectedId) === undefined) {
				setSelectedId(null);
			}
		}
	}, [routeKey, selectedId, setSelectedId, plugin]);

	const orders = useStore(plugin.store, (s) => s.orders);
	const visible = useMemo(
		() => selectVisibleTasks(route, { tasks, projects, filters, orders }, todayISO()),
		[route, tasks, projects, filters, orders],
	);

	const openCapture = useCallback(() => {
		if (route.kind === 'project') {
			const project = plugin.store.getState().projects[route.path];
			new CaptureModal(plugin, {
				destPath: route.path,
				destLabel: project?.name ?? route.path,
			}).open();
		} else if (route.kind === 'list' && route.list === 'today') {
			new CaptureModal(plugin, { scheduled: todayISO() }).open();
		} else {
			new CaptureModal(plugin).open();
		}
	}, [plugin, route]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		// Don't fight focused controls (Space on a checkbox or button activates
		// that control — the app-level handler must not also fire).
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			e.target instanceof HTMLButtonElement
		)
			return;
		// Bounded by LIST_META rather than a hard-coded range: the list of lists
		// has changed twice, and the range didn't follow it, so the last entries
		// silently had no shortcut.
		if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
			const meta = LIST_META[Number(e.key) - 1];
			if (meta) {
				setRoute({ kind: 'list', list: meta.list });
				e.preventDefault();
			}
			return;
		}
		if (visible.length === 0) return;
		const idx = visible.findIndex((t) => t.id === selectedId);
		if (e.key === 'ArrowDown') {
			setSelectedId(visible[idx === -1 ? 0 : Math.min(idx + 1, visible.length - 1)]?.id ?? null);
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			setSelectedId(visible[idx === -1 ? visible.length - 1 : Math.max(idx - 1, 0)]?.id ?? null);
			e.preventDefault();
		} else if (e.key === ' ' && selectedId !== null && idx !== -1) {
			const task = visible[idx];
			if (task) {
				if (task.status === 'done') void plugin.actions.uncompleteTask(task.id);
				else void plugin.actions.completeTask(task.id);
			}
			e.preventDefault();
		} else if (e.key === 'Enter' && selectedId !== null && idx !== -1) {
			const task = visible[idx];
			if (task) void openTaskSource(plugin, task);
			e.preventDefault();
		}
	};

	const { title, icon } = contentTitle(route, plugin);
	const iconClass =
		route.kind === 'list'
			? `tf2-list-icon-${route.list}`
			: route.kind === 'filter'
				? 'tf2-list-icon-filter'
				: route.kind === 'area'
					? 'tf2-list-icon-area'
					: route.kind === 'review'
						? 'tf2-list-icon-review'
						: 'tf2-list-icon-project';

	const plusButton = (
		<button className="tf2-plus" aria-label="New task" onClick={openCapture}>
			<ObsidianIcon name="plus" />
		</button>
	);

	return (
		<div
			ref={rootRef}
			className={`tf2-app ${wide ? 'is-wide' : 'is-narrow'}`}
			tabIndex={0}
			onKeyDown={onKeyDown}
		>
				{wide ? (
					<>
						<Sidebar plugin={plugin} />
						<div className="tf2-content">
							<div className="tf2-content-header">
								<ObsidianIcon name={icon} className={iconClass} />
								<h2 className="tf2-content-title">{title}</h2>
							</div>
							<Content plugin={plugin} view={view} />
							{plusButton}
						</div>
					</>
				) : (
					<>
						<div className="tf2-content-header">
							<button
								className="tf2-nav-toggle"
								aria-label="Show lists"
								onClick={() => setNavOpen((open) => !open)}
							>
								<ObsidianIcon name="menu" />
							</button>
							<ObsidianIcon name={icon} className={iconClass} />
							<h2 className="tf2-content-title">{title}</h2>
						</div>
						{navOpen ? (
							<Sidebar plugin={plugin} onNavigate={() => setNavOpen(false)} />
						) : (
							<>
								<Content plugin={plugin} view={view} />
								{plusButton}
							</>
						)}
				</>
			)}
		</div>
	);
}
