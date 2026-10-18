// Features the engine already supports but the app doesn't switch on yet.
import type { Task } from './engine/types';

export const features: { waits: boolean } = {
  /**
   * Waits (coffee brewing while you do other things). The engine schedules
   * them and tasks keep their wait times, but while this is off the app
   * ignores waits and doesn't show them anywhere.
   */
  waits: false,
};

/** Tasks as the app should schedule them, given the switches above. */
export function forSchedule(tasks: Task[]): Task[] {
  return features.waits ? tasks : tasks.map((t) => (t.waitSec > 0 ? { ...t, waitSec: 0 } : t));
}
