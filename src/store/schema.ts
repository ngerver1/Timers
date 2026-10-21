// The saved document. The whole thing is one versioned JSON object, which is
// also the backup file format.
import type { Ending, Flow, FlowItem, Id, PlanMode, Run, RunEvent, Task, TaskDef } from '../engine/types';

export const STORE_VERSION = 2;

/** A task added to one day's plan only: one from your task list, or a one-off for that day. */
export type PlanExtra = { taskId: Id } | { oneOff: TaskDef };

/** A change to one of the day's tasks, for that day only. */
export interface PlanChange {
  taskId: Id;
  name?: string;
  handsOnSec?: number;
  /** Left out of the day's plan. */
  leftOut?: boolean;
}

export interface Plan {
  /** The day it's for, YYYY-MM-DD. */
  date: string;
  flowId: Id;
  optionalOn: Id[];
  /** Added for that day, after the flow's own tasks. */
  extras: PlanExtra[];
  /** Tasks changed or left out for that day. */
  changes: PlanChange[];
  /** That day's order of its tasks, if it was reordered; otherwise the flow's own, then the extras. */
  order?: Id[];
  /** Which end is fixed: done by `time` (work back), or start at `time` (work forward). */
  mode: PlanMode;
  /** Local "HH:MM". */
  time?: string;
  bufferMin: number;
}

export interface Settings {
  /** Default gap between waking and starting, for the get-up time. */
  bufferMin: number;
}

export interface StoreData {
  version: typeof STORE_VERSION;
  /** Your shared task list; flows pick from it. */
  tasks: TaskDef[];
  flows: Flow[];
  /** The flow you last picked. */
  activeFlowId: Id;
  plans: Plan[];
  /** Finished runs, plus the one in progress. */
  runs: Run[];
  activeRunId?: Id;
  settings: Settings;
}

export function newId(): Id {
  // randomUUID needs a secure context; plain-http testing on a LAN falls back.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The placeholder morning from the brief, to edit in the app. */
export function seedData(): StoreData {
  const rows: [name: string, handsOnMin: number, waitMin: number, optional: boolean, after: string[]][] = [
    ['Brush teeth', 3, 0, false, []],
    ['Make coffee', 2, 4, false, []],
    ["Prepare dog's breakfast", 3, 0, false, []],
    ['Take dog for walk', 20, 0, false, []],
    ['Wash hair', 10, 0, true, []],
    ['Turn on iron', 0.5, 3, true, []],
    ['Get clothes', 3, 0, false, []],
    ['Iron clothes', 8, 0, true, ['Turn on iron', 'Get clothes']],
    ['Change', 5, 0, false, ['Get clothes', 'Iron clothes']],
    ['Do hair', 10, 0, false, ['Wash hair']],
    ['Pack bag', 5, 0, true, []],
  ];
  const ids = new Map(rows.map(([name]) => [name, newId()]));
  const tasks: TaskDef[] = rows.map(([name, handsOnMin, waitMin, , after]) => ({
    id: ids.get(name)!,
    name,
    handsOnSec: handsOnMin * 60,
    waitSec: waitMin * 60,
    after: after.map((n) => ids.get(n)!),
  }));
  const flow: Flow = {
    id: newId(),
    name: 'Morning',
    ending: 'leave',
    items: rows.map(([name, , , optional]) => ({ taskId: ids.get(name)!, optional })),
  };
  return {
    version: STORE_VERSION,
    tasks,
    flows: [flow],
    activeFlowId: flow.id,
    plans: [],
    runs: [],
    settings: { bufferMin: 10 },
  };
}

// ---- Validation, for loading and importing ----

class BadData extends Error {}

const fail = (what: string): never => {
  throw new BadData(`This doesn't look like an Out the Door backup (${what}).`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string) => (typeof v === 'string' ? v : fail(what));
const num = (v: unknown, what: string) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(what));
const optStr = (v: unknown, what: string) => (v === undefined ? undefined : str(v, what));
const optNum = (v: unknown, what: string) => (v === undefined ? undefined : num(v, what));
const arr = <T>(v: unknown, what: string, item: (x: unknown) => T): T[] =>
  Array.isArray(v) ? v.map(item) : fail(what);
const strs = (v: unknown, what: string) => arr(v, what, (x) => str(x, what));

function taskDef(v: unknown): TaskDef {
  if (!isObj(v)) return fail('task');
  return {
    id: str(v.id, 'task id'),
    name: str(v.name, 'task name'),
    handsOnSec: Math.max(0, num(v.handsOnSec, 'hands-on time')),
    waitSec: Math.max(0, num(v.waitSec, 'wait time')),
    after: strs(v.after, 'task rules'),
  };
}

function task(v: unknown): Task {
  return { ...taskDef(v), optional: isObj(v) && v.optional === true };
}

function event(v: unknown): RunEvent {
  if (!isObj(v)) return fail('event');
  const base = { id: str(v.id, 'event id'), at: num(v.at, 'event time') };
  switch (v.type) {
    case 'done':
      return { ...base, type: 'done', taskId: str(v.taskId, 'event task') };
    case 'skip':
      return { ...base, type: 'skip', taskIds: strs(v.taskIds, 'event tasks') };
    case 'add':
      return { ...base, type: 'add', task: task(v.task), position: v.position === 'last' ? 'last' : 'next' };
    case 'undo':
      return { ...base, type: 'undo', targetId: str(v.targetId, 'event target') };
    case 'edit':
      return {
        ...base,
        type: 'edit',
        taskId: str(v.taskId, 'event task'),
        name: str(v.name, 'event name'),
        handsOnSec: Math.max(0, num(v.handsOnSec, 'event minutes')),
      };
    default:
      return fail('event type');
  }
}

const ending = (v: unknown): Ending => (v === 'done' ? 'done' : 'leave');
const planMode = (v: unknown): PlanMode => (v === 'startAt' ? 'startAt' : 'doneBy');

function item(v: unknown): FlowItem {
  if (!isObj(v)) return fail('flow task');
  return { taskId: str(v.taskId, 'flow task'), optional: v.optional === true };
}

function flow(v: unknown): Flow {
  if (!isObj(v)) return fail('flow');
  const usual = isObj(v.usual) ? { mode: planMode(v.usual.mode), time: str(v.usual.time, 'usual time') } : undefined;
  return {
    id: str(v.id, 'flow id'),
    name: str(v.name, 'flow name'),
    ending: ending(v.ending),
    items: arr(v.items, 'flow tasks', item),
    usual,
  };
}

function run(v: unknown): Run {
  if (!isObj(v)) return fail('run');
  return {
    id: str(v.id, 'run id'),
    flowId: str(v.flowId, 'run flow'),
    flowName: str(v.flowName, 'run flow name'),
    ending: ending(v.ending),
    date: str(v.date, 'run date'),
    tasks: arr(v.tasks, 'run tasks', task),
    optionalOn: strs(v.optionalOn, 'run options'),
    finishBy: optNum(v.finishBy, 'finish-by'),
    startedAt: num(v.startedAt, 'start time'),
    finishedAt: optNum(v.finishedAt, 'finish time'),
    events: arr(v.events, 'run events', event),
  };
}

function extra(v: unknown): PlanExtra {
  if (!isObj(v)) return fail('plan task');
  return isObj(v.oneOff) ? { oneOff: taskDef(v.oneOff) } : { taskId: str(v.taskId, 'plan task') };
}

function change(v: unknown): PlanChange {
  if (!isObj(v)) return fail('plan change');
  return {
    taskId: str(v.taskId, 'plan change'),
    name: optStr(v.name, 'plan change name'),
    handsOnSec: v.handsOnSec === undefined ? undefined : Math.max(0, num(v.handsOnSec, 'plan change minutes')),
    leftOut: v.leftOut === true || undefined,
  };
}

function plan(v: unknown): Plan {
  if (!isObj(v)) return fail('plan');
  return {
    date: str(v.date, 'plan date'),
    flowId: str(v.flowId, 'plan flow'),
    optionalOn: strs(v.optionalOn, 'plan options'),
    // Plans saved before extras existed have none.
    extras: v.extras === undefined ? [] : arr(v.extras, 'plan tasks', extra),
    changes: v.changes === undefined ? [] : arr(v.changes, 'plan changes', change),
    order: v.order === undefined ? undefined : strs(v.order, 'plan order'),
    mode: planMode(v.mode),
    time: optStr(v.time, 'plan time'),
    bufferMin: num(v.bufferMin, 'plan buffer'),
  };
}

/**
 * Version 1 had a single list of tasks per routine. Each routine becomes a flow
 * using the same tasks, in the same order, with the same optional switches;
 * task ids are kept, so history and usual times carry straight over.
 */
function fromV1(v: Record<string, unknown>): Omit<StoreData, 'settings' | 'activeRunId'> {
  const routines = arr(v.routines, 'routines', (r) => {
    if (!isObj(r)) return fail('routine');
    return { id: str(r.id, 'routine id'), name: str(r.name, 'routine name'), tasks: arr(r.tasks, 'tasks', task) };
  });
  const lastLeaveBy = optStr(v.lastLeaveBy, 'last leave-by');
  const defs = new Map<Id, TaskDef>();
  for (const r of routines) for (const { optional: _, ...def } of r.tasks) if (!defs.has(def.id)) defs.set(def.id, def);
  const names = new Map(routines.map((r) => [r.id, r.name]));
  return {
    version: STORE_VERSION,
    tasks: [...defs.values()],
    flows: routines.map((r) => ({
      id: r.id,
      name: r.name,
      ending: 'leave' as const,
      items: r.tasks.map((t) => ({ taskId: t.id, optional: t.optional })),
      usual: lastLeaveBy ? { mode: 'doneBy' as const, time: lastLeaveBy } : undefined,
    })),
    activeFlowId: str(v.activeRoutineId, 'active routine'),
    plans: arr(v.plans, 'plans', (p) => {
      if (!isObj(p)) return fail('plan');
      return {
        date: str(p.date, 'plan date'),
        flowId: str(p.routineId, 'plan routine'),
        optionalOn: strs(p.optionalOn, 'plan options'),
        extras: [],
        changes: [],
        mode: 'doneBy' as const,
        time: optStr(p.leaveBy, 'plan leave-by'),
        bufferMin: num(p.bufferMin, 'plan buffer'),
      };
    }),
    runs: arr(v.runs, 'mornings', (x) => {
      if (!isObj(x)) return fail('morning');
      const routineId = str(x.routineId, 'morning routine');
      return run({
        ...x,
        flowId: routineId,
        flowName: names.get(routineId) ?? 'Morning',
        ending: 'leave',
        finishBy: x.leaveBy,
      });
    }),
  };
}

/** Checks and tidies a parsed document, migrating older versions. Throws a readable error if it isn't one. */
export function validateData(v: unknown): StoreData {
  if (!isObj(v)) return fail('not an object');
  if (typeof v.version !== 'number') return fail('no version');
  if (v.version > STORE_VERSION) {
    throw new BadData('This backup is from a newer version of the app. Update the app, then import again.');
  }
  const body =
    v.version === 1
      ? fromV1(v)
      : {
          version: STORE_VERSION,
          tasks: arr(v.tasks, 'tasks', taskDef),
          flows: arr(v.flows, 'flows', flow),
          activeFlowId: str(v.activeFlowId, 'active flow'),
          plans: arr(v.plans, 'plans', plan),
          runs: arr(v.runs, 'runs', run),
        };
  if (body.flows.length === 0) return fail('no flows');
  // A flow only lists tasks that exist, each once.
  const known = new Set(body.tasks.map((t) => t.id));
  const flows = body.flows.map((f) => {
    const seen = new Set<Id>();
    return { ...f, items: f.items.filter((i) => known.has(i.taskId) && !seen.has(i.taskId) && seen.add(i.taskId)) };
  });
  const activeRunId = optStr(v.activeRunId, 'active run');
  const settings = isObj(v.settings) ? v.settings : fail('settings');
  return {
    ...body,
    version: STORE_VERSION,
    flows,
    activeFlowId: flows.some((f) => f.id === body.activeFlowId) ? body.activeFlowId : flows[0]!.id,
    activeRunId: body.runs.some((r) => r.id === activeRunId && r.finishedAt === undefined) ? activeRunId : undefined,
    settings: { bufferMin: num(settings.bufferMin, 'buffer') },
  };
}

export const isBadData = (e: unknown): e is Error => e instanceof BadData;

// ---- Backup files ----

export interface BackupFile {
  app: 'out-the-door';
  exportedAt: string;
  data: StoreData;
}

export function toBackup(data: StoreData, now = new Date()): string {
  const file: BackupFile = { app: 'out-the-door', exportedAt: now.toISOString(), data };
  return JSON.stringify(file, null, 2);
}

export function fromBackup(text: string): StoreData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('not JSON');
  }
  if (!isObj(parsed) || parsed.app !== 'out-the-door') return fail('wrong file');
  return validateData(parsed.data);
}
