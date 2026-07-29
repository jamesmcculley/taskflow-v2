# Design note: making markdown the source of truth for completions

Status: **proposed**, not scheduled. Written 2026-07-29.
Natural home is v2.1, which already has to parse `LOGBOOK` for clocking.

## The claim

TaskFlow's stated architecture is "markdown is the source of truth; the index
owns only sort order, completion history, and recurrence bookkeeping." For
completion *times* that is no longer accurate. v2 writes the real completion
instant into markdown and then ignores it, keeping `data.json` as the only
timestamp it reads.

## Why v1 had to own the timestamp

v1's completion stamp was `✅ 2026-07-15` — a date with no time. Anything
time-of-day (the daily journal's `HH:mm`, History ordering within a day, Stats)
had to come from somewhere else, so `persisted.completedAt` became authoritative
and the markdown stamp was a lossy mirror of it.

**That constraint is gone.** Org's inactive stamp carries a time, and v2 writes
one on every completion (`actions.ts:112`):

```
CLOSED: [2026-07-15 Wed 14:32]
```

## What the code actually does today

Written but not read:

- `indexer.ts:272` takes `stampDate: org.closed?.date` — the date, never the time.
- `findStampDrift` compares only the local day.
- The sole read of `closed.time` is `actions.ts:368`, and only to *preserve* it
  while editing the date. No consumer anywhere.
- `indexer.ts:425` backfills a missing stamp as `inactiveStamp(today, '00:00')` —
  a v1-shaped timeless stamp in a format that carries time, for a completion
  whose real instant the plugin has in hand.

`LOGBOOK` is write-only in the same way. `appendLogbookEntry` emits org's own
`- State "DONE" from "TODO" [stamp]` for each occurrence of a repeating task;
the parser keeps `logbook: string[]` verbatim and the serializer re-emits it,
but nothing ever parses those lines back into structured data. `serialize.ts:107`
describes the logbook as "the only in-file record" — true, and the tell: a
repeat's history exists in markdown *and* in `data.json`, and only the copy the
user can't see is read.

So there are three records of one completion — `CLOSED`/`LOGBOOK`, the index
log, and the daily-note journal line — with the authoritative one being the
least visible.

## What changes if markdown wins

Derive History and Stats from `CLOSED` (single completions) and `LOGBOOK`
(occurrences of repeats), and:

- `persisted.completedAt` stops being authoritative. It becomes a cache, or goes.
- `findStampDrift` and `applyStampDrift` can be **deleted outright**. Drift is
  definitionally impossible with one copy — the entire mechanism exists to
  reconcile two.
- `findUnloggedCompletions` shrinks to stamp backfill. A hand-typed `DONE` with
  no `CLOSED:` line still needs a stamp written, but there's no separate log to
  reconcile it against afterward.
- `reconcileLog`'s todo-reversion pruning becomes free: revert `DONE` to `TODO`
  in the note and the completion is *gone*, with no second copy to prune.
- `editCompletionDate` becomes an ordinary block edit rather than a three-way
  update across markdown, log, and journal.

That removes most of the machinery added in v1 0.13.0 – 0.14.0, all of which
were drift bugs between copies rather than bugs in any one copy.

## Why it isn't a pure deletion

Three things `data.json` does that markdown cannot:

1. **Deleted tasks.** The log survives deletion of the task's lines. Reading
   history from markdown means deleting a note deletes its history. This is the
   real blocker and it needs a decision: either accept it (markdown is the
   source of truth, including its absences), or keep the log as an append-only
   archive that markdown can add to but never silently remove from.
2. **Migrated v1 completions.** `convert.ts:97` writes `00:00` because v1's `✅`
   had no time to convert. Those stamps are genuinely lossy, and their real
   timestamps exist only in `data.json`. Any migration has to treat a `00:00`
   stamp as "date-only, defer to the index" rather than "completed at midnight".
3. **Cross-file ordering and project-at-completion-time.** `CompletionEntry`
   records the project a task belonged to *when it was completed*; markdown only
   knows where the task lives now.

## Suggested shape

Not a flag day. Three steps, each shippable alone:

1. **Stop writing timeless stamps.** Backfill with the real instant instead of
   `'00:00'`, and have `findUnloggedCompletions` use the stamp's time when the
   stamp has one. Small, no behaviour change for existing data.
2. **Parse `LOGBOOK` into structured entries.** v2.1's clocking work needs this
   for `CLOCK:` lines anyway; doing state-change lines at the same time makes a
   repeat's occurrence history readable from the file.
3. **Flip the read path** for History and Stats, keeping `data.json` as an
   archive for entries with no live markdown counterpart (deleted tasks,
   `00:00`-stamped migrated ones). Then delete the drift machinery.

Step 1 is worth doing regardless of whether 2 and 3 ever happen: writing a
deliberately timeless stamp into a format that carries time is a straight
v1 carryover with no argument for it.

## Not in scope

The daily-note journal (`- ✅ HH:mm … %%id%%`) is a *third* copy, but it's a
different surface with its own purpose — completions visible in the daily note —
and cutting it isn't part of this. Two notes on it: the `✅` is off-idiom in an
Org plugin, and `JOURNAL_LINE_RE` is load-bearing for removal and the orphan
cleanup, so changing the line format requires migrating existing lines.
