// When you're behind: which optional tasks to drop to make leave-by.
import { applySkip, cloneState, projectState, type RunState } from './run';
import type { Id, Task } from './types';

export interface DropSuggestion {
  /** In the order they would have happened. */
  drop: Task[];
  outTheDoor: number;
  /** False when even the best combination is still late. */
  onTime: boolean;
}

/**
 * Re-simulates every combination of the optional tasks still to do (there are
 * only ever a few) and picks the fewest drops that make `finishBy`, cutting as
 * little as possible. Drops stay consistent: dropping a task drops optional
 * tasks that need it, and optional tasks that were only there to serve it
 * (no point turning the iron on if you're not ironing).
 */
export function suggestDrops(
  state: RunState,
  now: number,
  finishBy: number,
  maxCandidates = 10,
): DropSuggestion | undefined {
  const base = projectState(state, now);
  if (base.outTheDoor <= finishBy) return undefined;
  const pending = base.upcoming.map((s) => s.task);
  const candidates = pending.filter((t) => t.optional).slice(0, maxCandidates);

  let best: DropSuggestion | undefined;
  const tried = new Set<string>();
  for (let mask = 1; mask < 1 << candidates.length; mask++) {
    const ids = new Set(candidates.filter((_, i) => mask & (1 << i)).map((t) => t.id));
    const leavesDependent = [...ids].some((id) => candidates.some((c) => !ids.has(c.id) && c.after.includes(id)));
    if (leavesDependent) continue;
    addUnneededHelpers(ids, pending);
    const key = [...ids].sort().join();
    if (tried.has(key)) continue;
    tried.add(key);

    const trial = cloneState(state);
    applySkip(trial, [...ids], now);
    const outTheDoor = projectState(trial, now).outTheDoor;
    const option = { drop: pending.filter((t) => ids.has(t.id)), outTheDoor, onTime: outTheDoor <= finishBy };
    if (!best || better(option, best)) best = option;
  }
  return best;
}

/** Adds optional tasks that only dropped tasks were waiting for. */
function addUnneededHelpers(ids: Set<Id>, pending: readonly Task[]): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const helper of pending) {
      if (!helper.optional || ids.has(helper.id)) continue;
      const needs = pending.filter((t) => t.after.includes(helper.id));
      if (needs.length > 0 && needs.every((t) => ids.has(t.id))) {
        ids.add(helper.id);
        changed = true;
      }
    }
  }
}

function better(a: DropSuggestion, b: DropSuggestion): boolean {
  if (a.onTime !== b.onTime) return a.onTime;
  if (a.onTime) {
    // On time either way: fewest drops, then the one that cuts least.
    if (a.drop.length !== b.drop.length) return a.drop.length < b.drop.length;
    return a.outTheDoor > b.outTheDoor;
  }
  // Late either way: get as close as possible, with the fewest drops.
  if (a.outTheDoor !== b.outTheDoor) return a.outTheDoor < b.outTheDoor;
  return a.drop.length < b.drop.length;
}
