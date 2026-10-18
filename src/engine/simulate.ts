// The single-worker scheduler. Not critical path: you are one person, so hands-on
// parts never overlap. Whenever you're free you take the first task in priority
// order whose "after" tasks are fully finished; if none is ready you're idle until
// one is. Waits run in the background.
import type { Id, Task } from './types';

export interface Slot {
  task: Task;
  /** Hands-on part starts (epoch ms). */
  start: number;
  /** You're free again. */
  handsOnEnd: number;
  /** Wait included. */
  finish: number;
}

export interface SimulateInput {
  /** Tasks still to do, in priority order. */
  tasks: readonly Task[];
  /** When you're next free. */
  from: number;
  /**
   * Finish times (wait included) of tasks already done. A rule pointing at a task
   * that is neither here nor in `tasks` (switched off, skipped) is ignored.
   */
  finished?: ReadonlyMap<Id, number>;
  /** A task already under way, which keeps you busy from `start`. */
  current?: { id: Id; start: number };
  /**
   * The clock. A task started at or before `now` can't end before `now`, because
   * you haven't tapped Done yet. That's what makes overruns push the estimate out.
   */
  now?: number;
}

export interface Schedule {
  slots: Slot[];
  /** When the last task, wait included, finishes. */
  finish: number;
}

export function simulate({ tasks, from, finished = new Map(), current, now = -Infinity }: SimulateInput): Schedule {
  const fin = new Map(finished);
  const pending = tasks.slice();
  const pendingIds = new Set(pending.map((t) => t.id));
  const slots: Slot[] = [];
  let t = from;

  const place = (task: Task, start: number) => {
    const plannedEnd = start + task.handsOnSec * 1000;
    const handsOnEnd = start <= now ? Math.max(plannedEnd, now) : plannedEnd;
    const finish = handsOnEnd + task.waitSec * 1000;
    slots.push({ task, start, handsOnEnd, finish });
    fin.set(task.id, finish);
    pendingIds.delete(task.id);
    pending.splice(pending.indexOf(task), 1);
    t = handsOnEnd;
  };

  const readyAt = (task: Task): number => {
    let ready = -Infinity;
    for (const dep of task.after) {
      if (pendingIds.has(dep)) return Infinity;
      const f = fin.get(dep);
      if (f !== undefined && f > ready) ready = f;
    }
    return ready;
  };

  if (current) {
    const task = pending.find((p) => p.id === current.id);
    if (task) place(task, current.start);
  }

  while (pending.length > 0) {
    let next: Task | undefined;
    let earliest = Infinity;
    for (const task of pending) {
      const ready = readyAt(task);
      if (ready <= t) {
        next = task;
        break;
      }
      earliest = Math.min(earliest, ready);
    }
    if (next) place(next, t);
    else if (earliest < Infinity)
      t = earliest; // idle until something is ready
    else place(pending[0]!, t); // only a loop of rules gets here; break it rather than hang
  }

  return { slots, finish: Math.max(from, ...fin.values()) };
}
