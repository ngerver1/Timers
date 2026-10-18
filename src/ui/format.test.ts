import { describe, expect, it } from 'vitest';
import { at } from '../engine/test-helpers';
import { duration, earlyLate, listNames, minutesText, parseMinutes, slack, timer } from './format';

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
