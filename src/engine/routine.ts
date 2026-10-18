// Helpers for a routine's task list: optional tasks on/off, today's task set, rule loops.
import type { Id, Task } from './types';

const byId = (tasks: readonly Task[]) => new Map(tasks.map((t) => [t.id, t]));

/** Switches an optional task on, plus any optional tasks it needs. */
export function switchOn(tasks: readonly Task[], on: ReadonlySet<Id>, id: Id): Set<Id> {
  const map = byId(tasks);
  const next = new Set(on);
  const visit = (taskId: Id) => {
    const task = map.get(taskId);
    if (!task || !task.optional || next.has(taskId)) return;
    next.add(taskId);
    // Only optional prerequisites get switched on. A required one is always on,
    // and its own rules on optional tasks are ignored when those are off.
    task.after.forEach(visit);
  };
  visit(id);
  return next;
}

/** Switches an optional task off, plus any switched-on optional tasks that need it. */
export function switchOff(tasks: readonly Task[], on: ReadonlySet<Id>, id: Id): Set<Id> {
  const next = new Set(on);
  const visit = (taskId: Id) => {
    if (!next.delete(taskId)) return;
    for (const t of tasks) if (t.optional && t.after.includes(taskId)) visit(t.id);
  };
  visit(id);
  return next;
}

/** Tidies a saved selection (e.g. a plan made before tasks were edited). */
export function closeOver(tasks: readonly Task[], on: Iterable<Id>): Set<Id> {
  let result = new Set<Id>();
  for (const id of on) result = switchOn(tasks, result, id);
  return result;
}

/**
 * Today's tasks: required ones plus switched-on optional ones, in priority order.
 * Rules pointing at tasks that are off today are dropped.
 */
export function activeTasks(tasks: readonly Task[], on: ReadonlySet<Id>): Task[] {
  const active = tasks.filter((t) => !t.optional || on.has(t.id));
  const ids = new Set(active.map((t) => t.id));
  return active.map((t) => ({ ...t, after: t.after.filter((d) => ids.has(d)) }));
}

/** Would making `taskId` wait for `depId` create a loop of rules? */
export function createsCycle(tasks: readonly Task[], taskId: Id, depId: Id): boolean {
  const map = byId(tasks);
  const seen = new Set<Id>();
  const stack = [depId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(map.get(id)?.after ?? []));
  }
  return false;
}
