// Everything that changes the saved document.
import { activeTasks, closeOver } from '../engine/routine';
import { lastUndoable } from '../engine/run';
import { addDays, dateKey, upcomingTime } from '../engine/time';
import type { Ending, Flow, Id, Run, RunEvent, Task, TaskDef } from '../engine/types';
import { forSchedule } from '../features';
import { flowTasks } from './flows';
import { newId, type Plan, type StoreData } from './schema';
import { update } from './store';

// ---- Selectors ----

export const activeFlow = (d: StoreData): Flow => d.flows.find((f) => f.id === d.activeFlowId) ?? d.flows[0]!;

/** A flow's tasks as the engine sees them (the picked flow by default). */
export const tasksOf = (d: StoreData, flow: Flow = activeFlow(d)): Task[] => flowTasks(d.tasks, flow);

export const activeRun = (d: StoreData): Run | undefined =>
  d.activeRunId ? d.runs.find((r) => r.id === d.activeRunId) : undefined;

/** Finished runs, newest first. */
export const finishedRuns = (d: StoreData): Run[] =>
  d.runs.filter((r) => r.finishedAt !== undefined).sort((a, b) => b.startedAt - a.startedAt);

export const planFor = (d: StoreData, date: string, flowId: Id = d.activeFlowId): Plan | undefined =>
  d.plans.find((p) => p.date === date && p.flowId === flowId);

// ---- Flows ----

function withFlow(flowId: Id, change: (flow: Flow) => Flow) {
  update((d) => ({ ...d, flows: d.flows.map((f) => (f.id === flowId ? change(f) : f)) }));
}

export function selectFlow(flowId: Id) {
  update((d) => (d.activeFlowId === flowId ? d : { ...d, activeFlowId: flowId }));
}

/** A new flow, empty or using the same tasks as another. It becomes the picked flow. */
export function createFlow(name: string, ending: Ending, copyFrom?: Id): Id {
  const id = newId();
  update((d) => {
    const source = d.flows.find((f) => f.id === copyFrom);
    const flow: Flow = { id, name, ending, items: source ? source.items.map((i) => ({ ...i })) : [] };
    return { ...d, flows: [...d.flows, flow], activeFlowId: id };
  });
  return id;
}

export function updateFlow(flowId: Id, change: Partial<Pick<Flow, 'name' | 'ending'>>) {
  withFlow(flowId, (f) => ({ ...f, ...change }));
}

/** Deletes a flow and its plans. Its tasks stay in your task list, and its history stays in History. */
export function deleteFlow(flowId: Id) {
  update((d) => {
    if (d.flows.length <= 1 || activeRun(d)?.flowId === flowId) return d;
    const flows = d.flows.filter((f) => f.id !== flowId);
    return {
      ...d,
      flows,
      plans: d.plans.filter((p) => p.flowId !== flowId),
      activeFlowId: d.activeFlowId === flowId ? flows[0]!.id : d.activeFlowId,
    };
  });
}

export function addToFlow(flowId: Id, taskId: Id) {
  withFlow(flowId, (f) =>
    f.items.some((i) => i.taskId === taskId) ? f : { ...f, items: [...f.items, { taskId, optional: false }] },
  );
}

export function removeFromFlow(flowId: Id, taskId: Id) {
  withFlow(flowId, (f) => ({ ...f, items: f.items.filter((i) => i.taskId !== taskId) }));
}

export function moveInFlow(flowId: Id, from: number, to: number) {
  withFlow(flowId, (f) => {
    const items = f.items.slice();
    const [moved] = items.splice(from, 1);
    if (moved) items.splice(to, 0, moved);
    return { ...f, items };
  });
}

// ---- Tasks ----

/** Saves a task's details (shared by every flow that uses it) and its optional switch in this flow. */
export function saveTaskInFlow(flowId: Id, def: TaskDef, optional: boolean) {
  update((d) => ({
    ...d,
    tasks: d.tasks.some((t) => t.id === def.id) ? d.tasks.map((t) => (t.id === def.id ? def : t)) : [...d.tasks, def],
    flows: d.flows.map((f) => {
      if (f.id !== flowId) return f;
      const has = f.items.some((i) => i.taskId === def.id);
      return {
        ...f,
        items: has
          ? f.items.map((i) => (i.taskId === def.id ? { ...i, optional } : i))
          : [...f.items, { taskId: def.id, optional }],
      };
    }),
  }));
}

export function saveTaskDef(def: TaskDef) {
  update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === def.id ? def : t)) }));
}

/** Removes a task from your list and from every flow; rules that waited for it go too. */
export function deleteTaskEverywhere(taskId: Id) {
  update((d) => ({
    ...d,
    tasks: d.tasks.filter((t) => t.id !== taskId).map((t) => ({ ...t, after: t.after.filter((a) => a !== taskId) })),
    flows: d.flows.map((f) => ({ ...f, items: f.items.filter((i) => i.taskId !== taskId) })),
  }));
}

export function setHandsOn(taskId: Id, handsOnSec: number) {
  update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, handsOnSec } : t)) }));
}

// ---- Plans and settings ----

/** Saves a plan, and remembers its time as the flow's usual one. */
export function savePlan(plan: Plan) {
  // Plans for days more than a week gone are no use to anyone.
  const cutoff = addDays(dateKey(Date.now()), -7);
  update((d) => ({
    ...d,
    plans: [...d.plans.filter((p) => !(p.date === plan.date && p.flowId === plan.flowId)), plan].filter(
      (p) => p.date >= cutoff,
    ),
    flows: d.flows.map((f) =>
      f.id === plan.flowId && plan.time ? { ...f, usual: { mode: plan.mode, time: plan.time } } : f,
    ),
  }));
}

export function deletePlan(date: string, flowId: Id) {
  update((d) => ({ ...d, plans: d.plans.filter((p) => !(p.date === date && p.flowId === flowId)) }));
}

export function setDefaultBuffer(bufferMin: number) {
  update((d) => ({ ...d, settings: { ...d.settings, bufferMin } }));
}

export function replaceAll(next: StoreData) {
  update(() => next);
}

// ---- Runs ----

/** Starts the picked flow now, optionally needing to be finished by a local "HH:MM". */
export function startRun(optionalOn: Iterable<Id>, finishBy: string | undefined, now = Date.now()) {
  update((d) => {
    const flow = activeFlow(d);
    const tasks = tasksOf(d, flow);
    const on = closeOver(tasks, optionalOn);
    const run: Run = {
      id: newId(),
      flowId: flow.id,
      flowName: flow.name,
      ending: flow.ending,
      date: dateKey(now),
      tasks: forSchedule(activeTasks(tasks, on)),
      optionalOn: [...on],
      finishBy: finishBy ? upcomingTime(finishBy, now) : undefined,
      startedAt: now,
      events: [],
    };
    // Start only takes a finish-by time, so a flow you plan by its start time keeps that.
    const usual: Flow['usual'] =
      flow.usual?.mode === 'startAt' ? flow.usual : finishBy ? { mode: 'doneBy', time: finishBy } : undefined;
    return {
      ...d,
      runs: [...d.runs, run],
      activeRunId: run.id,
      flows: d.flows.map((f) => (f.id === flow.id ? { ...f, usual } : f)),
    };
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

/** Fixes a task's details for this run only; the task list is changed separately. */
export function editRunTask(taskId: Id, name: string, handsOnSec: number, now = Date.now()) {
  withActiveRun((run) => append(run, { id: newId(), at: now, type: 'edit', taskId, name, handsOnSec }));
}

export function undoLast(now = Date.now()) {
  withActiveRun((run) => {
    const target = lastUndoable(run);
    return target ? append(run, { id: newId(), at: now, type: 'undo', targetId: target.id }) : run;
  });
}

/** Back on Start, show the flow that just ran, even if you looked at another one meanwhile. */
function pickRunFlow(d: StoreData): Id {
  const flowId = activeRun(d)?.flowId;
  return d.flows.some((f) => f.id === flowId) ? flowId! : d.activeFlowId;
}

export function finishRun(at = Date.now()) {
  update((d) => ({
    ...d,
    runs: d.runs.map((r) => (r.id === d.activeRunId ? { ...r, finishedAt: at } : r)),
    activeRunId: undefined,
    activeFlowId: pickRunFlow(d),
  }));
}

export function discardRun() {
  update((d) => ({
    ...d,
    runs: d.runs.filter((r) => r.id !== d.activeRunId),
    activeRunId: undefined,
    activeFlowId: pickRunFlow(d),
  }));
}

export function deleteRun(id: Id) {
  update((d) => ({ ...d, runs: d.runs.filter((r) => r.id !== id) }));
}
