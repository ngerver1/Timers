// Domain types shared by the engine, the store and the UI.

/** Random UUIDs, so data from several devices can be merged once sync arrives. */
export type Id = string;

export interface Task {
  id: Id;
  name: string;
  /** Time that needs you. Hands-on parts never overlap. */
  handsOnSec: number;
  /** Runs by itself after the hands-on part (coffee brewing). 0 = no wait. */
  waitSec: number;
  /** Tasks that must be fully finished, wait included, before this one can start. */
  after: Id[];
  optional: boolean;
}

export interface Routine {
  id: Id;
  name: string;
  /** Array order is the priority order. */
  tasks: Task[];
}

/** What you tapped during a run. Runs are append-only logs; everything else is derived. */
export type RunEvent =
  | { id: Id; at: number; type: 'done'; taskId: Id }
  | { id: Id; at: number; type: 'skip'; taskIds: Id[] }
  | { id: Id; at: number; type: 'add'; task: Task; position: 'next' | 'last' }
  | { id: Id; at: number; type: 'undo'; targetId: Id };

/** One morning. */
export interface Run {
  id: Id;
  routineId: Id;
  /** Local calendar date the run started, YYYY-MM-DD. */
  date: string;
  /** Today's tasks (required plus switched-on optional), copied from the routine at Start, in priority order. */
  tasks: Task[];
  optionalOn: Id[];
  /** Epoch ms. Later versions can work this out from an appointment. */
  leaveBy?: number;
  startedAt: number;
  /** Set when you tap Out the door. */
  finishedAt?: number;
  events: RunEvent[];
}
