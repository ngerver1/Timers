// How a flow's runs have gone: their total times, against the plan at Start and
// the finish-by time, whether they're getting quicker, and the task that runs
// over most.
import { LEARN_FROM, median, tidySeconds, type Usual } from './learning';
import { plannedFinish } from './run';
import { MINUTE } from './time';
import type { Id, Run, TaskDef } from './types';

export interface RunTime {
  run: Run;
  /** Start to finish (ms). */
  tookMs: number;
  /** What the plan at Start said it would take (ms). */
  plannedMs: number;
}

/** Total and planned times of the finished runs, in the order given. */
export function runTimes(runs: readonly Run[]): RunTime[] {
  return runs.flatMap((run) =>
    run.finishedAt === undefined
      ? []
      : [{ run, tookMs: run.finishedAt - run.startedAt, plannedMs: plannedFinish(run) - run.startedAt }],
  );
}

/** Finished by the finish-by time, to the minute (as History words it: "on time" or early). */
export const madeIt = (run: Run): boolean =>
  run.finishBy !== undefined &&
  run.finishedAt !== undefined &&
  Math.round((run.finishBy - run.finishedAt) / MINUTE) >= 0;

export interface Summary {
  /** How many runs it's over: the newest, up to `LEARN_FROM`. */
  count: number;
  /** Median total time. */
  typicalMs: number;
  /** Median of total time minus planned time; positive is longer than planned. */
  vsPlanMs: number;
  /** Of the runs with a finish-by time, how many made it. */
  onTime?: { made: number; of: number };
}

/** The newest runs at a glance. `times` must be newest first. */
export function summarise(times: readonly RunTime[], n = LEARN_FROM): Summary | undefined {
  const recent = times.slice(0, n);
  if (recent.length === 0) return undefined;
  const timed = recent.filter((t) => t.run.finishBy !== undefined);
  return {
    count: recent.length,
    typicalMs: median(recent.map((t) => t.tookMs))!,
    vsPlanMs: median(recent.map((t) => t.tookMs - t.plannedMs))!,
    onTime: timed.length ? { made: timed.filter((t) => madeIt(t.run)).length, of: timed.length } : undefined,
  };
}

export interface Trend {
  /** Runs in each group. */
  size: number;
  /** Median total time of the newest `size` runs, and of the `size` before them. */
  recentMs: number;
  earlierMs: number;
}

/** The newest runs against the ones before, once there are at least 3 of each. `times` must be newest first. */
export function trend(times: readonly RunTime[], maxSize = 5): Trend | undefined {
  const size = Math.min(maxSize, Math.floor(times.length / 2));
  if (size < 3) return undefined;
  return {
    size,
    recentMs: median(times.slice(0, size).map((t) => t.tookMs))!,
    earlierMs: median(times.slice(size, 2 * size).map((t) => t.tookMs))!,
  };
}

export interface Overrun {
  task: TaskDef;
  /** Its usual time, tidied the way adopting it would set it. */
  usualSec: number;
  /** How much longer that is than its standard time. */
  overSec: number;
}

/** The task whose usual time is furthest over its standard time: at least a minute, seen at least 3 times. */
export function biggestOverrun(
  tasks: readonly TaskDef[],
  usual: ReadonlyMap<Id, Usual>,
  minSamples = 3,
): Overrun | undefined {
  let best: Overrun | undefined;
  for (const task of tasks) {
    const u = usual.get(task.id);
    if (!u || u.samples < minSamples) continue;
    const usualSec = tidySeconds(u.medianSec);
    const overSec = usualSec - task.handsOnSec;
    if (overSec >= 60 && (!best || overSec > best.overSec)) best = { task, usualSec, overSec };
  }
  return best;
}

/** A round top for a chart of minutes, and the step between gridlines (at most 4 steps). */
export function minuteScale(maxMs: number): { top: number; step: number } {
  const minutes = Math.max(1, maxMs / MINUTE);
  const step = [5, 10, 15, 30, 60, 120, 240].find((s) => minutes <= s * 4) ?? 480;
  return { top: Math.ceil(minutes / step) * step, step };
}
