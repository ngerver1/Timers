// Wait alerts ("Coffee's ready"). Infrastructure only: the running screen calls
// this whenever a wait finishes while the app is open, and waits already count
// in every estimate. Vibration, a chime and a spoken message go here when the
// feature is switched on. They will need the AudioContext unlocked by a tap
// (Start is a good moment) and only work while the app is on screen.
import type { Task } from '../engine/types';

export function onWaitEnded(_task: Task): void {
  // Not switched on yet.
}
