// Working back from a fixed finish time (leave-by now, appointments later).
import { simulate } from './simulate';
import { MINUTE } from './time';
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

export function getUpTime(tasks: readonly Task[], leaveBy: number, bufferMin: number): number {
  return latestStart(tasks, leaveBy) - bufferMin * MINUTE;
}
