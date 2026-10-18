// Everything that changes the saved document.
import { activeTasks, closeOver } from '../engine/routine';
import { lastUndoable } from '../engine/run';
import { addDays, dateKey, upcomingTime } from '../engine/time';
import type { Id, Routine, Run, RunEvent, Task } from '../engine/types';
import { forSchedule } from '../features';
import { newId, type Plan, type StoreData } from './schema';
import { update } from './store';

// ---- Selectors ----

export const activeRoutine = (d: StoreData): Routine =>
  d.routines.find((r) => r.id === d.activeRoutineId) ?? d.routines[0]!;

export const activeRun = (d: StoreData): Run | undefined =>
  d.activeRunId ? d.runs.find((r) => r.id === d.activeRunId) : undefined;

/** Finished mornings, newest first. */
export const finishedRuns = (d: StoreData): Run[] =>
  d.runs.filter((r) => r.finishedAt !== undefined).sort((a, b) => b.startedAt - a.startedAt);

export const planFor = (d: StoreData, date: string): Plan | undefined =>
  d.plans.find((p) => p.date === date && p.routineId === d.activeRoutineId);

// ---- Tasks ----

function withTasks(change: (tasks: Task[]) => Task[]) {
  update((d) => ({
    ...d,
    routines: d.routines.map((r) => (r.id === d.activeRoutineId ? { ...r, tasks: change(r.tasks) } : r)),
  }));
}

export function saveTask(task: Task) {
  withTasks((tasks) =>
    tasks.some((t) => t.id === task.id) ? tasks.map((t) => (t.id === task.id ? task : t)) : [...tasks, task],
  );
}

export function deleteTask(id: Id) {
  withTasks((tasks) => tasks.filter((t) => t.id !== id).map((t) => ({ ...t, after: t.after.filter((a) => a !== id) })));
}

export function moveTask(from: number, to: number) {
  withTasks((tasks) => {
    const next = tasks.slice();
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    return next;
  });
}

export function setHandsOn(id: Id, handsOnSec: number) {
  withTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, handsOnSec } : t)));
}

// ---- Plans and settings ----

export function savePlan(plan: Plan) {
  // Plans for mornings more than a week gone are no use to anyone.
  const cutoff = addDays(dateKey(Date.now()), -7);
  update((d) => ({
    ...d,
    plans: [...d.plans.filter((p) => !(p.date === plan.date && p.routineId === plan.routineId)), plan].filter(
      (p) => p.date >= cutoff,
    ),
  }));
}

export function deletePlan(date: string) {
  update((d) => ({ ...d, plans: d.plans.filter((p) => !(p.date === date && p.routineId === d.activeRoutineId)) }));
}

export function setDefaultBuffer(bufferMin: number) {
  update((d) => ({ ...d, settings: { ...d.settings, bufferMin } }));
}

export function replaceAll(next: StoreData) {
  update(() => next);
}

// ---- Mornings ----

export function startRun(optionalOn: Iterable<Id>, leaveBy: string | undefined, now = Date.now()) {
  update((d) => {
    const routine = activeRoutine(d);
    const on = closeOver(routine.tasks, optionalOn);
    const run: Run = {
      id: newId(),
      routineId: routine.id,
      date: dateKey(now),
      tasks: forSchedule(activeTasks(routine.tasks, on)),
      optionalOn: [...on],
      leaveBy: leaveBy ? upcomingTime(leaveBy, now) : undefined,
      startedAt: now,
      events: [],
    };
    return { ...d, runs: [...d.runs, run], activeRunId: run.id, lastLeaveBy: leaveBy };
  });
}

function withActiveRun(change: (run: Run) => Run) {
  update((d) => {
    const run = activeRun(d);
    if (!run) return d;
    const next = change(run);
    return next === run ? d : { ...d, runs: d.runs.map((r) => (r.id === run.id ? next : r)) };
  });
}

const append = (run: Run, event: RunEvent): Run => ({ ...run, events: [...run.events, event] });

export function tapDone(taskId: Id, now = Date.now()) {
  withActiveRun((run) => append(run, { id: newId(), at: now, type: 'done', taskId }));
}

export function skipTasks(taskIds: Id[], now = Date.now()) {
  withActiveRun((run) => append(run, { id: newId(), at: now, type: 'skip', taskIds }));
}

export function addOneOff(name: string, minutes: number, position: 'next' | 'last', now = Date.now()) {
  const task: Task = {
    id: newId(),
    name,
    handsOnSec: Math.round(minutes * 60),
    waitSec: 0,
    after: [],
    optional: false,
  };
  withActiveRun((run) => append(run, { id: newId(), at: now, type: 'add', task, position }));
}

/** Fixes a task's details for this morning only; the routine is changed separately. */
export function editRunTask(taskId: Id, name: string, handsOnSec: number, now = Date.now()) {
  withActiveRun((run) => append(run, { id: newId(), at: now, type: 'edit', taskId, name, handsOnSec }));
}

export function undoLast(now = Date.now()) {
  withActiveRun((run) => {
    const target = lastUndoable(run);
    return target ? append(run, { id: newId(), at: now, type: 'undo', targetId: target.id }) : run;
  });
}

export function finishRun(at = Date.now()) {
  update((d) => ({
    ...d,
    runs: d.runs.map((r) => (r.id === d.activeRunId ? { ...r, finishedAt: at } : r)),
    activeRunId: undefined,
  }));
}

export function discardRun() {
  update((d) => ({ ...d, runs: d.runs.filter((r) => r.id !== d.activeRunId), activeRunId: undefined }));
}

export function deleteRun(id: Id) {
  update((d) => ({ ...d, runs: d.runs.filter((r) => r.id !== id) }));
}
