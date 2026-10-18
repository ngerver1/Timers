# Out the Door

A phone web app that shows, live, when you'll be out of the house in the morning, updating as you tick tasks off.
Installable, works offline, and keeps everything on the phone.

Live at **https://ngerver1.github.io/Timers/**

## Using it

- **Today**: switch on today's optional tasks, set an optional leave-by time and tap **Start**. While it runs you get
  the out-the-door time, how far ahead or behind you are, the current task with a big **Done**, Skip, Undo, one-off
  tasks, and **Out the door** to finish and save. The screen stays awake.
- **Plan**: choose the optional tasks and leave-by time for a morning (tomorrow by default) and see when to get up.
  That morning's Start screen is filled in from the plan.
- **Tasks**: drag to reorder (the order is the priority), tap to edit hands-on time, wait, optional and "after" rules.
- **History**: past mornings, and each task's usual time (median of the last 10 mornings) with one tap to adopt it.
- **Settings**: default get-up buffer, and backup export/import.

## How the estimate works

- You are the only worker, so hands-on parts never overlap; only waits (coffee brewing) run alongside other work.
- Whenever you're free you do the first task in your order whose "after" tasks are fully finished, waits included.
  If nothing is ready you're idle until something is.
- Out the door is when the last task, wait included, finishes. Live, it's always _now + what's left_: the current task
  is assumed to have started at your last tap, so finishing early pulls the time in and running over pushes it out.
- Done taps up to 30 seconds apart count as one batch (you did a few things, then tapped them all). The time since you
  were last free is shared between them in proportion to their standard times, in the order you tapped them.
- Skip means "not today"; rules pointing at a skipped or switched-off task are ignored. Switching an optional task on
  also switches on optional tasks it needs; switching one off also switches off optional tasks that need it.
- When you're behind, the app re-simulates combinations of the optional tasks still to do and suggests the fewest
  drops that get you back to your leave-by time.

## Data

Everything is stored on the phone (localStorage). Export a backup from Settings now and then; the backup file is the
same versioned JSON document the app stores, so it can be imported on any device.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run build    # type-check and production build
npm run format   # Prettier
```

- `src/engine`: the scheduling engine, as pure functions with no UI code. `simulate.ts` is the single-worker
  scheduler, `run.ts` folds a morning's taps and projects from the clock, `suggest.ts` picks drops, `plan.ts` works
  back from a finish time, `learning.ts` does the medians.
- `src/store`: the saved document, its validation and backup format, and the actions that change it.
- `src/ui`: screens and components.

Every push runs the tests (`.github/workflows/ci.yml`); pushes to `main` also deploy to GitHub Pages.

## Built in, not switched on yet

- **Wait alerts**: waits already count in every estimate, and `src/ui/alerts.ts` is called whenever a wait finishes.
  Vibration, a chime and a spoken "Coffee's ready" go there.
- **Appointments**: `latestStart` in `src/engine/plan.ts` already works back from a fixed finish time.
- **Sync and stand mode**: a morning is an append-only log of taps, so devices can share it. Storage is isolated in
  `src/store/store.ts`.
- **Several routines**: the data model holds a list of routines; the app shows one.
