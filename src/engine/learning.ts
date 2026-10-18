// What each task usually takes, from finished mornings.
import { foldRun } from './run';
import type { Id, Run } from './types';

export const LEARN_FROM = 10;

/** Seconds of hands-on time spent on each task done in a run. */
export function actualSeconds(run: Run): Map<Id, number> {
  const { done } = foldRun(run);
  return new Map([...done].map(([id, d]) => [id, Math.round((d.handsOnEnd - d.start) / 1000)]));
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface Usual {
  medianSec: number;
  samples: number;
}

/** Median over the last `n` mornings that included each task. `runs` must be newest first. */
export function usualTimes(runs: readonly Run[], n = LEARN_FROM): Map<Id, Usual> {
  const samples = new Map<Id, number[]>();
  for (const run of runs) {
    for (const [id, sec] of actualSeconds(run)) {
      const list = samples.get(id) ?? [];
      if (list.length < n) samples.set(id, [...list, sec]);
    }
  }
  return new Map([...samples].map(([id, list]) => [id, { medianSec: median(list)!, samples: list.length }]));
}

/** Rounds to the nearest 15 s, so adopting a median gives a tidy standard time. */
export function tidySeconds(sec: number): number {
  return Math.max(15, Math.round(sec / 15) * 15);
}
