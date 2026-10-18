// Wait tracking. Waits already count in every schedule; this is the hook for
// the "Coffee's ready" alert, which isn't switched on yet.
import type { DoneTask, RunState } from './run';

/** Waits that ended in (from, to]. */
export function waitsEndedBetween(state: RunState, from: number, to: number): DoneTask[] {
  return [...state.done.values()].filter((d) => d.task.waitSec > 0 && d.finish > from && d.finish <= to);
}
