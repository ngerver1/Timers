// A morning is a log of taps. Folding the log says what's done and when you were
// last free; projecting from the clock gives "now + what's left".
import { inOrder } from './routine';
import { simulate, type Slot } from './simulate';
import type { Id, Run, RunEvent, Task } from './types';

/**
 * Done taps this close together count as one batch: you did a few things, then
 * tapped them all. The time since you were last free is shared between them in
 * proportion to their standard times, in the order you tapped them.
 */
export const BATCH_GAP_MS = 30_000;

export interface DoneTask {
  task: Task;
  tappedAt: number;
  /** Best guess at when you did it; batched taps are spread out. */
  start: number;
  handsOnEnd: number;
  /** Wait included. */
  finish: number;
  /** Tapped Done together with others (within 30 s): the same id for each, and their time is split by plan. */
  batch?: Id;
}

export interface RunState {
  /** Today's tasks in priority order, one-offs included. */
  tasks: Task[];
  done: Map<Id, DoneTask>;
  skipped: Set<Id>;
  /** When you last became free: Start, a Done, or skipping what you were on. */
  freeAt: number;
  /** The task you were on when something else changed (a skip, a one-off), so it stays current. */
  pinned?: { id: Id; start: number };
}

export interface Projection {
  now: number;
  /** What you're on now. Undefined while nothing is ready (idle) or once all done. */
  current?: Slot;
  /** Everything still to do, in projected order, current first. */
  upcoming: Slot[];
  /** In the order you did them. */
  done: DoneTask[];
  skipped: Task[];
  /** Waits still running. The hook for countdowns and "Coffee's ready" alerts, which aren't built yet. */
  waits: DoneTask[];
  outTheDoor: number;
  /** Nothing left to do (waits may still be running). */
  allDone: boolean;
}

type DoneEvent = Extract<RunEvent, { type: 'done' }>;
type EditEvent = Extract<RunEvent, { type: 'edit' }>;

/** Events that still count: undo events and the events they cancelled are dropped. */
export function liveEvents(events: readonly RunEvent[]): RunEvent[] {
  const cancelled = new Set(events.flatMap((e) => (e.type === 'undo' ? [e.targetId] : [])));
  return events.filter((e) => e.type !== 'undo' && !cancelled.has(e.id));
}

/** The event the Undo button would cancel. */
export function lastUndoable(run: Run): RunEvent | undefined {
  return liveEvents(run.events).at(-1);
}

export function foldRun(run: Run): RunState {
  const state: RunState = {
    tasks: run.tasks.slice(),
    done: new Map(),
    skipped: new Set(),
    freeAt: run.startedAt,
  };
  const events = liveEvents(run.events);
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'done') {
      const batch = [e];
      for (;;) {
        const next = events[i + 1];
        if (next?.type !== 'done' || next.at - batch[batch.length - 1]!.at > BATCH_GAP_MS) break;
        batch.push(next);
        i++;
      }
      applyDone(state, batch);
    } else if (e.type === 'skip') {
      applySkip(state, e.taskIds, e.at);
    } else if (e.type === 'add') {
      applyAdd(state, e.task, e.position, e.at);
    } else if (e.type === 'edit') {
      applyEdit(state, e);
    } else if (e.type === 'reorder') {
      applyReorder(state, e.taskIds, e.at);
    }
  }
  if (run.corrected) applyCorrections(state, run.corrected);
  return state;
}

export function project(run: Run, now: number): Projection {
  return projectState(foldRun(run), now);
}

export function projectState(state: RunState, now: number): Projection {
  const pending = state.tasks.filter((t) => !state.done.has(t.id) && !state.skipped.has(t.id));
  const finished = new Map([...state.done].map(([id, d]) => [id, d.finish] as const));
  const pinned = state.pinned && pending.some((t) => t.id === state.pinned?.id) ? state.pinned : undefined;
  const { slots, finish } = simulate({ tasks: pending, from: state.freeAt, finished, current: pinned, now });
  const first = slots[0];
  const done = [...state.done.values()];
  return {
    now,
    current: first && first.start <= now ? first : undefined,
    upcoming: slots,
    done,
    skipped: state.tasks.filter((t) => state.skipped.has(t.id)),
    waits: done.filter((d) => d.task.waitSec > 0 && d.finish > now),
    outTheDoor: Math.max(now, finish),
    allDone: pending.length === 0,
  };
}

/** When everything had been done or skipped, if it all was. From then until Finish is finishing up. */
export function allDoneAt(state: RunState): number | undefined {
  return state.tasks.every((t) => state.done.has(t.id) || state.skipped.has(t.id)) ? state.freeAt : undefined;
}

/** The estimate at the moment you tapped Start. */
export function plannedFinish(run: Run): number {
  return simulate({ tasks: run.tasks, from: run.startedAt }).finish;
}

export function cloneState(state: RunState): RunState {
  return {
    tasks: state.tasks.slice(),
    done: new Map(state.done),
    skipped: new Set(state.skipped),
    freeAt: state.freeAt,
    pinned: state.pinned && { ...state.pinned },
  };
}

export function applySkip(state: RunState, taskIds: readonly Id[], at: number): void {
  const ids = taskIds.filter(
    (id) => state.tasks.some((t) => t.id === id) && !state.done.has(id) && !state.skipped.has(id),
  );
  if (ids.length === 0) return;
  const { current } = projectState(state, at);
  ids.forEach((id) => state.skipped.add(id));
  if (!current || ids.includes(current.task.id)) {
    // You weren't on anything else, so whatever is next starts now.
    state.freeAt = at;
    state.pinned = undefined;
  } else {
    state.pinned = { id: current.task.id, start: current.start };
  }
}

function applyAdd(state: RunState, task: Task, position: 'next' | 'last', at: number): void {
  if (state.tasks.some((t) => t.id === task.id)) return;
  const { current } = projectState(state, at);
  // "Next" goes to the top of the priority list. The current task is pinned, so
  // the one-off really does come straight after it.
  if (position === 'next') state.tasks.unshift(task);
  else state.tasks.push(task);
  if (current) {
    state.pinned = { id: current.task.id, start: current.start };
  } else {
    state.freeAt = at;
    state.pinned = undefined;
  }
}

/** Puts the tasks still to do in a new priority order. The task you're on stays current. */
function applyReorder(state: RunState, taskIds: readonly Id[], at: number): void {
  const { current } = projectState(state, at);
  state.tasks = inOrder(state.tasks, (t) => t.id, taskIds);
  if (current) state.pinned = { id: current.task.id, start: current.start };
}

/**
 * Times fixed afterwards. Each task still starts where the one before it ended
 * (or after the same idle gap), so making one shorter or longer moves everything
 * done after it by the difference. Only the fixed task's own time changes.
 */
function applyCorrections(state: RunState, corrected: Readonly<Record<Id, number>>): void {
  let shift = 0;
  for (const d of [...state.done.values()].sort((a, b) => a.start - b.start)) {
    const tookMs = d.handsOnEnd - d.start;
    const fixedMs = corrected[d.task.id] === undefined ? tookMs : corrected[d.task.id]! * 1000;
    const start = d.start + shift;
    state.done.set(d.task.id, {
      ...d,
      start,
      handsOnEnd: start + fixedMs,
      finish: start + fixedMs + d.task.waitSec * 1000,
    });
    shift += fixedMs - tookMs;
  }
  state.freeAt += shift;
}

/** Fixes a task's name or minutes for the rest of this morning. */
function applyEdit(state: RunState, e: EditEvent): void {
  const change = (t: Task): Task => (t.id === e.taskId ? { ...t, name: e.name, handsOnSec: e.handsOnSec } : t);
  state.tasks = state.tasks.map(change);
  const done = state.done.get(e.taskId);
  if (done) state.done.set(e.taskId, { ...done, task: change(done.task) });
}

function applyDone(state: RunState, taps: readonly DoneEvent[]): void {
  const items: { task: Task; tap: DoneEvent }[] = [];
  for (const tap of taps) {
    const task = state.tasks.find((t) => t.id === tap.taskId);
    // Ignore taps on unknown, finished or skipped tasks (a double tap, say).
    if (!task || state.done.has(task.id) || state.skipped.has(task.id)) continue;
    if (items.some((i) => i.task.id === task.id)) continue;
    items.push({ task, tap });
  }
  if (items.length === 0) return;

  // You were free from `freeAt`. But if nothing you then did was ready yet
  // (waiting on the iron, say), the clock starts when the first of it was.
  const firstTap = items[0]!.tap.at;
  const lastTap = items[items.length - 1]!.tap.at;
  const ready = Math.min(...items.map((i) => readyAt(state, i.task)));
  const start = Math.min(ready <= firstTap ? Math.max(state.freeAt, ready) : state.freeAt, lastTap);

  const ordered = orderBatch(items);
  const batch = ordered.length > 1 ? ordered[0]!.tap.id : undefined;
  const total = lastTap - start;
  const weights = ordered.reduce((sum, i) => sum + i.task.handsOnSec, 0);
  let cursor = start;
  ordered.forEach((item, k) => {
    const share = weights > 0 ? (total * item.task.handsOnSec) / weights : total / ordered.length;
    const end = k === ordered.length - 1 ? lastTap : Math.round(cursor + share);
    state.done.set(item.task.id, {
      task: item.task,
      tappedAt: item.tap.at,
      start: cursor,
      handsOnEnd: end,
      finish: end + item.task.waitSec * 1000,
      batch,
    });
    cursor = end;
  });
  state.freeAt = lastTap;
  state.pinned = undefined;
}

/** Batch order: the order you tapped, except a task never goes before one it has to wait for. */
function orderBatch<T extends { task: Task }>(items: readonly T[]): T[] {
  const remaining = items.slice();
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const left = new Set(remaining.map((i) => i.task.id));
    const next = remaining.find((i) => !i.task.after.some((d) => left.has(d))) ?? remaining[0]!;
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

/** When a task's "after" tasks are all finished; Infinity while one is still to do. */
function readyAt(state: RunState, task: Task): number {
  let ready = -Infinity;
  for (const dep of task.after) {
    const done = state.done.get(dep);
    if (done) ready = Math.max(ready, done.finish);
    else if (!state.skipped.has(dep) && state.tasks.some((t) => t.id === dep)) return Infinity;
  }
  return ready;
}
