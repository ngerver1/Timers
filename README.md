# Out the Door

A phone web app that shows, live, when you'll finish a routine (getting out of the house in the morning, getting
dinner on the table), updating as you tick tasks off. Installable, works offline, and keeps everything on the phone.

Live at **https://ngerver1.github.io/Timers/**

## Flows

A flow is a list of tasks you run through, like Morning, Wake up or Dinner. Each flow has its own tasks, order and
optional switches, picked from one shared task list: change Brush teeth's minutes and it changes in every flow that
uses it. A flow is one of two kinds:

- **Morning**: planned the night before, and Plan works out when to get up.
- **Any time**: planned on the day, for things like dinner.

## Using it

- **Flow** shows today's plan for the picked flow: when you'll finish if you start now, how long it takes, your
  finish-by time with the latest you can start and how much spare you have, and **Coming up**, each task in order
  with its start time and length, marked if it's optional, added or changed for today, and anything left out listed
  under it. It's the same schedule the run follows. Other flows planned for today and not done yet are listed under
  **Also planned today**; tap one to switch to it. Two buttons stay pinned above the tab bar:
  - **Edit plan**: every task in today's plan, in order. Drag a task's handle to reorder them for today; **Keep for
    every run** makes it the flow's order, and **Reset** goes back to it. Tap a task to change its name or minutes,
    either **One-off** (today only) or **Every run** (the task itself, in every flow that has it), or to **Leave out
    today** (**Put back** undoes it). Optional tasks have their on/off switch in the same list. Add a **New task** or
    an **Existing task** (one you already have that the flow doesn't): **One-off** puts it in today's plan only,
    after the flow's own tasks, and **Every run** adds it to the flow for good, the same as on the Setup tab. Set the
    finish-by time here too. It's all saved as today's plan, the same one the Plan tab shows for today.
  - **Start**.
- **While a flow runs**:
  - the finish time; tap it to switch between the time, a countdown, and both;
  - how far the estimate has moved since Start (+/− vs plan) and, with a finish-by time, how much spare you have;
  - the current task with a countdown ring, **Done**, Skip, Edit and Undo, and −5/−1/+1/+5 buttons to change its
    planned time for this run (it's raining: short walk);
  - when the current task runs over, the ring grows an amber arc (full when you're over by the whole planned time)
    and a quiet "Running over" line under the clock counts up. Red is kept for being behind your finish-by time;
  - one-off tasks, and **Finish** to finish and save.
  - Tap any task in Up next (or Edit on the current one) to fix its name or minutes for this run, and optionally for
    next time too.

  The clock and current task stay pinned at the top and slim down while you scroll the list; scroll up a little and
  they expand again. The screen stays awake.

- **Plan**: like Google Maps' "Arrive by" and "Depart at". Pick a flow and a day, its optional tasks, and either the
  time to finish by (it works back to when to start, and when to get up) or the time to start (it works out when
  you'll be done). That day's Flow tab follows the plan, and each flow remembers its usual choice.
- **Setup**: switch between flows or make a new one (empty, or with the same tasks as another). Drag to reorder (the
  order is the priority); tap a task (the pencil) to change its name, minutes, whether it's optional in this flow,
  and its "after" rules. **Existing task** reuses a task you already have (from another flow, or one you took out); Settings renames, changes how a
  flow ends, or deletes it.
- **History** is split by flow. It opens on a card per flow (deleted flows that still have runs too): how long it
  typically takes, how the last run went, and a sparkline of recent run times. Tap one for that flow's own page,
  built only from its runs (Back returns to the cards):
  - the typical run time, how runs usually compare with the plan at Start, and how often you made your finish-by
    time, over the last 10 runs;
  - a chart of the last 14 runs' total times, each with a tick at what the plan at Start said; tap a column for its
    details;
  - insights: whether the flow is getting quicker or taking longer (the last 5 runs against the 5 before), the
    task that runs over most, with one tap to use its usual time, and any run way off its plan (under a third or
    over three times the planned time, like a test run), with one tap to delete it;
  - past runs with their total time (the newest 5, the rest a tap away). Delete a run from the chart (pick its
    column, then **Delete**) or from the top of an opened run; a day with several runs can go in one tap. Tap one (or **Timeline** under the chart) for a Gantt-style timeline of
    what actually happened: a row per task on a clock axis, the bar from when you started it to when you finished,
    amber for time beyond its plan, a tick where it was planned to end, and a line at your finish-by time;
  - **Task times**, folded away: each task's usual time in this flow (median of the flow's last 10 runs that
    included it) with one tap to adopt it. The Setup tab shows the same per-flow usual times. A task's minutes are
    shared by every flow that uses it, so adopting one changes it in those flows too.
- **Settings**: default get-up buffer, and backup export/import.

## How the estimate works

- You are the only worker, so tasks never overlap.
- Whenever you're free you do the first task in your order whose "after" tasks are finished.
- The finish is when the last task finishes. Live, it's always _now + what's left_: the current task
  is assumed to have started at your last tap, so finishing early pulls the time in and running over pushes it out.
- Done taps up to 30 seconds apart count as one batch (you did a few things, then tapped them all). The time since you
  were last free is shared between them in proportion to their standard times, in the order you tapped them.
- Skip means "not today"; rules pointing at a skipped or switched-off task, or at a task the flow doesn't use, are
  ignored. Switching an optional task on also switches on optional tasks it needs; switching one off also switches
  off optional tasks that need it.
- When you're behind, the app re-simulates combinations of the optional tasks still to do and suggests the fewest
  drops that get you back to your finish-by time.

## Data

Everything is stored on the phone (localStorage). Export a backup from Settings now and then; the backup file is the
same versioned JSON document the app stores, so it can be imported on any device. Data and backups from before flows
(version 1) are moved over automatically: the old routine becomes a flow with the same tasks, and history carries on.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run build    # type-check and production build
npm run format   # Prettier
```

- `src/engine`: the scheduling engine, as pure functions with no UI code. `simulate.ts` is the single-worker
  scheduler, `run.ts` folds a run's taps and projects from the clock, `suggest.ts` picks drops, `plan.ts` works back
  from a finish time or forward from a start time, `learning.ts` does the medians, `insights.ts` works out run
  times, the summary and the trend for History, `timeline.ts` lays out a finished run for its timeline.
- `src/store`: the saved document (a shared task list plus flows), its validation, migration and backup format, and
  the actions that change it.
- `src/ui`: screens and components.

Every push runs the tests (`.github/workflows/ci.yml`); pushes to `main` also deploy to GitHub Pages.

## Built in, not switched on yet

- **Waits** (coffee brewing while you do other things): the engine schedules them, with tests, and tasks keep their
  wait times, but the app ignores and hides them while `features.waits` in `src/features.ts` is off. Switching it on
  brings back the wait field and labels; `src/ui/alerts.ts` is already called whenever a wait finishes, ready for
  vibration, a chime and a spoken "Coffee's ready".
- **Appointments**: `latestStart` in `src/engine/plan.ts` already works back from a fixed finish time.
- **Sync and stand mode**: a run is an append-only log of taps, so devices can share it. Storage is isolated in
  `src/store/store.ts`.
