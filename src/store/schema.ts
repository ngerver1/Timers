// The saved document. The whole thing is one versioned JSON object, which is
// also the backup file format.
import type { Id, Routine, Run, RunEvent, Task } from '../engine/types';

export const STORE_VERSION = 1;

export interface Plan {
  /** The morning it's for, YYYY-MM-DD. */
  date: string;
  routineId: Id;
  optionalOn: Id[];
  /** Local "HH:MM". */
  leaveBy?: string;
  bufferMin: number;
}

export interface Settings {
  /** Default gap between waking and starting, for the get-up time. */
  bufferMin: number;
}

export interface StoreData {
  version: typeof STORE_VERSION;
  routines: Routine[];
  activeRoutineId: Id;
  plans: Plan[];
  /** Finished mornings, plus the one in progress. */
  runs: Run[];
  activeRunId?: Id;
  settings: Settings;
  lastLeaveBy?: string;
}

export function newId(): Id {
  // randomUUID needs a secure context; plain-http testing on a LAN falls back.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The placeholder routine from the brief, to edit in the app. */
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
  const tasks: Task[] = rows.map(([name, handsOnMin, waitMin, optional, after]) => ({
    id: ids.get(name)!,
    name,
    handsOnSec: handsOnMin * 60,
    waitSec: waitMin * 60,
    after: after.map((n) => ids.get(n)!),
    optional,
  }));
  const routine: Routine = { id: newId(), name: 'Morning', tasks };
  return {
    version: STORE_VERSION,
    routines: [routine],
    activeRoutineId: routine.id,
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

function task(v: unknown): Task {
  if (!isObj(v)) return fail('task');
  return {
    id: str(v.id, 'task id'),
    name: str(v.name, 'task name'),
    handsOnSec: Math.max(0, num(v.handsOnSec, 'hands-on time')),
    waitSec: Math.max(0, num(v.waitSec, 'wait time')),
    after: strs(v.after, 'task rules'),
    optional: v.optional === true,
  };
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
    default:
      return fail('event type');
  }
}

function run(v: unknown): Run {
  if (!isObj(v)) return fail('morning');
  return {
    id: str(v.id, 'morning id'),
    routineId: str(v.routineId, 'morning routine'),
    date: str(v.date, 'morning date'),
    tasks: arr(v.tasks, 'morning tasks', task),
    optionalOn: strs(v.optionalOn, 'morning options'),
    leaveBy: optNum(v.leaveBy, 'leave-by'),
    startedAt: num(v.startedAt, 'start time'),
    finishedAt: optNum(v.finishedAt, 'finish time'),
    events: arr(v.events, 'morning events', event),
  };
}

function plan(v: unknown): Plan {
  if (!isObj(v)) return fail('plan');
  return {
    date: str(v.date, 'plan date'),
    routineId: str(v.routineId, 'plan routine'),
    optionalOn: strs(v.optionalOn, 'plan options'),
    leaveBy: optStr(v.leaveBy, 'plan leave-by'),
    bufferMin: num(v.bufferMin, 'plan buffer'),
  };
}

/** Checks and tidies a parsed document. Throws a readable error if it isn't one. */
export function validateData(v: unknown): StoreData {
  if (!isObj(v)) return fail('not an object');
  if (typeof v.version !== 'number') return fail('no version');
  if (v.version > STORE_VERSION) {
    throw new BadData('This backup is from a newer version of the app. Update the app, then import again.');
  }
  // Older versions get migrated here once there are any.
  const routines = arr(v.routines, 'routines', (r): Routine => {
    if (!isObj(r)) return fail('routine');
    return { id: str(r.id, 'routine id'), name: str(r.name, 'routine name'), tasks: arr(r.tasks, 'tasks', task) };
  });
  if (routines.length === 0) return fail('no routines');
  const activeRoutineId = str(v.activeRoutineId, 'active routine');
  const runs = arr(v.runs, 'mornings', run);
  const activeRunId = optStr(v.activeRunId, 'active morning');
  const settings = isObj(v.settings) ? v.settings : fail('settings');
  return {
    version: STORE_VERSION,
    routines,
    activeRoutineId: routines.some((r) => r.id === activeRoutineId) ? activeRoutineId : routines[0]!.id,
    plans: arr(v.plans, 'plans', plan),
    runs,
    activeRunId: runs.some((r) => r.id === activeRunId && r.finishedAt === undefined) ? activeRunId : undefined,
    settings: { bufferMin: num(settings.bufferMin, 'buffer') },
    lastLeaveBy: optStr(v.lastLeaveBy, 'last leave-by'),
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
