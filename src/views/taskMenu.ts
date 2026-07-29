import { Menu } from 'obsidian';
import type TaskFlowPlugin from '../main';
import type { Task } from '../types';
import { DateSuggestModal } from './DateSuggestModal';
import { KeywordSuggestModal } from './KeywordSuggestModal';
import { ProjectSuggestModal } from './ProjectSuggestModal';

export function showTaskMenu(plugin: TaskFlowPlugin, task: Task, evt: MouseEvent): void {
	const menu = new Menu();
	const actions = plugin.actions;

	if (task.status === 'todo') {
		menu.addItem((i) =>
			i.setTitle('Complete').setIcon('check').onClick(() => void actions.completeTask(task.id)),
		);
		menu.addItem((i) =>
			i
				.setTitle('Complete on date…')
				.setIcon('calendar-check-2')
				.onClick(() => {
					new DateSuggestModal(plugin.app, 'Completed on', false, (date) => {
						if (date) void actions.completeTask(task.id, date);
					}).open();
				}),
		);
	} else {
		menu.addItem((i) =>
			i
				.setTitle('Mark as todo')
				.setIcon('undo')
				.onClick(() => void actions.uncompleteTask(task.id)),
		);
	}

	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle('Schedule today')
			.setIcon('calendar-check')
			.onClick(() => void actions.scheduleTask(task.id, 'today')),
	);
	menu.addItem((i) =>
		i
			.setTitle('Schedule tomorrow')
			.setIcon('calendar-plus')
			.onClick(() => void actions.scheduleTask(task.id, 'tomorrow')),
	);
	menu.addItem((i) =>
		i
			.setTitle('When…')
			.setIcon('calendar-days')
			.onClick(() => {
				new DateSuggestModal(plugin.app, 'Schedule', task.scheduled !== undefined, (date) => {
					void actions.scheduleTask(task.id, date);
				}).open();
			}),
	);
	menu.addItem((i) =>
		i
			.setTitle('Deadline…')
			.setIcon('flag')
			.onClick(() => {
				new DateSuggestModal(plugin.app, 'Deadline', task.due !== undefined, (date) => {
					void actions.setDue(task.id, date);
				}).open();
			}),
	);
	if (task.scheduled) {
		menu.addItem((i) =>
			i
				.setTitle('Clear scheduled date')
				.setIcon('calendar-x')
				.onClick(() => void actions.scheduleTask(task.id, null)),
		);
	}

	menu.addItem((i) =>
		i
			.setTitle(task.evening ? 'Move out of Tonight' : 'Tonight')
			.setIcon('moon')
			.onClick(() => void actions.toggleEvening(task.id)),
	);
	menu.addItem((i) =>
		i
			.setTitle(task.someday ? 'Remove from Someday' : 'Someday')
			.setIcon('archive')
			.onClick(() => void actions.toggleSomeday(task.id)),
	);

	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle('Set keyword…')
			.setIcon('list-checks')
			.onClick(() => {
				new KeywordSuggestModal(plugin.app, (keyword) => {
					void actions.setKeyword(task.id, keyword);
				}).open();
			}),
	);
	// Org's three priority cookies, each toggling itself off when re-picked.
	for (const [rank, cookie] of [
		[1, 'A'],
		[2, 'B'],
		[3, 'C'],
	] as const) {
		menu.addItem((i) =>
			i
				.setTitle(task.priority === rank ? `Clear priority [#${cookie}]` : `Priority [#${cookie}]`)
				.setIcon('flag')
				.onClick(() => void actions.setTaskPriority(task.id, task.priority === rank ? null : rank)),
		);
	}

	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle('Move to project…')
			.setIcon('folder-input')
			.onClick(() => {
				new ProjectSuggestModal(plugin, (choice) => {
					void actions.moveToProject(task.id, choice.path);
				}).open();
			}),
	);

	if (task.status !== 'cancelled') {
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle('Cancel task').setIcon('x').onClick(() => void actions.cancelTask(task.id)),
		);
	}

	menu.showAtMouseEvent(evt);
}
