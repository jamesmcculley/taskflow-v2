# Roadmap

Goal: TaskFlow v2 is an Org Mode task manager inside Obsidian — Org syntax in plain markdown, a real org-agenda over it, and a one-way migration from v1 that loses nothing.

## v2.0.0 — Org port + agenda + migration ✅

Shipped 2026-07-27. Full port of v1 (0.14.0) onto Org syntax:

**The Org layer** (`src/org/`) — TODO keywords (`TODO`/`NEXT`/`WAITING`/`SOMEDAY` | `DONE`/`CANCELLED`), timestamps with times, time ranges, and repeaters, a block parser covering the headline + planning line + `PROPERTIES`/`LOGBOOK` drawers, and a serializer that re-emits a block canonically. Every mutation is parse → mutate → re-emit.

**The agenda** — a day-spanning view with Org's own placement rules (sticky past `SCHEDULED`, `DEADLINE` warning window, one line per reason), Org's line prefixes (`Sched. 3x`, `In 4 d.`, `3 d. ago`), a span toggle, and an `org-agenda`-style single-key dispatcher.

**Ported from v1, unchanged in behaviour** — Inbox/Today/Upcoming/Whenever/Someday/History, projects and areas, pinned filters, quick capture, daily-note sync, stats, weekly review, board view, CSV export, drag-reorder, keyboard nav.

**New in v2** — `NEXT` and `WAITING` lists, keyword pills that cycle on click, keyword-aware sorting and filters, the agenda dispatcher, the `:REPEAT:` fallback for repeats no repeater expresses, and an ID-style setting.

**Migration** — dry-run report command, confirm-and-convert command with per-file backups, ID-preserving and idempotent, with `test-vault/seed-v1/` ↔ `test-vault/seed/` as a live fixture pair.

## v2.1 — Org fidelity

- **Effort and clocking**: `:EFFORT:` property with a column in the agenda; `CLOCK:` entries in the `LOGBOOK` drawer, with start/stop commands and a clocked-time total per day.
- **Tag inheritance**: tags on a project note's frontmatter apply to its tasks, as Org inherits tags down a subtree.
- **Agenda filtering in-view**: narrow the current agenda by tag, keyword, or priority without leaving it (Org's `/` filter).
- **Deadline delays** (`-2d` on a `DEADLINE`) and the `--` warning-period syntax.
- **Habits** (`:STYLE: habit`) with the consistency graph the agenda draws for them.
- **Completions read from markdown** — `CLOSED`/`LOGBOOK` become the source of truth for History and Stats instead of `data.json`, which deletes the stamp-drift machinery inherited from v1. Clocking already has to parse `LOGBOOK`, so this belongs in the same pass. See [DESIGN-completion-source-of-truth.md](DESIGN-completion-source-of-truth.md).

## v2.2 — Capture and refile

- **Capture templates**: named capture targets with a preset keyword, tags, project, and file+heading destination — Org's `org-capture` templates.
- **Refile**: move a task to any file+heading through one fuzzy picker (`org-refile`), replacing today's project-only move.
- **Archive**: move `DONE` tasks to an archive file or an `:ARCHIVE:` drawer, keeping the History log intact.

## Later / candidates

- Column view over a project's properties.
- Agenda export (plain text / ICS) for a read-only calendar subscription.
- `#+TODO:` per-file keyword sets, so a note can declare its own workflow.
- Due-task reminders via OS notifications — desktop only, and only while Obsidian is running.
- List virtualization for very large agendas and Histories.
- A reverse (v2 → v1) converter, if anyone ever needs to go back.
