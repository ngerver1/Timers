import { describe, expect, it } from 'vitest';
import { actualSeconds } from './learning';
import { foldRun, lastUndoable, plannedFinish, project } from './run';
import { add, at, done, editTask, makeRun, mins, reorder, skip, T0, task, undo } from './test-helpers';
import type { Run } from './types';

// teeth 0–3, coffee 3–5 (ready at 9), dog's breakfast 5–8, walk 8–28.
const basic = [task('teeth', 3), task('coffee', 2, { wait: 4 }), task('dogFood', 3), task('walk', 20)];

const outAt = (run: Run, min: number) => mins(project(run, at(min)).outTheDoor);

describe('live estimate', () => {
  it('starts from the plan and holds steady while you are on schedule', () => {
    const run = makeRun(basic);
    expect(mins(plannedFinish(run))).toBe(28);
    expect(outAt(run, 0)).toBe(28);
    expect(outAt(run, 2.5)).toBe(28);
    expect(project(run, at(1)).current?.task.id).toBe('teeth');
  });

  it('pulls in when you finish early', () => {
    const run = makeRun(basic, [done('teeth', 2)]);
    expect(outAt(run, 2)).toBe(27);
    const p = project(run, at(2));
    expect(p.current?.task.id).toBe('coffee');
    expect(p.current?.start).toBe(at(2));
  });

  it('pushes out minute by minute while you run over', () => {
    const run = makeRun(basic);
    expect(outAt(run, 4)).toBe(29);
    expect(outAt(run, 5)).toBe(30);
    expect(outAt(run, 6)).toBe(31);
  });

  it('assumes the next task started when you tapped Done', () => {
    const run = makeRun(basic, [done('teeth', 5)]);
    expect(project(run, at(5)).current?.start).toBe(at(5));
    expect(outAt(run, 5)).toBe(30);
    expect(outAt(run, 6)).toBe(30);
  });

  it('lets you mark any task done, not just the current one', () => {
    const run = makeRun(basic, [done('dogFood', 3)]);
    const p = project(run, at(3));
    expect(p.done.map((d) => d.task.id)).toEqual(['dogFood']);
    expect(p.current?.task.id).toBe('teeth');
    expect(p.current?.start).toBe(at(3));
    expect(outAt(run, 3)).toBe(28);
  });

  it('counts waits still running after everything is done', () => {
    const run = makeRun([task('coffee', 2, { wait: 4 }), task('teeth', 3)], [done('coffee', 2), done('teeth', 5)]);
    const p = project(run, at(5));
    expect(p.allDone).toBe(true);
    expect(p.waits.map((w) => w.task.id)).toEqual(['coffee']);
    expect(outAt(run, 5)).toBe(6);
    expect(outAt(run, 7)).toBe(7); // all finished: out the door is now
  });

  it('does not count idle time as hands-on time', () => {
    const tasks = [task('ironOn', 1, { wait: 5 }), task('iron', 2, { after: ['ironOn'] })];
    const p = project(makeRun(tasks, [done('ironOn', 1)]), at(2));
    expect(p.current).toBeUndefined(); // nothing ready while the iron heats
    expect(p.upcoming[0]?.start).toBe(at(6));
    expect(mins(p.outTheDoor)).toBe(8);
    const later = makeRun(tasks, [done('ironOn', 1), done('iron', 8.5)]);
    expect(actualSeconds(later).get('iron')).toBe(150); // timed from 6, not 1
  });
});

describe('taps made together', () => {
  it('shares the time between them by standard time, in the order tapped', () => {
    // Made coffee, brushed teeth, then tapped both at 5 min.
    const run = makeRun(basic, [done('coffee', 5), done('teeth', 5)]);
    const d = foldRun(run).done;
    expect(mins(d.get('coffee')!.handsOnEnd)).toBe(2);
    expect(mins(d.get('coffee')!.finish)).toBe(6); // brewing since 2, not 5
    expect(mins(d.get('teeth')!.start)).toBe(2);
    expect(mins(d.get('teeth')!.handsOnEnd)).toBe(5);
    expect(actualSeconds(run)).toEqual(
      new Map([
        ['coffee', 120],
        ['teeth', 180],
      ]),
    );
  });

  it('marks the tasks tapped together, so History can show they were done together', () => {
    const run = makeRun(basic, [done('coffee', 5), done('teeth', 5.2), done('dogFood', 9)]);
    const d = foldRun(run).done;
    expect(d.get('coffee')!.batch).toBeDefined();
    expect(d.get('teeth')!.batch).toBe(d.get('coffee')!.batch);
    expect(d.get('dogFood')!.batch).toBeUndefined();
  });

  it('treats taps up to 30 seconds apart as one batch', () => {
    const run = makeRun(basic, [done('coffee', 5), done('teeth', 5 + 10 / 60)]);
    expect(actualSeconds(run)).toEqual(
      new Map([
        ['coffee', 124],
        ['teeth', 186],
      ]),
    );
  });

  it('keeps taps further apart separate', () => {
    const run = makeRun(basic, [done('coffee', 5), done('teeth', 6)]);
    expect(actualSeconds(run)).toEqual(
      new Map([
        ['coffee', 300],
        ['teeth', 60],
      ]),
    );
  });

  it('never puts a task before one it has to wait for', () => {
    const tasks = [task('clothes', 3), task('change', 5, { after: ['clothes'] })];
    const d = foldRun(makeRun(tasks, [done('change', 8), done('clothes', 8)])).done;
    expect(mins(d.get('clothes')!.handsOnEnd)).toBe(3);
    expect(mins(d.get('change')!.start)).toBe(3);
  });

  it('ignores a second tap on the same task', () => {
    const run = makeRun(basic, [done('teeth', 3), done('teeth', 3)]);
    expect(actualSeconds(run)).toEqual(new Map([['teeth', 180]]));
  });
});

describe('times fixed afterwards', () => {
  it('moves everything done after a fixed task by the difference, each keeping its own time', () => {
    // Coffee was done by 5 but Done was tapped at 12: 7 minutes too long.
    const run = {
      ...makeRun(basic, [done('teeth', 3), done('coffee', 12), done('dogFood', 15), done('walk', 35)]),
      corrected: { coffee: 120 },
    };
    const state = foldRun(run);
    const at = (id: string) => [mins(state.done.get(id)!.start), mins(state.done.get(id)!.handsOnEnd)];
    expect(['teeth', 'coffee', 'dogFood', 'walk'].map(at)).toEqual([
      [0, 3],
      [3, 5],
      [5, 8],
      [8, 28],
    ]);
    expect(mins(state.done.get('coffee')!.finish)).toBe(9); // its wait moves with it
    expect(mins(state.freeAt)).toBe(28);
    expect(actualSeconds(run)).toEqual(
      new Map([
        ['teeth', 180],
        ['coffee', 120],
        ['dogFood', 180],
        ['walk', 1200],
      ]),
    );
  });

  it('keeps idle time between tasks where it was', () => {
    // Nothing was ready from 2 to 6 while the iron heated.
    const tasks = [task('ironOn', 1, { wait: 5 }), task('iron', 2, { after: ['ironOn'] }), task('pack', 2)];
    const run = {
      ...makeRun(tasks, [done('ironOn', 2), done('iron', 9), done('pack', 11)]),
      corrected: { ironOn: 60 },
    };
    const d = foldRun(run).done;
    expect([d.get('ironOn')!, d.get('iron')!, d.get('pack')!].map((x) => [mins(x.start), mins(x.handsOnEnd)])).toEqual([
      [0, 1],
      [6, 8],
      [8, 10],
    ]);
  });
});

describe('skip, one-offs and undo', () => {
  it('skipping the task you are on starts the next one now', () => {
    const run = makeRun(basic, [skip(['teeth'], 1)]);
    const p = project(run, at(1));
    expect(p.current?.task.id).toBe('coffee');
    expect(p.current?.start).toBe(at(1));
    expect(p.skipped.map((t) => t.id)).toEqual(['teeth']);
    expect(outAt(run, 1)).toBe(26);
  });

  it('skipping another task leaves the current one running', () => {
    const run = makeRun(basic, [skip(['dogFood'], 1)]);
    const p = project(run, at(1));
    expect(p.current?.task.id).toBe('teeth');
    expect(p.current?.start).toBe(T0);
    expect(outAt(run, 1)).toBe(25);
  });

  it('keeps you on the current task even if a skip frees up a higher-priority one', () => {
    // b needs a; you're on c when you decide not to do a.
    const tasks = [task('b', 2, { after: ['a'] }), task('c', 3), task('a', 1)];
    const p = project(makeRun(tasks, [skip(['a'], 1)]), at(1));
    expect(p.current?.task.id).toBe('c');
    expect(p.current?.start).toBe(T0);
    expect(p.upcoming.map((s) => s.task.id)).toEqual(['c', 'b']);
  });

  it('ignores rules pointing at a skipped task', () => {
    const tasks = [task('ironOn', 1, { wait: 3 }), task('iron', 8, { after: ['ironOn'] })];
    const run = makeRun(tasks, [skip(['ironOn'], 0)]);
    expect(project(run, at(0)).current?.task.id).toBe('iron');
    expect(outAt(run, 0)).toBe(8);
  });

  it('puts a one-off straight after the task you are on', () => {
    const run = makeRun(basic, [add(task('keys', 2), 'next', 1)]);
    const p = project(run, at(1));
    expect(p.current?.task.id).toBe('teeth');
    expect(p.current?.start).toBe(T0);
    expect(p.upcoming[1]?.task.id).toBe('keys');
    expect(outAt(run, 1)).toBe(30);
  });

  it('or at the end', () => {
    const run = makeRun(basic, [add(task('keys', 2), 'last', 1)]);
    expect(project(run, at(1)).upcoming.at(-1)?.task.id).toBe('keys');
  });

  it('starts a one-off straight away if nothing else is ready', () => {
    const tasks = [task('ironOn', 1, { wait: 5 }), task('iron', 2, { after: ['ironOn'] })];
    const run = makeRun(tasks, [done('ironOn', 1), add(task('keys', 2), 'last', 2)]);
    const p = project(run, at(2));
    expect(p.current?.task.id).toBe('keys');
    expect(p.current?.start).toBe(at(2));
  });

  it('editing a task changes this morning straight away', () => {
    const run = makeRun(basic, [editTask('walk', 'Long walk', 25, 1)]);
    const p = project(run, at(1));
    expect(p.upcoming.at(-1)?.task).toMatchObject({ name: 'Long walk', handsOnSec: 25 * 60 });
    expect(outAt(run, 1)).toBe(33);
    expect(p.current?.task.id).toBe('teeth'); // and you stay on what you were doing
    expect(p.current?.start).toBe(T0);
  });

  it('editing the current task resets its countdown, not its start', () => {
    const run = makeRun(basic, [editTask('teeth', 'Brush teeth', 5, 1)]);
    const p = project(run, at(1));
    expect(p.current?.start).toBe(T0);
    expect(mins(p.current!.handsOnEnd)).toBe(5);
    expect(outAt(run, 1)).toBe(30);
  });

  it('an edit can be undone', () => {
    const change = editTask('walk', 'Walk', 25, 1);
    const run = makeRun(basic, [change, undo(change, 2)]);
    expect(outAt(run, 2)).toBe(28);
  });

  it('reordering keeps you on the task you are on, and the rest follow the new order', () => {
    // On teeth, you put the walk first: the coffee brews later, so you finish later.
    const run = makeRun(basic, [reorder(['walk', 'teeth', 'coffee', 'dogFood'], 1)]);
    const p = project(run, at(1));
    expect(p.current?.task.id).toBe('teeth');
    expect(p.current?.start).toBe(T0);
    expect(p.upcoming.map((s) => s.task.id)).toEqual(['teeth', 'walk', 'coffee', 'dogFood']);
    expect(outAt(run, 1)).toBe(29);
    const after = makeRun(basic, [reorder(['walk', 'teeth', 'coffee', 'dogFood'], 1), done('teeth', 3)]);
    expect(project(after, at(3)).current?.task.id).toBe('walk');
  });

  it('a reorder can be undone', () => {
    const change = reorder(['walk', 'teeth', 'coffee', 'dogFood'], 1);
    const run = makeRun(basic, [change, undo(change, 2)]);
    expect(project(run, at(2)).upcoming.map((s) => s.task.id)).toEqual(['teeth', 'coffee', 'dogFood', 'walk']);
    expect(outAt(run, 2)).toBe(28);
  });

  it('undo cancels the last tap', () => {
    const tap = done('teeth', 2);
    const run = makeRun(basic, [tap, undo(tap, 2.2)]);
    const p = project(run, at(2.5));
    expect(p.current?.task.id).toBe('teeth');
    expect(p.current?.start).toBe(T0);
    expect(lastUndoable(run)).toBeUndefined();
  });

  it('undo steps back one tap at a time', () => {
    const first = done('teeth', 3);
    const second = skip(['dogFood'], 4);
    const run = makeRun(basic, [first, second, undo(second, 4.5)]);
    expect(lastUndoable(run)).toBe(first);
    expect(project(run, at(5)).skipped).toEqual([]);
  });
});
