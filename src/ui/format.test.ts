import { describe, expect, it } from 'vitest';
import { at } from '../engine/test-helpers';
import {
  drift,
  duration,
  earlyLate,
  listNames,
  minutesText,
  nudgedSeconds,
  parseMinutes,
  slack,
  taskProgress,
  timer,
} from './format';

describe('format', () => {
  it('writes durations the way you would say them', () => {
    expect(duration(180)).toBe('3 min');
    expect(duration(210)).toBe('3½ min');
    expect(duration(30)).toBe('½ min');
    expect(duration(45)).toBe('45 s');
    expect(duration(80)).toBe('1 min 20 s');
    expect(duration(0)).toBe('0 min');
    expect(duration(69.5 * 60)).toBe('1 h 9½ min');
    expect(duration(3600)).toBe('1 h');
  });

  it('formats running timers', () => {
    expect(timer(65_000)).toBe('1:05');
    expect(timer(3_725_000)).toBe('1:02:05');
  });

  it('compares the estimate with leave-by, rounding the estimate up', () => {
    expect(slack(at(60), at(56.2))).toEqual({ text: '3 min spare', tone: 'ahead' });
    expect(slack(at(60), at(59.5))).toEqual({ text: 'Right on time', tone: 'even' });
    expect(slack(at(60), at(60.1))).toEqual({ text: '1 min behind', tone: 'behind' });
    expect(earlyLate(at(60), at(57))).toBe('3 min early');
    expect(earlyLate(at(60), at(62))).toBe('2 min late');
  });

  it('shows how far the estimate has moved since Start', () => {
    expect(drift(at(63), at(60))).toEqual({ text: '+3 min vs plan', tone: 'behind' });
    expect(drift(at(58), at(60))).toEqual({ text: '−2 min vs plan', tone: 'ahead' });
    expect(drift(at(59.5), at(60))).toEqual({ text: 'On plan', tone: 'even' });
  });

  it('drains the task ring, then grows a red arc as you run over', () => {
    const MIN = 60_000;
    expect(taskProgress(20 * MIN, 10 * MIN)).toEqual({ leftMs: 10 * MIN, over: false, ring: 0.5 });
    expect(taskProgress(20 * MIN, 20 * MIN)).toEqual({ leftMs: 0, over: false, ring: 0 });
    expect(taskProgress(20 * MIN, 25 * MIN)).toEqual({ leftMs: -5 * MIN, over: true, ring: 0.25 });
    expect(taskProgress(20 * MIN, 60 * MIN).ring).toBe(1); // full red once over by the whole planned time
  });

  it('nudges a live task by whole minutes, within limits', () => {
    expect(nudgedSeconds(20 * 60, -5)).toBe(15 * 60);
    expect(nudgedSeconds(3 * 60, -5)).toBe(60); // never below a minute
    expect(nudgedSeconds(30, -1)).toBe(30); // or below what a short task already was
    expect(nudgedSeconds(3 * 60, 1)).toBe(4 * 60);
  });

  it('reads typed minutes', () => {
    expect(parseMinutes('3')).toBe(3);
    expect(parseMinutes('0.5')).toBe(0.5);
    expect(parseMinutes('2,5')).toBe(2.5);
    expect(parseMinutes('')).toBeUndefined();
    expect(parseMinutes('-1')).toBeUndefined();
    expect(parseMinutes('abc')).toBeUndefined();
    expect(minutesText(30)).toBe('0.5');
    expect(minutesText(195)).toBe('3.25');
  });

  it('lists names', () => {
    expect(listNames(['Pack bag'])).toBe('Pack bag');
    expect(listNames(['Turn on iron', 'Iron clothes', 'Pack bag'])).toBe('Turn on iron, Iron clothes and Pack bag');
  });
});
