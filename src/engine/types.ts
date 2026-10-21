// Domain types shared by the engine, the store and the UI.

/** Random UUIDs, so data from several devices can be merged once sync arrives. */
export type Id = string;

/** A task as a flow uses it: the shared task plus whether it's optional in that flow. */
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

/** A task in your shared list. Flows pick which of these they use. */
export type TaskDef = Omit<Task, 'optional'>;

export interface FlowItem {
  taskId: Id;
  optional: boolean;
}

/**
 * The kind of flow: a morning ('leave'), planned the night before from when you
 * get up, or any other ('done'), planned on the day. Wording is the same for both;
 * the stored names are from when they also set it.
 */
export type Ending = 'leave' | 'done';

/** Which end of a plan is fixed, like Google Maps' "Arrive by" and "Depart at". */
export type PlanMode = 'doneBy' | 'startAt';

/** A routine, such as Wake up or Dinner. */
export interface Flow {
  id: Id;
  name: string;
  ending: Ending;
  /** Array order is the priority order. */
  items: FlowItem[];
  /** The time you usually plan around, remembered from last time. */
  usual?: { mode: PlanMode; time: string };
}

/** What you tapped during a run. Runs are append-only logs; everything else is derived. */
export type RunEvent =
  | { id: Id; at: number; type: 'done'; taskId: Id }
  | { id: Id; at: number; type: 'skip'; taskIds: Id[] }
  | { id: Id; at: number; type: 'add'; task: Task; position: 'next' | 'last' }
  | { id: Id; at: number; type: 'edit'; taskId: Id; name: string; handsOnSec: number }
  /** A new priority order for the tasks still to do. */
  | { id: Id; at: number; type: 'reorder'; taskIds: Id[] }
  | { id: Id; at: number; type: 'undo'; targetId: Id };

/** One go at a flow, such as this morning's Wake up. */
export interface Run {
  id: Id;
  flowId: Id;
  /** Copied at Start, so History reads right even if the flow is renamed or deleted. */
  flowName: string;
  ending: Ending;
  /** Local calendar date the run started, YYYY-MM-DD. */
  date: string;
  /** Today's tasks (required plus switched-on optional), copied from the flow at Start, in priority order. */
  tasks: Task[];
  optionalOn: Id[];
  /** Must be finished by (epoch ms). Appointments can set this later. */
  finishBy?: number;
  startedAt: number;
  /** Set when you tap Finish. */
  finishedAt?: number;
  events: RunEvent[];
}
