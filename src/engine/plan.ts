// Fixing one end of a flow and working out the other, like Google Maps'
// "Arrive by" (done by) and "Depart at" (start at).
import { simulate } from './simulate';
import type { Task } from './types';

/** How long the tasks take from a standing start, waits included (ms). */
export function routineLength(tasks: readonly Task[]): number {
  return simulate({ tasks, from: 0 }).finish;
}

/**
 * Latest start that still finishes by `finishBy`. The schedule doesn't depend on
 * the clock yet, so this is a straight shift; fixed-time steps such as
 * appointments will need a search here.
 */
export function latestStart(tasks: readonly Task[], finishBy: number): number {
  return finishBy - routineLength(tasks);
}

/** When you'll be done if you start at `start`. */
export function finishFrom(tasks: readonly Task[], start: number): number {
  return start + routineLength(tasks);
}
