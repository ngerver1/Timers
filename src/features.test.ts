import { describe, expect, it } from 'vitest';
import { task } from './engine/test-helpers';
import { features, forSchedule } from './features';

describe('features', () => {
  it.skipIf(features.waits)('ignores waits while they are switched off, keeping the stored times', () => {
    const tasks = [task('coffee', 2, { wait: 4 }), task('teeth', 3)];
    expect(forSchedule(tasks).map((t) => t.waitSec)).toEqual([0, 0]);
    expect(tasks[0]!.waitSec).toBe(240);
  });
});
