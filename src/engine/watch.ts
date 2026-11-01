// What the phone sends the watch: a snapshot of the active run in absolute
// times. The watch never runs the scheduler; it counts down from these times
// with its own clock (see docs/pixel-watch-spec.md).
import { allDoneAt, foldRun, lastUndoable, projectState } from './run';
import type { Slot } from './simulate';
import type { Id, Run } from './types';

/** Bump when the shape changes in a way an older watch app can't read. */
export const WATCH_PROTOCOL = 1;

/** How many tasks after the current one the watch gets for Up next. */
export const WATCH_UPCOMING = 8;

export interface WatchTask {
  taskId: Id;
  name: string;
  start: number;
  plannedMs: number;
}

export interface WatchRun {
  id: Id;
  flowName: string;
  finishBy?: number;
  /**
   * The projected finish if the current task ends on plan. The watch adds any
   * overrun: Finish at = finishIfOnTime + max(0, now − (current.start + plannedMs)).
   */
  finishIfOnTime: number;
  /** The last event in the run's log (undo events included). */
  lastEventId?: Id;
  /**
   * The last watch command the phone has dealt with for this run, applied or not
   * (an Undo with nothing to undo adds no event). The watch drops it and every
   * command queued before it.
   */
  ackCmdId?: Id;
  canUndo: boolean;
  state: 'task' | 'idle' | 'finishingUp';
  /** The task you're on (state 'task'). */
  current?: WatchTask;
  /** What starts next and when, while nothing is ready yet (state 'idle'). */
  next?: { name: string; start: number };
  /** Tasks after the current one, start times as if it ends on plan; the watch shifts them by any overrun. */
  upcoming: WatchTask[];
  /** When everything got done (state 'finishingUp'). */
  doneAt?: number;
}

export interface WatchSnapshot {
  v: number;
  sentAt: number;
  run: WatchRun | null;
}

const toWatchTask = (s: Slot): WatchTask => ({
  taskId: s.task.id,
  name: s.task.name,
  start: s.start,
  plannedMs: s.task.handsOnSec * 1000,
});

export function watchSnapshot(run: Run | undefined, now: number, ackCmdId?: Id): WatchSnapshot {
  if (!run || run.finishedAt !== undefined) return { v: WATCH_PROTOCOL, sentAt: now, run: null };

  const state = foldRun(run);
  const p = projectState(state, now);
  const doneAt = allDoneAt(state);
  const base = {
    id: run.id,
    flowName: run.flowName,
    ...(run.finishBy !== undefined && { finishBy: run.finishBy }),
    ...(run.events.length > 0 && { lastEventId: run.events.at(-1)!.id }),
    ...(ackCmdId !== undefined && { ackCmdId }),
    canUndo: lastUndoable(run) !== undefined,
  };

  if (p.allDone) {
    const at = doneAt ?? now;
    return {
      v: WATCH_PROTOCOL,
      sentAt: now,
      run: { ...base, state: 'finishingUp', finishIfOnTime: at, upcoming: [], doneAt: at },
    };
  }

  if (!p.current) {
    const first = p.upcoming[0]!;
    return {
      v: WATCH_PROTOCOL,
      sentAt: now,
      run: {
        ...base,
        state: 'idle',
        finishIfOnTime: p.outTheDoor,
        next: { name: first.task.name, start: first.start },
        upcoming: p.upcoming.slice(0, WATCH_UPCOMING).map(toWatchTask),
      },
    };
  }

  // Project from the moment the current task started: then it can't be over,
  // and everything after it sits where it would if it ends on plan.
  const onPlan = projectState(state, p.current.start);
  return {
    v: WATCH_PROTOCOL,
    sentAt: now,
    run: {
      ...base,
      state: 'task',
      finishIfOnTime: onPlan.outTheDoor,
      current: toWatchTask(p.current),
      upcoming: onPlan.upcoming.slice(1, WATCH_UPCOMING + 1).map(toWatchTask),
    },
  };
}

/** Finish at as the watch works it out, for tests and the phone's own checks. */
export function watchFinishAt(run: WatchRun, now: number): number {
  if (run.state !== 'task' || !run.current) return run.finishIfOnTime;
  return run.finishIfOnTime + Math.max(0, now - (run.current.start + run.current.plannedMs));
}

// ---- Watch → phone ----

export type WatchCommandType = 'done' | 'skip' | 'undo' | 'finish';

/** A tap on the watch. `at` is the watch's clock when it was tapped. */
export interface WatchCommand {
  cmdId: Id;
  runId: Id;
  type: WatchCommandType;
  /** For done and skip. */
  taskId?: Id;
  at: number;
}

const COMMAND_TYPES: readonly string[] = ['done', 'skip', 'undo', 'finish'] satisfies WatchCommandType[];

/** Reads a command from the watch, or undefined if it isn't one this version understands. */
export function parseWatchCommand(raw: unknown): WatchCommand | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const c = value as Record<string, unknown>;
  if (typeof c.v === 'number' && c.v > WATCH_PROTOCOL) return undefined;
  if (typeof c.cmdId !== 'string' || c.cmdId === '' || typeof c.runId !== 'string') return undefined;
  if (typeof c.type !== 'string' || !COMMAND_TYPES.includes(c.type)) return undefined;
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return undefined;
  const type = c.type as WatchCommandType;
  if ((type === 'done' || type === 'skip') && typeof c.taskId !== 'string') return undefined;
  return {
    cmdId: c.cmdId,
    runId: c.runId,
    type,
    ...(typeof c.taskId === 'string' && { taskId: c.taskId }),
    at: c.at,
  };
}

/**
 * When to record a watch tap. Its own time, kept between the latest thing
 * already in the run's log (so the log stays in order) and now on the phone's
 * clock (the clocks can be a little apart).
 */
export function tapTime(run: Run, at: number, now: number): number {
  const floor = Math.max(run.startedAt, ...run.events.map((e) => e.at));
  return Math.min(Math.max(at, floor), Math.max(now, floor));
}
