import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * A pinned header that slims down while you scroll down and expands again as
 * soon as you scroll up (a collapsing header with "quick return"). The header
 * is fixed, with a spacer as tall as the expanded header in the page flow, so
 * slimming it never moves the content or the scroll position. If it did, that
 * movement would read as a scroll and make the header flicker.
 */
export function useCollapsingHeader() {
  const ref = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(0);
  const condensedHeight = useRef(0);
  const isCondensed = useRef(condensed);
  isCondensed.current = condensed;
  // While the spacer changes, the browser nudges the scroll position; that isn't you scrolling.
  const ignoreScrollUntil = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const height = el.offsetHeight;
      if (isCondensed.current) {
        condensedHeight.current = height;
        return;
      }
      setExpandedHeight((previous) => {
        if (previous !== height) ignoreScrollUntil.current = performance.now() + 250;
        return height;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let last = window.scrollY;
    // Only your own scrolling counts. The browser also scrolls the page to keep
    // things steady when content above changes (a task ticked off, a card
    // appearing), and that shouldn't open or close the header.
    let lastGesture = -Infinity;
    const onGesture = () => {
      lastGesture = performance.now();
    };
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last;
      last = y;
      setScrolled(y > 4);
      if (y <= 0) setCondensed(false);
      const yours = performance.now() - lastGesture < 1000; // a fling keeps going after you let go
      if (!yours || performance.now() < ignoreScrollUntil.current) return;
      // Near the top a slim header would leave a gap above the content, so only slim
      // once that can't happen. Until the slim height is known, assume the worst.
      const slimFrom = expandedHeight - condensedHeight.current;
      if (delta < -2) setCondensed(false);
      else if (delta > 2 && y > slimFrom) setCondensed(true);
    };
    // A tap isn't a scroll: forget the last drag, so the content changes a tap causes don't count.
    const onClick = () => {
      lastGesture = -Infinity;
    };
    const gestures = ['touchmove', 'wheel', 'keydown'] as const;
    gestures.forEach((type) => window.addEventListener(type, onGesture, { passive: true }));
    window.addEventListener('click', onClick, { capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      gestures.forEach((type) => window.removeEventListener(type, onGesture));
      window.removeEventListener('click', onClick, { capture: true });
      window.removeEventListener('scroll', onScroll);
    };
  }, [expandedHeight]);

  return { ref, condensed, scrolled, spacerHeight: expandedHeight };
}

export type HeroMode = 'time' | 'countdown' | 'both';
export const HERO_MODES: HeroMode[] = ['time', 'countdown', 'both'];
const HERO_MODE_KEY = 'outTheDoor.heroMode';

/** The running screen's big display: tapping cycles time, countdown, both. Remembered on this device. */
export function useHeroMode(): [HeroMode, () => void] {
  const [mode, setMode] = useState<HeroMode>(() => {
    try {
      const saved = localStorage.getItem(HERO_MODE_KEY);
      return HERO_MODES.find((m) => m === saved) ?? 'time';
    } catch {
      return 'time';
    }
  });
  const cycle = () => {
    const next = HERO_MODES[(HERO_MODES.indexOf(mode) + 1) % HERO_MODES.length]!;
    setMode(next);
    try {
      localStorage.setItem(HERO_MODE_KEY, next);
    } catch {
      // Not remembered next time; nothing else breaks.
    }
  };
  return [mode, cycle];
}
