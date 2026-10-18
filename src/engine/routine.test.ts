import { describe, expect, it } from 'vitest';
import { activeTasks, closeOver, createsCycle, switchOff, switchOn } from './routine';
import { morning, task } from './test-helpers';

describe('optional tasks', () => {
  it('switching one on also switches on the optional tasks it needs', () => {
    expect(switchOn(morning, new Set(), 'iron')).toEqual(new Set(['iron', 'ironOn']));
  });

  it('switching one off also switches off the optional tasks that need it', () => {
    expect(switchOff(morning, new Set(['iron', 'ironOn', 'packBag']), 'ironOn')).toEqual(new Set(['packBag']));
  });

  it('switching off a task nothing needs leaves the rest alone', () => {
    expect(switchOff(morning, new Set(['iron', 'ironOn']), 'iron')).toEqual(new Set(['ironOn']));
  });

  it('does not chain through required tasks', () => {
    const tasks = [
      task('y', 1, { optional: true }),
      task('r', 1, { after: ['y'] }),
      task('x', 1, { after: ['r'], optional: true }),
    ];
    expect(switchOn(tasks, new Set(), 'x')).toEqual(new Set(['x']));
    expect(switchOff(tasks, new Set(['x', 'y']), 'y')).toEqual(new Set(['x']));
  });

  it('ignores rules pointing at optional tasks that are off', () => {
    const today = activeTasks(morning, new Set());
    expect(today.map((t) => t.id)).toEqual(['teeth', 'coffee', 'dogFood', 'walk', 'clothes', 'change', 'doHair']);
    expect(today.find((t) => t.id === 'change')!.after).toEqual(['clothes']);
    expect(today.find((t) => t.id === 'doHair')!.after).toEqual([]);
  });

  it('tidies a saved selection', () => {
    expect(closeOver(morning, ['iron', 'teeth', 'deleted-task'])).toEqual(new Set(['iron', 'ironOn']));
  });
});

describe('createsCycle', () => {
  it('spots direct and indirect loops', () => {
    expect(createsCycle(morning, 'clothes', 'change')).toBe(true); // change is already after clothes
    expect(createsCycle(morning, 'ironOn', 'change')).toBe(true); // change → iron → ironOn
    expect(createsCycle(morning, 'teeth', 'teeth')).toBe(true);
    expect(createsCycle(morning, 'change', 'teeth')).toBe(false);
  });
});
