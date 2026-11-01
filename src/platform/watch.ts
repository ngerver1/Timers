// The bridge to the Pixel Watch companion. In a browser (the GitHub Pages PWA)
// there's no WatchBridge plugin and nothing here runs. In the Android app it
// publishes a snapshot of the active run for the watch and applies the watch's
// taps at the time they were made (see docs/pixel-watch-spec.md).
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { parseWatchCommand, tapTime, watchSnapshot, type WatchCommand } from '../engine/watch';
import type { Id } from '../engine/types';
import { activeRun, finishRun, skipTasks, tapDone, undoLast } from '../store/actions';
import { getData, subscribe } from '../store/store';

interface QueuedCommand {
  /** Position in the phone's native queue. */
  seq: number;
  json: string;
}

/** The native side, in android/app (Kotlin). */
export interface WatchBridgePlugin {
  /** Sends the snapshot to the watch as the /otd/snapshot data item. */
  publishSnapshot(options: { json: string }): Promise<void>;
  /** Watch commands the phone has received and kept, oldest first. */
  pendingCommands(): Promise<{ commands: QueuedCommand[] }>;
  /** Forgets queued commands up to and including `upTo`, once they've been applied. */
  ackCommands(options: { upTo: number }): Promise<void>;
  /** A command arrived from the watch. */
  addListener(event: 'command', listener: () => void): Promise<PluginListenerHandle>;
}

// ---- Which watch commands have been dealt with ----

/**
 * Kept apart from the app's data (its own key, not in runs or backups), so the
 * stored document is the same with or without a watch.
 */
const LEDGER_KEY = 'outTheDoor.watch';
const LEDGER_SIZE = 200;

interface Ledger {
  runId?: Id;
  /** Commands dealt with for that run, applied or dropped, oldest first. */
  cmdIds: Id[];
}

let ledger: Ledger = loadLedger();

function loadLedger(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? 'null') as Partial<Ledger> | null;
    if (raw && Array.isArray(raw.cmdIds)) {
      return {
        runId: typeof raw.runId === 'string' ? raw.runId : undefined,
        cmdIds: raw.cmdIds.filter((c) => typeof c === 'string'),
      };
    }
  } catch {
    // No storage (tests, private mode) or a bad value: start afresh.
  }
  return { cmdIds: [] };
}

function remember(runId: Id, cmdId: Id): void {
  const cmdIds = ledger.runId === runId ? [...ledger.cmdIds, cmdId].slice(-LEDGER_SIZE) : [cmdId];
  ledger = { runId, cmdIds };
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // Kept in memory; the run's event ids still catch most repeats.
  }
}

/** The last watch command dealt with for this run, for the snapshot. */
export function lastHandled(runId: Id | undefined): Id | undefined {
  return runId !== undefined && ledger.runId === runId ? ledger.cmdIds.at(-1) : undefined;
}

/** For tests. */
export function resetWatchLedger(): void {
  ledger = { cmdIds: [] };
}

export type ApplyResult = 'applied' | 'repeat' | 'otherRun';

/**
 * Applies one tap from the watch to the active run, at the time it was tapped.
 * A command seen before changes nothing; one for another or finished run is dropped.
 */
export function applyWatchCommand(cmd: WatchCommand, now = Date.now()): ApplyResult {
  const run = activeRun(getData());
  if (!run || run.id !== cmd.runId) return 'otherRun';
  const seen =
    (ledger.runId === run.id && ledger.cmdIds.includes(cmd.cmdId)) || run.events.some((e) => e.id === cmd.cmdId);
  if (seen) return 'repeat';

  const at = tapTime(run, cmd.at, now);
  // A done or skip uses the command's id as the event's, so the repeat check
  // above holds even if the app stopped before the ledger was saved.
  if (cmd.type === 'done') tapDone(cmd.taskId!, at, cmd.cmdId);
  else if (cmd.type === 'skip') skipTasks([cmd.taskId!], at, cmd.cmdId);
  else if (cmd.type === 'undo') undoLast(at, cmd.cmdId);
  else finishRun(at);
  remember(run.id, cmd.cmdId);
  return 'applied';
}

// ---- Wiring, only in the Android app ----

const PUBLISH_DEBOUNCE_MS = 1_000;
/** Projections drift while you run over, so send a fresh one at least this often while a run is on. */
const PUBLISH_EVERY_MS = 60_000;

let started = false;

/** Starts the bridge if the WatchBridge plugin is there; otherwise does nothing. */
export function startWatchBridge(): void {
  if (started || !Capacitor.isPluginAvailable('WatchBridge')) return;
  started = true;
  const bridge = registerPlugin<WatchBridgePlugin>('WatchBridge');

  let lastJson = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = 0;

  const publish = () => {
    timer = undefined;
    lastSent = Date.now();
    const run = activeRun(getData());
    const snapshot = watchSnapshot(run, lastSent, lastHandled(run?.id));
    // With no run, send "nothing running" once. While a run is on, every send
    // also tells the watch the phone is still there.
    const json = JSON.stringify({ ...snapshot, sentAt: 0 });
    if (json === lastJson && run === undefined) return;
    lastJson = json;
    bridge.publishSnapshot({ json: JSON.stringify(snapshot) }).catch(() => {
      lastJson = ''; // try again next time
    });
  };
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(publish, Math.max(0, lastSent + PUBLISH_DEBOUNCE_MS - Date.now()));
  };

  let draining: Promise<void> | undefined;
  const drain = (): Promise<void> =>
    (draining ??= (async () => {
      try {
        const { commands } = await bridge.pendingCommands();
        for (const queued of commands) {
          const cmd = parseWatchCommand(queued.json);
          if (cmd) applyWatchCommand(cmd);
        }
        const last = commands.at(-1);
        if (last) await bridge.ackCommands({ upTo: last.seq });
      } catch {
        // Left in the native queue; the next drain picks them up.
      } finally {
        draining = undefined;
      }
      schedule(); // the watch is waiting to hear its taps landed
    })());

  subscribe(schedule);
  setInterval(() => {
    if (activeRun(getData())) schedule();
  }, PUBLISH_EVERY_MS);
  void bridge.addListener('command', () => void drain());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drain();
  });
  void drain();
}
