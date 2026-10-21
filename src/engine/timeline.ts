// What a finished run actually looked like, for History's timeline: when each
// task was done, against what it was planned to take.
import { allDoneAt, foldRun } from './run';
import { MINUTE } from './time';
import type { Run, Task } from './types';

export interface TimelineRow {
  task: Task;
  status: 'done' | 'skipped' | 'notDone';
  /** When you did it (done tasks only). Batched taps are spread out, as everywhere else. */
  start?: number;
  end?: number;
  /** What it was planned to take (ms), after any change made during the run. */
  plannedMs: number;
  /** Added during the run. */
  oneOff: boolean;
  /** How long the taps made it (ms), when its time was fixed afterwards. */
  tappedMs?: number;
}

export interface Timeline {
  /** The time axis: from Start to the finish, or to the finish-by time if that's a little later. */
  from: number;
  to: number;
  /** The finish-by time, when it fits on the axis. */
  finishBy?: number;
  /** Done tasks in the order you did them, then skipped ones, then ones left undone. */
  rows: TimelineRow[];
  /** From the last task to Finish, when everything got done: time that wasn't any task's. Half a minute or more. */
  finishingUp?: { start: number; end: number };
}

export function timeline(run: Run): Timeline {
  const state = foldRun(run);
  const tapped = run.corrected ? foldRun({ ...run, corrected: undefined }).done : undefined;
  const planned = new Set(run.tasks.map((t) => t.id));
  const row = (task: Task, status: TimelineRow['status']): TimelineRow => ({
    task,
    status,
    plannedMs: task.handsOnSec * 1000,
    oneOff: !planned.has(task.id),
  });
  const done = [...state.done.values()]
    .sort((a, b) => a.start - b.start)
    .map((d) => {
      const t = run.corrected?.[d.task.id] !== undefined ? tapped?.get(d.task.id) : undefined;
      return { ...row(d.task, 'done'), start: d.start, end: d.handsOnEnd, tappedMs: t && t.handsOnEnd - t.start };
    });
  const left = state.tasks.filter((t) => !state.done.has(t.id));
  const from = run.startedAt;
  // Wide enough for every bar, every planned end, and the finish.
  const end = Math.max(
    from + MINUTE,
    run.finishedAt ?? from,
    ...done.map((d) => Math.max(d.end, d.start + d.plannedMs)),
  );
  // A finish-by time far beyond the finish would squash the bars; History says "40 min early" instead.
  const finishBy =
    run.finishBy !== undefined && run.finishBy >= from && run.finishBy <= end + (end - from) / 2
      ? run.finishBy
      : undefined;
  const doneAt = allDoneAt(state);
  const finishingUp =
    run.finishedAt !== undefined && doneAt !== undefined && run.finishedAt - doneAt >= 30_000
      ? { start: doneAt, end: run.finishedAt }
      : undefined;
  return {
    from,
    to: Math.max(end, finishBy ?? end),
    finishBy,
    finishingUp,
    rows: [
      ...done,
      ...left.filter((t) => state.skipped.has(t.id)).map((t) => row(t, 'skipped')),
      ...left.filter((t) => !state.skipped.has(t.id)).map((t) => row(t, 'notDone')),
    ],
  };
}

/** Clock times for a time axis, on round minutes (local time), at most `max` of them. */
export function clockTicks(from: number, to: number, max = 5): number[] {
  const span = (to - from) / MINUTE;
  const step = ([1, 2, 5, 10, 15, 30, 60, 120] as const).find((s) => span / s < max) ?? 240;
  const stepMs = step * MINUTE;
  const midnight = new Date(from).setHours(0, 0, 0, 0);
  const ticks: number[] = [];
  for (let t = midnight + Math.ceil((from - midnight) / stepMs) * stepMs; t <= to; t += stepMs) ticks.push(t);
  return ticks;
}
