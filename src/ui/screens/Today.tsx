import { useEffect, useMemo, useState } from 'react';
import { routineLength } from '../../engine/plan';
import { activeTasks, closeOver } from '../../engine/routine';
import { foldRun, lastUndoable, plannedFinish, projectState, type DoneTask, type Projection } from '../../engine/run';
import type { Slot } from '../../engine/simulate';
import { suggestDrops, type DropSuggestion } from '../../engine/suggest';
import { ceilMinute, dateKey, upcomingTime } from '../../engine/time';
import type { Id, Run } from '../../engine/types';
import {
  activeRoutine,
  activeRun,
  addOneOff,
  discardRun,
  finishRun,
  finishedRuns,
  planFor,
  skipTasks,
  startRun,
  tapDone,
  undoLast,
} from '../../store/actions';
import { useData } from '../../store/store';
import { forSchedule } from '../../features';
import { BigClock, Icon, OptionalPicker, Segmented, Sheet, SlackPill, StorageBanners, TimeField } from '../components';
import { clock, dayLabel, drift, duration, earlyLate, listNames, parseMinutes, taskLength, timer } from '../format';
import {
  HERO_MODES,
  useCollapsingHeader,
  useHeroMode,
  useNow,
  useWaitWatcher,
  useWakeLock,
  type HeroMode,
} from '../hooks';

export function TodayScreen() {
  const data = useData();
  const now = useNow(1000);
  const run = activeRun(data);
  if (run) return <RunningView run={run} now={now} />;
  return <StartView key={dateKey(now)} now={now} />;
}

// ---- Before Start ----

/** Your choices survive a trip to another tab. */
let draft: { date: string; on: Id[]; leaveBy: string } | undefined;

function StartView({ now }: { now: number }) {
  const data = useData();
  const routine = activeRoutine(data);
  const today = dateKey(now);
  const plan = planFor(data, today);
  const [on, setOn] = useState(() =>
    closeOver(routine.tasks, draft?.date === today ? draft.on : (plan?.optionalOn ?? [])),
  );
  const [leaveBy, setLeaveBy] = useState(() =>
    draft?.date === today ? draft.leaveBy : (plan?.leaveBy ?? data.lastLeaveBy ?? ''),
  );
  useEffect(() => {
    draft = { date: today, on: [...on], leaveBy };
  }, [today, on, leaveBy]);

  const selected = closeOver(routine.tasks, on); // tasks may have been edited since
  const length = routineLength(forSchedule(activeTasks(routine.tasks, selected)));
  const outAt = now + length;
  const leaveAt = leaveBy ? upcomingTime(leaveBy, now) : undefined;
  const earlier = finishedRuns(data).find((r) => r.date === today);

  const start = () => {
    draft = undefined;
    startRun(selected, leaveBy || undefined);
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>{dayLabel(today)}</h1>
        {plan && <span className="chip">From your plan</span>}
      </header>
      {earlier?.finishedAt !== undefined && (
        <p className="card pad note">
          You were out the door at {clock(earlier.finishedAt)}
          {earlier.leaveBy !== undefined && `, ${earlyLate(earlier.leaveBy, earlier.finishedAt)}`}.
        </p>
      )}
      <section>
        <h2 className="section-title">Optional today</h2>
        <OptionalPicker tasks={routine.tasks} on={selected} onChange={setOn} />
      </section>
      <section className="card pad">
        <TimeField label="Leave by" value={leaveBy} onChange={setLeaveBy} />
      </section>
      <section className="card pad summary">
        <div className="summary-line">
          <span>Takes</span>
          <strong>{duration(length / 1000)}</strong>
        </div>
        <div className="summary-line">
          <span>Start now, out by</span>
          <strong>{clock(ceilMinute(outAt))}</strong>
        </div>
        {leaveAt !== undefined && (
          <div className="summary-line">
            <span>Leave by {clock(leaveAt)}</span>
            <SlackPill leaveBy={leaveAt} outAt={outAt} />
          </div>
        )}
      </section>
      <button type="button" className="btn btn-primary btn-huge" onClick={start}>
        Start
      </button>
    </div>
  );
}

// ---- Running ----

/**
 * Ignores a second tap of the same kind within 600 ms. After Done, the next
 * task's button lands where your finger is, so a double tap would otherwise
 * tick off two tasks. Undo has its own guard, so Done then a quick Undo works.
 */
const lastTaps = new Map<'advance' | 'undo', number>();
const guarded = (kind: 'advance' | 'undo', action: () => void) => () => {
  const t = Date.now();
  if (t - (lastTaps.get(kind) ?? 0) < 600) return;
  lastTaps.set(kind, t);
  action();
};

function RunningView({ run, now }: { run: Run; now: number }) {
  useWakeLock(true);
  const state = useMemo(() => foldRun(run), [run]);
  useWaitWatcher(state, now);
  const planned = useMemo(() => plannedFinish(run), [run.startedAt, run.tasks]);
  const [adding, setAdding] = useState(false);
  const [mode, cycleMode] = useHeroMode();
  const header = useCollapsingHeader();

  const p = projectState(state, now);
  const suggestion = run.leaveBy !== undefined ? suggestDrops(state, now, run.leaveBy) : undefined;
  const later = p.current ? p.upcoming.slice(1) : p.upcoming;
  const stale = now - run.startedAt > 12 * 3_600_000;

  const outTheDoor = () => {
    const left = p.upcoming.length;
    if (left > 0 && !confirm(`${left} task${left > 1 ? 's' : ''} not done. Out the door anyway?`)) return;
    finishRun();
  };

  return (
    <div className="running">
      <div
        ref={header.ref}
        className={`run-header${header.condensed ? ' condensed' : ''}${header.scrolled ? ' scrolled' : ''}`}
      >
        <StorageBanners />
        <Hero run={run} outTheDoor={p.outTheDoor} planned={planned} now={now} mode={mode} onCycle={cycleMode} />
        <NowCard p={p} now={now} canUndo={lastUndoable(run) !== undefined} />
      </div>
      <div style={{ height: header.spacerHeight }} aria-hidden="true" />

      <div className="stack">
        {stale && <StaleRun run={run} />}

        {suggestion && run.leaveBy !== undefined && <DropCard suggestion={suggestion} leaveBy={run.leaveBy} />}

        <div className="action-row">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} /> One-off task
          </button>
          <button type="button" className="btn btn-door" onClick={outTheDoor}>
            Out the door
          </button>
        </div>

        {later.length > 0 && (
          <section>
            <h2 className="section-title">Up next</h2>
            <ul className="card list">
              {later.map((s) => (
                <UpcomingRow key={s.task.id} slot={s} />
              ))}
            </ul>
          </section>
        )}

        {p.done.length > 0 && (
          <section>
            <h2 className="section-title">Done</h2>
            <ul className="card list">
              {p.done
                .slice()
                .reverse()
                .map((d) => (
                  <DoneRow key={d.task.id} done={d} />
                ))}
            </ul>
          </section>
        )}

        {p.skipped.length > 0 && <p className="muted">Skipped: {listNames(p.skipped.map((t) => t.name))}</p>}

        <button
          type="button"
          className="btn btn-quiet danger-text"
          onClick={() => confirm("Discard this morning? It won't be saved to History.") && discardRun()}
        >
          Discard this morning
        </button>
      </div>

      {adding && <AddOneOffSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

/** The big out-the-door display. Tapping it cycles time, countdown and both. */
function Hero(props: {
  run: Run;
  outTheDoor: number;
  planned: number;
  now: number;
  mode: HeroMode;
  onCycle: () => void;
}) {
  const { run, outTheDoor, planned, now, mode } = props;
  const outAt = ceilMinute(outTheDoor);
  const countdown = timer(Math.ceil((outTheDoor - now) / 1000) * 1000);
  const change = drift(outTheDoor, planned);
  return (
    <section className={`hero hero-${mode}`}>
      <button
        type="button"
        className="hero-main"
        onClick={props.onCycle}
        aria-label={`Out the door at ${clock(outAt)}, in ${countdown}. Tap to switch the display.`}
      >
        <span className="hero-label">{mode === 'countdown' ? 'Out the door in' : 'Out the door'}</span>
        <span className="hero-figures">
          {mode !== 'countdown' && <BigClock ms={outAt} />}
          {mode !== 'time' && <span className="big-clock">{countdown}</span>}
        </span>
        <span className="mode-dots" aria-hidden="true">
          {HERO_MODES.map((m) => (
            <i key={m} className={m === mode ? 'on' : undefined} />
          ))}
        </span>
      </button>
      <div className="hero-sub">
        <span className={`pill pill-drift pill-${change.tone}`}>{change.text}</span>
        {run.leaveBy !== undefined && (
          <>
            <SlackPill leaveBy={run.leaveBy} outAt={outTheDoor} />
            <span className="muted hero-leave">leave by {clock(run.leaveBy)}</span>
          </>
        )}
      </div>
    </section>
  );
}

/** The current task, with its Done button. Slims to one line while the list is scrolled. */
function NowCard({ p, now, canUndo }: { p: Projection; now: number; canUndo: boolean }) {
  const current = p.current;
  const next = p.upcoming[0];
  return (
    <section className="card now">
      <div className="now-top">
        <div className="now-text">
          <div className="now-label">{current ? 'Now' : p.allDone ? 'All done' : 'Nothing ready yet'}</div>
          <div className="now-name">{current ? current.task.name : p.allDone ? 'Ready to go' : next?.task.name}</div>
          {current && <div className="now-detail">planned {duration(current.task.handsOnSec)}</div>}
          {!current && next && <div className="now-detail">can start at {clock(next.start)}</div>}
        </div>
        {current && <TaskTimer key={current.task.id} slot={current} now={now} />}
      </div>
      {current && (
        <button
          type="button"
          className="btn btn-primary btn-done"
          onClick={guarded('advance', () => tapDone(current.task.id))}
        >
          Done
        </button>
      )}
      {p.allDone && (
        <button type="button" className="btn btn-primary btn-done" onClick={() => finishRun()}>
          Out the door
        </button>
      )}
      <div className="now-actions">
        {current && (
          <button type="button" className="btn" onClick={guarded('advance', () => skipTasks([current.task.id]))}>
            Skip
          </button>
        )}
        <button type="button" className="btn" disabled={!canUndo} onClick={guarded('undo', () => undoLast())}>
          <Icon name="undo" size={20} /> Undo
        </button>
      </div>
    </section>
  );
}

/** Countdown ring for the current task: drains over its planned time, then turns red and counts up. */
function TaskTimer({ slot, now }: { slot: Slot; now: number }) {
  const planned = slot.task.handsOnSec * 1000;
  const left = planned - Math.max(0, now - slot.start);
  const over = left < 0;
  const remaining = planned > 0 ? Math.max(0, left) / planned : 0;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const text = over ? `+${timer(-left)}` : timer(Math.ceil(left / 1000) * 1000);
  return (
    <div className={`task-timer${over ? ' over' : ''}`} role="timer" aria-label={`${text} ${over ? 'over' : 'left'}`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r={radius} />
        <circle
          className="fill"
          cx="18"
          cy="18"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (over ? 1 : remaining))}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="task-timer-text">
        {text}
        <small>{over ? 'over' : 'left'}</small>
      </span>
    </div>
  );
}

function UpcomingRow({ slot }: { slot: Slot }) {
  return (
    <li className="row">
      <div className="row-main">
        <div className="row-title">{slot.task.name}</div>
        <div className="row-meta">
          {clock(slot.start)} · {taskLength(slot.task)}
        </div>
      </div>
      <button type="button" className="btn btn-quiet" onClick={guarded('advance', () => skipTasks([slot.task.id]))}>
        Skip
      </button>
      <button
        type="button"
        className="check-btn"
        aria-label={`Done: ${slot.task.name}`}
        onClick={guarded('advance', () => tapDone(slot.task.id))}
      >
        <Icon name="check" />
      </button>
    </li>
  );
}

function DoneRow({ done }: { done: DoneTask }) {
  return (
    <li className="row done-row">
      <span className="done-tick">
        <Icon name="check" size={18} />
      </span>
      <div className="row-main">
        <div className="row-title">{done.task.name}</div>
        <div className="row-meta">
          took {duration((done.handsOnEnd - done.start) / 1000)} · planned {duration(done.task.handsOnSec)}
        </div>
      </div>
    </li>
  );
}

function DropCard({ suggestion, leaveBy }: { suggestion: DropSuggestion; leaveBy: number }) {
  const names = listNames(suggestion.drop.map((t) => t.name));
  return (
    <section className="card pad suggest">
      <p>
        {suggestion.onTime ? (
          <>
            Drop <strong>{names}</strong> to leave by {clock(leaveBy)}.
          </>
        ) : (
          <>
            Dropping <strong>{names}</strong> gets you closest: out by {clock(ceilMinute(suggestion.outTheDoor))}.
          </>
        )}
      </p>
      <button
        type="button"
        className="btn"
        onClick={guarded('advance', () => skipTasks(suggestion.drop.map((t) => t.id)))}
      >
        Drop {suggestion.drop.length > 1 ? 'them' : 'it'}
      </button>
    </section>
  );
}

function StaleRun({ run }: { run: Run }) {
  const lastTap = Math.max(run.startedAt, ...run.events.map((e) => e.at));
  return (
    <section className="card pad note">
      <p>The morning you started on {dayLabel(run.date)} is still open.</p>
      <div className="action-row">
        <button type="button" className="btn" onClick={() => finishRun(lastTap)}>
          Save it to History
        </button>
        <button type="button" className="btn" onClick={() => confirm('Discard it?') && discardRun()}>
          Discard
        </button>
      </div>
    </section>
  );
}

function AddOneOffSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [position, setPosition] = useState<'next' | 'last'>('next');
  const value = parseMinutes(minutes);
  const ok = name.trim() !== '' && value !== undefined;
  const add = () => {
    if (!ok) return;
    addOneOff(name.trim(), value, position);
    onClose();
  };
  return (
    <Sheet title="Add a one-off task" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="field">
          <span>What is it?</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sign school form" />
        </label>
        <label className="field">
          <span>Minutes</span>
          <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <Segmented
          value={position}
          options={[
            ['next', 'Do it next'],
            ['last', 'At the end'],
          ]}
          onChange={setPosition}
        />
        <button type="submit" className="btn btn-primary" disabled={!ok}>
          Add
        </button>
      </form>
    </Sheet>
  );
}
