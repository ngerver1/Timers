import { useEffect, useMemo, useState } from 'react';
import { routineLength } from '../../engine/plan';
import { activeTasks, closeOver } from '../../engine/routine';
import { foldRun, lastUndoable, projectState, type DoneTask } from '../../engine/run';
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
import { BigClock, Icon, OptionalPicker, Segmented, Sheet, SlackPill, TimeField } from '../components';
import { clock, dayLabel, duration, earlyLate, listNames, parseMinutes, taskLength, timer } from '../format';
import { useNow, useWaitWatcher, useWakeLock } from '../hooks';

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
  const length = routineLength(activeTasks(routine.tasks, selected));
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
  const [adding, setAdding] = useState(false);

  const p = projectState(state, now);
  const suggestion = run.leaveBy !== undefined ? suggestDrops(state, now, run.leaveBy) : undefined;
  const canUndo = lastUndoable(run) !== undefined;
  const current = p.current;
  const later = current ? p.upcoming.slice(1) : p.upcoming;
  const stale = now - run.startedAt > 12 * 3_600_000;

  const outTheDoor = () => {
    const left = p.upcoming.length;
    if (left > 0 && !confirm(`${left} task${left > 1 ? 's' : ''} not done. Out the door anyway?`)) return;
    finishRun();
  };

  return (
    <div className="stack running">
      {stale && <StaleRun run={run} />}

      <section className="hero">
        <div className="hero-label">Out the door</div>
        <BigClock ms={ceilMinute(p.outTheDoor)} className="hero-clock" />
        <div className="hero-sub">
          {run.leaveBy !== undefined ? (
            <>
              <SlackPill leaveBy={run.leaveBy} outAt={p.outTheDoor} />
              <span className="muted">leave by {clock(run.leaveBy)}</span>
            </>
          ) : (
            <span className="muted">No leave-by time today</span>
          )}
        </div>
      </section>

      <section className="card now">
        {current ? (
          <NowTask slot={current} now={now} />
        ) : p.allDone ? (
          <>
            <div className="now-label">All done</div>
            <div className="now-name">
              {p.waits.length > 0 ? `Waiting on ${listNames(p.waits.map((w) => w.task.name))}` : 'Ready to go'}
            </div>
            <button type="button" className="btn btn-primary btn-huge" onClick={() => finishRun()}>
              Out the door
            </button>
          </>
        ) : (
          <>
            <div className="now-label">Nothing ready yet</div>
            {p.upcoming[0] && (
              <>
                <div className="now-name">{p.upcoming[0].task.name}</div>
                <div className="now-time">can start at {clock(p.upcoming[0].start)}</div>
              </>
            )}
          </>
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

      {adding && <AddOneOffSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

function NowTask({ slot, now }: { slot: Slot; now: number }) {
  const elapsed = Math.max(0, now - slot.start);
  const planned = slot.task.handsOnSec * 1000;
  const over = elapsed > planned;
  const fraction = planned > 0 ? Math.min(1, elapsed / planned) : 1;
  return (
    <>
      <div className="now-label">Now</div>
      <div className="now-name">{slot.task.name}</div>
      <div className={`progress${over ? ' over' : ''}`}>
        <div style={{ width: `${fraction * 100}%` }} />
      </div>
      <div className={`now-time${over ? ' over' : ''}`}>
        {over
          ? `${timer(elapsed - planned)} over (planned ${duration(slot.task.handsOnSec)})`
          : `${timer(elapsed)} of ${duration(slot.task.handsOnSec)}`}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-huge"
        onClick={guarded('advance', () => tapDone(slot.task.id))}
      >
        Done
      </button>
    </>
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
