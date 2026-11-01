# Spec: Pixel Watch 2 companion for Out the Door

For an agent starting fresh. Read this whole file, then the README, before writing code.

## Goal

While a flow is running on the phone, the owner can glance at their Pixel Watch 2 to see what to do now and how
long is left, and tap **Done** on the watch instead of getting the phone out.

### Must have (v1)

1. **Now screen** on the watch: current task name, a countdown of its remaining time (counting up in amber once
   over), the projected **Finish at** time, and spare/late against the finish-by time if one is set.
2. **Done** button: ticks off the current task. The watch moves on to the next task immediately, even if the
   phone hasn't answered yet.
3. **Skip** and **Undo** on the watch (Undo cancels the last tap from either device).
4. **Up next**: the next few tasks with their start times, scrollable with the crown.
5. **Finishing up** state once everything is done (count-up since the last task) with a **Finish** button.
6. **Tile** and **complication** showing the current task and time remaining / finish time.
7. Works when the phone is locked in a pocket. Taps made while the phone is out of reach are applied later
   **at the time they were tapped**, so History stays accurate.

### Not in v1

Starting a run from the watch, editing tasks, plans, History or Setup on the watch, one-off tasks, reordering,
standalone watch use without the phone. Note them as possible v2 work; don't build them.

## What exists today (read before designing)

- A React + TypeScript PWA (`src/`), deployed to GitHub Pages from `main`. **No backend.** All data is one JSON
  document in the phone browser's `localStorage` under the key `outTheDoor` (`src/store/store.ts`, schema and
  validation in `src/store/schema.ts`, `STORE_VERSION = 2`).
- A run is an **append-only event log** (`Run.events` in `src/engine/types.ts`): `done`, `skip`, `add`, `edit`,
  `reorder`, `undo`, each with an `id` and an `at` timestamp (epoch ms). Everything shown (current task,
  countdown, finish time) is derived by `foldRun` + `projectState` in `src/engine/run.ts`, using a single-worker
  scheduler (`src/engine/simulate.ts`). Read `run.ts` closely: batching of Done taps within 30 s, the `pinned`
  current task, and `allDoneAt` (finishing up).
- Store actions already take an explicit time: `tapDone(taskId, now)`, `skipTasks(ids, now)`, `undoLast(now)`,
  `finishRun(at)` in `src/store/actions.ts`. **This is the hook for the watch**: apply a watch tap with the time it
  was made on the watch.
- The run screen guards against double taps (600 ms, `guarded()` in `src/ui/screens/Flow.tsx`). Do the same on
  the watch.
- Wording is generic ("Finish at", "Finish by", "Finish"), not "out the door". Keep the watch consistent.
- Tests: Vitest unit tests (`npm test`), Playwright scripts for the web UI. Prettier (single quotes, width 120).

## The core problem: the watch can't reach the data

A Wear OS app cannot read a website's `localStorage`, and there is no server. Something on the phone has to bridge
the web app and the watch. Pick this approach unless you find a blocker, and say so if you do:

**Wrap the existing web app in an Android app with Capacitor, and talk to the watch over the Wear OS Data Layer.**

- The phone app is the same React build in a Capacitor WebView, plus a small native Capacitor plugin (Kotlin)
  for the Data Layer. The web app stays the only source of truth and the only place the engine runs.
- The watch app is native Kotlin with Compose for Wear OS. It never computes the schedule itself; it shows a
  snapshot from the phone and counts down locally from the absolute times in it.
- The PWA on GitHub Pages keeps working as is. The Capacitor build is an extra target from the same code.

Alternatives considered and why not (don't reopen without a reason): a sync backend (Firebase etc.) adds an
account, a server and conflict handling to an offline-first app; porting the engine to Kotlin duplicates logic
that keeps changing; a watch web app isn't possible on Wear OS.

**Data migration.** The Capacitor app has its own storage, separate from the browser's. The owner will move data
with the existing Settings → export/import backup. Make sure that works in the Capacitor build, and tell the owner
the step.

## Architecture

```
Watch (Wear OS app)                         Phone (Capacitor app)
- Now / Up next / Finishing up screens       - Existing React app (unchanged engine)
- Tile + complication                        - Native plugin "WatchBridge" (Kotlin)
- Pending-command queue (DataStore)          -   publishes snapshots, receives commands
        ◄──── DataItem /otd/snapshot ────    -   WearableListenerService + durable command queue
        ──── MessageClient /otd/command ──►   - Foreground service + ongoing notification while a run is on
```

- **Same package name and same signing key for both apps.** The Data Layer only connects apps that match. Put
  both in one Gradle project: `android/app` (Capacitor phone app) and `android/wear` (watch app).
- Suggested application id: `io.github.ngerver1.outthedoor` (ask the owner if they want another).

### Phone → watch: the snapshot

The web app publishes a snapshot whenever the store changes and the active run's projection changes, and at
least once a minute while a run is active (projections drift while you run over). Debounce to at most once per
second. Publish via the plugin as a `DataItem` at `/otd/snapshot` (urgent), JSON in one `"json"` field:

```jsonc
{
  "v": 1,
  "sentAt": 1792354980000,          // phone clock when built
  "run": null | {
    "id": "…", "flowName": "Morning",
    "finishBy": 1792358400000,      // optional
    "finishIfOnTime": 1792357500000,// projected finish if the current task ends on plan
    "lastEventId": "…",             // id of the last event applied, for the watch to clear its queue
    "canUndo": true,
    "state": "task" | "idle" | "finishingUp",
    "current": { "taskId": "…", "name": "Shower", "start": 1792355100000, "plannedMs": 600000 },
    "next": { "name": "Get clothes", "start": 1792355700000 },   // when idle: what starts, and when
    "upcoming": [{ "taskId": "…", "name": "…", "start": 1792355700000, "plannedMs": 180000 }], // up to 8
    "doneAt": 1792357000000         // when finishing up started
  }
}
```

Build it in TypeScript from `projectState` in a new pure function (e.g. `src/engine/watch.ts`) with unit tests.
The watch derives everything from absolute times and its own clock:

- remaining = `current.start + plannedMs − now`; negative means over by that much.
- Finish at = `finishIfOnTime + max(0, now − (current.start + plannedMs))` — running over pushes the finish out
  minute by minute, as on the phone. (This ignores background waits, which are behind a feature switch and off.)
- spare/late = `finishBy − Finish at`.

### Watch → phone: commands

Each tap sends a `MessageClient` message to `/otd/command` (JSON), and is also kept in a durable queue on the
watch until a snapshot shows it applied:

```jsonc
{ "cmdId": "uuid", "runId": "…", "type": "done" | "skip" | "undo" | "finish", "taskId": "…", "at": 1792355400000 }
```

- `at` is the watch's clock at the tap. The phone applies it with that time: `tapDone(taskId, at)`,
  `skipTasks([taskId], at)`, `undoLast(at)`, `finishRun(at)`.
- The phone keeps every `cmdId` it has applied for the active run and ignores repeats, so resending is safe.
  Commands for a different or finished run are dropped.
- Apply in the order sent. Undo is "cancel the last live event", so a queued Done followed by Undo works out the
  same as if both had arrived at once.
- Taps must not be lost when the WebView isn't running: the plugin's `WearableListenerService` writes each
  command to a native queue (Room or a file), and the web app drains it on start, on resume and on a plugin
  event. While a run is active, the phone app also runs a **foreground service with an ongoing notification**
  (current task and finish time), which keeps the process alive and is useful in itself.
- **Clock skew**: phone and watch clocks are network-synced and usually within a second. If an `at` is in the
  future by the phone's clock, or before the run started, clamp it into range.

### Watch behaviour while waiting for the phone

After Done, show the next task from `upcoming` straight away, starting at the tap time, with a small "syncing"
mark until a snapshot arrives whose `lastEventId` covers the command. After Undo, show the previous snapshot's
state. If the phone is unreachable, keep queueing and say "Phone not connected · taps saved". Once the phone's
snapshot arrives it always wins.

## Watch UI (Pixel Watch 2: round, small)

Compose for Wear OS, Material 3 for Wear if stable, else Wear Material. Dark only.

- **Now**: task name (2 lines max, auto-shrink), a ring countdown like the phone's (drains over the planned
  time, amber arc once over, counting up), Finish at underneath. A big **Done** button. Skip and Undo one swipe
  or one scroll away, not next to Done.
- **Idle** (nothing ready yet): "Next: Iron clothes at 7:21".
- **Finishing up**: "All done · Finishing up", count-up since `doneAt`, big **Finish**.
- **No run**: "Nothing running. Start a flow on your phone."
- Haptic on Done, and a short buzz when the current task reaches its planned time.
- Rotary input scrolls Up next.
- **Ongoing activity** (Wear `OngoingActivity`) while a run is on, so the app is one tap from the watch face.
- **Tile**: current task, remaining time, Finish at, Done button. **Complication**: remaining time (short text)
  and current task (long text). Tiles update in the background, so use timeline entries or absolute times rather
  than per-second refreshes.
- Battery: no per-second work when the screen is off. In ambient mode show minutes only.

## Changes to the existing web app

Keep them small and in the existing style (pure engine functions, tests next to them):

1. `src/engine/watch.ts`: `watchSnapshot(run, now)`, with unit tests (task, idle, finishing up, overrun, no run).
2. A thin `src/platform/watch.ts` that is a no-op in the browser and calls the Capacitor plugin when present:
   publish snapshots (subscribed to the store), drain and apply commands (dedupe by `cmdId`).
3. Nothing else in the UI changes. The GitHub Pages build must still work with no Capacitor present.

## Deliverables and milestones

1. **Bridge proof**: Capacitor Android build of the app runs on the phone emulator; plugin sends a dummy
   snapshot that a minimal watch app on a paired Wear OS emulator displays.
2. **Read-only watch**: real snapshots; Now / Idle / Finishing up / No run screens with live countdowns.
3. **Commands**: Done, Skip, Undo, Finish, with the durable queue, dedupe and timestamped apply.
4. **Pocket mode**: foreground service + ongoing notification; taps made while the phone app is backgrounded are
   applied correctly.
5. **Tile, complication, ongoing activity**, haptics, ambient.
6. README section: building both apps, installing on the Pixel Watch 2 (ADB over Wi-Fi, or Play internal
   testing), moving data from the PWA with export/import.

Commit after each milestone. Develop on the branch you're given; don't touch the web app's behaviour beyond the
three changes above.

## Acceptance checks

- Unit tests for `watchSnapshot` and for command apply/dedupe (`npm test`), alongside the existing 118.
- With both emulators paired: start a run on the phone; the watch shows the same task and a countdown within
  1 s of the phone's.
- Tap Done on the watch: the phone moves on, and History's timeline shows the task ending at the watch tap time.
- Put the phone app in the background (or turn off Bluetooth on the emulator pair), tap Done twice and Undo once
  on the watch, then reconnect: the phone ends up exactly as if those taps had happened live.
- Sending the same command twice changes nothing the second time.
- Running over: the watch's ring turns amber and Finish at moves later each minute, matching the phone.
- The PWA build (`npm run build`) and all existing tests still pass, and the Pages site is unchanged.

## Notes for the agent

- A cloud container may not have the Android SDK or emulators. If you can't install them, still build what you
  can (TypeScript side with tests, Kotlin code that compiles with Gradle if the SDK installs), and tell the owner
  exactly what they need to run on their machine to test on the real phone and watch.
- Check current versions of Capacitor, Compose for Wear OS and the Wearable Data Layer APIs before choosing; don't
  rely on memory for API details.
- The owner is in Brisbane (Australia/Brisbane time zone). Display times in the device's local time, 12-hour with
  am/pm, matching the phone app.
- Ask the owner before: changing the app id, adding any cloud service, or changing how runs are stored.
