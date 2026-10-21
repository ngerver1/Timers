// Turning the shared task list and a flow into what the engine works with.
import { finishFrom } from '../engine/plan';
import { activeTasks, inOrder } from '../engine/routine';
import { atTime, ceilMinute, toHhmm } from '../engine/time';
import type { Flow, Id, PlanMode, Task, TaskDef } from '../engine/types';
import { forSchedule } from '../features';
import type { PlanChange, PlanExtra } from './schema';

/** A flow's tasks, in its order, each with that flow's optional switch. */
export function flowTasks(tasks: readonly TaskDef[], flow: Flow): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return flow.items.flatMap((i) => {
    const def = byId.get(i.taskId);
    return def ? [{ ...def, optional: i.optional }] : [];
  });
}

/** One task in a day's plan, with how the day differs from the flow. */
export interface DayTask {
  task: Task;
  /** Added for the day: from your task list, or a one-off. */
  added: boolean;
  oneOff: boolean;
  /** Name or minutes changed for the day. */
  changed: boolean;
  leftOut: boolean;
}

/**
 * Every task in a day's plan, in order: the flow's own, then any added for the
 * day (or the day's own order, if it was reordered), with the day's changes
 * applied. Extras already in the flow, or since deleted, are left out.
 */
export function planTasks(
  tasks: readonly TaskDef[],
  flow: Flow,
  plan?: { extras?: readonly PlanExtra[]; changes?: readonly PlanChange[]; order?: readonly Id[] },
): DayTask[] {
  const own = flowTasks(tasks, flow);
  const seen = new Set(own.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const extras = (plan?.extras ?? []).flatMap((e) => {
    const def = 'oneOff' in e ? e.oneOff : byId.get(e.taskId);
    if (!def || seen.has(def.id)) return [];
    seen.add(def.id);
    return [{ task: { ...def, optional: false }, added: true, oneOff: 'oneOff' in e }];
  });
  const changes = new Map((plan?.changes ?? []).map((c) => [c.taskId, c]));
  const list = [...own.map((task) => ({ task, added: false, oneOff: false })), ...extras].map((d) => {
    const c = changes.get(d.task.id);
    return {
      ...d,
      task: c ? { ...d.task, name: c.name ?? d.task.name, handsOnSec: c.handsOnSec ?? d.task.handsOnSec } : d.task,
      changed: c?.name !== undefined || c?.handsOnSec !== undefined,
      leftOut: c?.leftOut === true,
    };
  });
  return plan?.order ? inOrder(list, (d) => d.task.id, plan.order) : list;
}

/** The tasks a day's plan will run, as the engine sees them: the ones not left out. */
export function dayTasks(...args: Parameters<typeof planTasks>): Task[] {
  return planTasks(...args).flatMap((d) => (d.leftOut ? [] : [d.task]));
}

/**
 * A day's changes with one task's change merged in. Fields set to undefined are
 * cleared, and a change left with nothing in it is dropped.
 */
export function withChange(
  changes: readonly PlanChange[],
  taskId: Id,
  change: Omit<PlanChange, 'taskId'>,
): PlanChange[] {
  const next: PlanChange = { ...changes.find((c) => c.taskId === taskId), ...change, taskId };
  const rest = changes.filter((c) => c.taskId !== taskId);
  return next.name === undefined && next.handsOnSec === undefined && !next.leftOut ? rest : [...rest, next];
}

/** Every task with its rules. Rules are shared, so loops are checked across all of them. */
export const ruleGraph = (tasks: readonly TaskDef[]): Task[] => tasks.map((t) => ({ ...t, optional: false }));

export const flowsUsing = (flows: readonly Flow[], taskId: Id): Flow[] =>
  flows.filter((f) => f.items.some((i) => i.taskId === taskId));

/**
 * The finish-by time Start offers, from today's plan or else the flow's usual.
 * Start only takes a finish-by time, so a start-at plan offers the finish it works out to.
 */
export function offeredFinishBy(
  tasks: readonly Task[],
  on: ReadonlySet<Id>,
  basis: { mode: PlanMode; time?: string } | undefined,
  day: string,
): string {
  if (!basis?.time) return '';
  if (basis.mode === 'doneBy') return basis.time;
  return toHhmm(ceilMinute(finishFrom(forSchedule(activeTasks(tasks, on)), atTime(day, basis.time))));
}
