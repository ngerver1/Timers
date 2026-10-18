// Fixtures for the engine tests.
import type { Run, RunEvent, Task } from './types';

export const MIN = 60_000;
/** 6:00 am on Monday 19 October 2026 (tests run in Brisbane time). */
export const T0 = new Date(2026, 9, 19, 6, 0).getTime();
export const at = (min: number) => T0 + Math.round(min * MIN);
/** Minutes after T0. */
export const mins = (ms: number) => (ms - T0) / MIN;

export function task(
  id: string,
  minutes: number,
  opts: { wait?: number; after?: string[]; optional?: boolean } = {},
): Task {
  return {
    id,
    name: id,
    handsOnSec: minutes * 60,
    waitSec: (opts.wait ?? 0) * 60,
    after: opts.after ?? [],
    optional: opts.optional ?? false,
  };
}

/** The placeholder routine from the brief. */
export const morning: Task[] = [
  task('teeth', 3),
  task('coffee', 2, { wait: 4 }),
  task('dogFood', 3),
  task('walk', 20),
  task('washHair', 10, { optional: true }),
  task('ironOn', 0.5, { wait: 3, optional: true }),
  task('clothes', 3),
  task('iron', 8, { after: ['ironOn', 'clothes'], optional: true }),
  task('change', 5, { after: ['clothes', 'iron'] }),
  task('doHair', 10, { after: ['washHair'] }),
  task('packBag', 5, { optional: true }),
];

let seq = 0;
const id = () => `e${++seq}`;

export const done = (taskId: string, min: number): RunEvent => ({ id: id(), at: at(min), type: 'done', taskId });
export const skip = (taskIds: string[], min: number): RunEvent => ({ id: id(), at: at(min), type: 'skip', taskIds });
export const add = (t: Task, position: 'next' | 'last', min: number): RunEvent => ({
  id: id(),
  at: at(min),
  type: 'add',
  task: t,
  position,
});
export const editTask = (taskId: string, name: string, minutes: number, min: number): RunEvent => ({
  id: id(),
  at: at(min),
  type: 'edit',
  taskId,
  name,
  handsOnSec: minutes * 60,
});
export const undo = (target: RunEvent, min: number): RunEvent => ({
  id: id(),
  at: at(min),
  type: 'undo',
  targetId: target.id,
});

export function makeRun(tasks: Task[], events: RunEvent[] = [], leaveByMin?: number): Run {
  return {
    id: `run${++seq}`,
    routineId: 'routine',
    date: '2026-10-19',
    tasks,
    optionalOn: tasks.filter((t) => t.optional).map((t) => t.id),
    leaveBy: leaveByMin === undefined ? undefined : at(leaveByMin),
    startedAt: T0,
    events,
  };
}
