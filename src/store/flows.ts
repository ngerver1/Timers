// Turning the shared task list and a flow into what the engine works with.
import { finishFrom } from '../engine/plan';
import { activeTasks } from '../engine/routine';
import { atTime, ceilMinute, toHhmm } from '../engine/time';
import type { Flow, Id, PlanMode, Task, TaskDef } from '../engine/types';
import { forSchedule } from '../features';

/** A flow's tasks, in its order, each with that flow's optional switch. */
export function flowTasks(tasks: readonly TaskDef[], flow: Flow): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return flow.items.flatMap((i) => {
    const def = byId.get(i.taskId);
    return def ? [{ ...def, optional: i.optional }] : [];
  });
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
