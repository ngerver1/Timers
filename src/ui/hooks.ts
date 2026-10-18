import { useEffect, useRef, useState } from 'react';
import type { RunState } from '../engine/run';
import { waitsEndedBetween } from '../engine/waits';
import { onWaitEnded } from './alerts';

/** The current time, refreshed on each tick of `ms` and whenever the app comes back on screen. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, ms - (Date.now() % ms));
    };
    timer = window.setTimeout(tick, ms - (Date.now() % ms));
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms]);
  return now;
}

/** Keeps the screen on while `active`. Chrome drops the lock when the app is hidden, so it's re-taken on return. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | undefined;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (stopped) void lock.release();
        else sentinel = lock;
      } catch {
        // Refused (battery saver, say): the screen may sleep, nothing else breaks.
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release();
    };
  }, [active]);
}

/** Calls the wait-alert hook for each wait that finishes while the app is open. */
export function useWaitWatcher(state: RunState, now: number): void {
  const checkedUpTo = useRef(now);
  useEffect(() => {
    const ended = waitsEndedBetween(state, checkedUpTo.current, now);
    checkedUpTo.current = Math.max(checkedUpTo.current, now);
    ended.forEach((d) => onWaitEnded(d.task));
  }, [state, now]);
}
