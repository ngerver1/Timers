import { beforeEach, describe, expect, it } from 'vitest';
import { foldRun } from '../engine/run';
import { MIN, T0 } from '../engine/test-helpers';
import { parseWatchCommand, tapTime, watchSnapshot, type WatchCommand } from '../engine/watch';
import { activeRun, discardRun, replaceAll, startRun, tapDone, undoLast } from '../store/actions';
import { seedData } from '../store/schema';
import { getData } from '../store/store';
import { applyWatchCommand, lastHandled, resetWatchLedger } from './watch';

const at = (min: number) => T0 + min * MIN;
const run = () => activeRun(getData())!;
const taskIds = () => run().tasks.map((t) => t.id);
let n = 0;
const cmd = (type: WatchCommand['type'], min: number, taskId?: string): WatchCommand => ({
  cmdId: `cmd${++n}`,
  runId: run().id,
  type,
  ...(taskId !== undefined && { taskId }),
  at: at(min),
});

beforeEach(() => {
  replaceAll(seedData());
  resetWatchLedger();
  startRun([], undefined, T0);
});

describe('applyWatchCommand', () => {
  it('ticks off a task at the time it was tapped on the watch', () => {
    const [first] = taskIds();
    expect(applyWatchCommand(cmd('done', 2, first), at(5))).toBe('applied');
    const done = foldRun(run()).done.get(first!)!;
    expect(done.tappedAt).toBe(at(2));
  });

  it('ignores the same command sent twice', () => {
    const c = cmd('done', 2, taskIds()[0]);
    applyWatchCommand(c, at(3));
    const before = getData();
    expect(applyWatchCommand(c, at(4))).toBe('repeat');
    expect(getData()).toBe(before);
  });

  it('spots a repeat from the run itself if the ledger was lost', () => {
    const c = cmd('done', 2, taskIds()[0]);
    applyWatchCommand(c, at(3));
    resetWatchLedger();
    expect(applyWatchCommand(c, at(4))).toBe('repeat');
  });

  it('drops commands for another run, or once the run is finished', () => {
    const c = { ...cmd('done', 2, taskIds()[0]), runId: 'old' };
    expect(applyWatchCommand(c, at(3))).toBe('otherRun');
    const finish = cmd('finish', 30);
    expect(applyWatchCommand(finish, at(30))).toBe('applied');
    expect(activeRun(getData())).toBeUndefined();
    expect(getData().runs.at(-1)!.finishedAt).toBe(at(30));
    expect(applyWatchCommand({ ...finish, cmdId: 'again' }, at(31))).toBe('otherRun');
  });

  it('ends up as if taps queued while offline had happened live', () => {
    const [a, b] = taskIds();
    // On the watch, phone out of reach: Done, Done, Undo. Delivered together at 12 min.
    [cmd('done', 3, a), cmd('done', 8, b), cmd('undo', 8.2)].forEach((c) => applyWatchCommand(c, at(12)));
    const late = foldRun(run());

    discardRun(); // same tasks, so the same ids
    startRun([], undefined, T0);
    tapDone(a!, at(3));
    tapDone(b!, at(8));
    undoLast(at(8.2));
    const live = foldRun(run());

    expect([...late.done.keys()]).toEqual([a]);
    expect(late.done).toEqual(live.done);
    expect(late.freeAt).toBe(live.freeAt);
  });

  it('acknowledges an Undo with nothing to undo, and never replays it', () => {
    const u = cmd('undo', 1);
    expect(applyWatchCommand(u, at(1))).toBe('applied');
    expect(run().events).toEqual([]);
    expect(lastHandled(run().id)).toBe(u.cmdId);
    expect(watchSnapshot(run(), at(1), lastHandled(run().id)).run?.ackCmdId).toBe(u.cmdId);
    tapDone(taskIds()[0]!, at(2));
    expect(applyWatchCommand(u, at(3))).toBe('repeat'); // would otherwise undo the Done
    expect(run().events).toHaveLength(1);
  });

  it('skips the task on the watch', () => {
    const [a] = taskIds();
    applyWatchCommand(cmd('skip', 1, a), at(1));
    expect(foldRun(run()).skipped.has(a!)).toBe(true);
  });
});

describe('tapTime', () => {
  it('keeps the tap time when it makes sense', () => {
    expect(tapTime(run(), at(2), at(5))).toBe(at(2));
  });

  it('pulls a tap from the future (a fast watch clock) back to now', () => {
    expect(tapTime(run(), at(6), at(5))).toBe(at(5));
  });

  it('never goes before the start or before the last thing in the log', () => {
    expect(tapTime(run(), at(-3), at(5))).toBe(T0);
    tapDone(taskIds()[0]!, at(4));
    expect(tapTime(run(), at(2), at(5))).toBe(at(4));
  });
});

describe('parseWatchCommand', () => {
  const ok = { cmdId: 'c1', runId: 'r1', type: 'done', taskId: 't1', at: 123 };

  it('reads a command, as JSON or an object', () => {
    expect(parseWatchCommand(JSON.stringify(ok))).toEqual(ok);
    expect(parseWatchCommand({ cmdId: 'c2', runId: 'r1', type: 'undo', at: 5 })).toEqual({
      cmdId: 'c2',
      runId: 'r1',
      type: 'undo',
      at: 5,
    });
  });

  it('turns down anything malformed or from a newer watch app', () => {
    expect(parseWatchCommand('not json')).toBeUndefined();
    expect(parseWatchCommand({ ...ok, type: 'explode' })).toBeUndefined();
    expect(parseWatchCommand({ ...ok, taskId: undefined })).toBeUndefined();
    expect(parseWatchCommand({ ...ok, at: 'soon' })).toBeUndefined();
    expect(parseWatchCommand({ ...ok, v: 99 })).toBeUndefined();
  });
});
