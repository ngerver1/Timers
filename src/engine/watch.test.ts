import { describe, expect, it } from 'vitest';
import { project } from './run';
import { at, done, makeRun, mins, skip, task, undo } from './test-helpers';
import { WATCH_PROTOCOL, WATCH_UPCOMING, watchFinishAt, watchSnapshot } from './watch';

const tasks = [task('teeth', 3), task('shower', 10), task('clothes', 3), task('bag', 5)];

describe('watchSnapshot', () => {
  it('sends no run when nothing is running', () => {
    expect(watchSnapshot(undefined, at(0))).toEqual({ v: WATCH_PROTOCOL, sentAt: at(0), run: null });
    const finished = { ...makeRun(tasks), finishedAt: at(30) };
    expect(watchSnapshot(finished, at(31)).run).toBeNull();
  });

  it('describes the task you are on, with what comes after it', () => {
    const run = makeRun(tasks, [done('teeth', 2)], 30);
    const s = watchSnapshot(run, at(4))!;
    expect(s.v).toBe(WATCH_PROTOCOL);
    expect(s.sentAt).toBe(at(4));
    const r = s.run!;
    expect(r.state).toBe('task');
    expect(r.flowName).toBe('Morning');
    expect(r.finishBy).toBe(at(30));
    expect(r.current).toEqual({ taskId: 'shower', name: 'shower', start: at(2), plannedMs: 10 * 60_000 });
    expect(r.upcoming.map((u) => [u.taskId, mins(u.start)])).toEqual([
      ['clothes', 12],
      ['bag', 15],
    ]);
    expect(mins(r.finishIfOnTime)).toBe(20);
    expect(r.canUndo).toBe(true);
    expect(r.lastEventId).toBe(run.events[0]!.id);
  });

  it('leaves out finishBy and lastEventId when there are none', () => {
    const r = watchSnapshot(makeRun(tasks), at(1)).run!;
    expect(r).not.toHaveProperty('finishBy');
    expect(r).not.toHaveProperty('lastEventId');
    expect(r.canUndo).toBe(false);
  });

  it('keeps the on-plan finish while running over, so the watch can add the overrun', () => {
    const run = makeRun(tasks); // teeth planned 0–3
    const r = watchSnapshot(run, at(7)).run!;
    expect(r.current?.taskId).toBe('teeth');
    expect(mins(r.finishIfOnTime)).toBe(21);
    expect(mins(r.upcoming[0]!.start)).toBe(3); // as if teeth ended on plan
    // The watch's Finish at matches the phone's at any moment of the overrun.
    for (const m of [2, 3, 4.5, 7, 12]) {
      expect(watchFinishAt(r, at(m))).toBe(project(run, at(m)).outTheDoor);
    }
  });

  it('says what starts next while nothing is ready', () => {
    const iron = [task('ironOn', 1, { wait: 5 }), task('iron', 2, { after: ['ironOn'] })];
    const r = watchSnapshot(makeRun(iron, [done('ironOn', 1)]), at(2)).run!;
    expect(r.state).toBe('idle');
    expect(r.current).toBeUndefined();
    expect(r.next).toEqual({ name: 'iron', start: at(6) });
    expect(r.upcoming.map((u) => u.taskId)).toEqual(['iron']);
    expect(mins(r.finishIfOnTime)).toBe(8);
  });

  it('switches to finishing up once everything is done or skipped', () => {
    const run = makeRun(tasks, [done('teeth', 3), done('shower', 14), skip(['clothes'], 15), done('bag', 19)]);
    const r = watchSnapshot(run, at(22)).run!;
    expect(r.state).toBe('finishingUp');
    expect(r.doneAt).toBe(at(19));
    expect(r.current).toBeUndefined();
    expect(r.upcoming).toEqual([]);
  });

  it('tracks undo: the undo event is the last event, and the task is current again', () => {
    const d = done('teeth', 2);
    const u = undo(d, 2.2);
    const r = watchSnapshot(makeRun(tasks, [d, u]), at(2.5)).run!;
    expect(r.lastEventId).toBe(u.id);
    expect(r.current?.taskId).toBe('teeth');
    expect(r.canUndo).toBe(false);
  });

  it(`sends at most ${WATCH_UPCOMING} upcoming tasks`, () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`t${i}`, 1));
    const r = watchSnapshot(makeRun(many), at(0)).run!;
    expect(r.upcoming).toHaveLength(WATCH_UPCOMING);
    expect(r.upcoming[0]!.taskId).toBe('t1');
  });
});
