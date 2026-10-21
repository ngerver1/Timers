import { useEffect, useMemo, useState } from 'react';
import { finishFrom, latestStart } from '../../engine/plan';
import { activeTasks, closeOver } from '../../engine/routine';
import { foldRun, lastUndoable, plannedFinish, projectState, type DoneTask, type Projection } from '../../engine/run';
import { simulate, type Slot } from '../../engine/simulate';
import { suggestDrops, type DropSuggestion } from '../../engine/suggest';
import { atTime, ceilMinute, dateKey, upcomingTime } from '../../engine/time';
import type { Ending, Flow, Id, Run, Task } from '../../engine/types';
import {
  activeFlow,
  activeRun,
  addOneOff,
  discardRun,
  editRunTask,
  finishRun,
  finishedRuns,
  planFor,
  saveTaskDef,
  selectFlow,
  skipTasks,
  startRun,
  tapDone,
  tasksOf,
  undoLast,
} from '../../store/actions';
import { flowsUsing, offeredFinishBy } from '../../store/flows';
import { useData } from '../../store/store';
import { forSchedule } from '../../features';
import {
  BigClock,
  FlowPicker,
  Icon,
  OptionalPicker,
  Segmented,
  Sheet,
  SlackPill,
  StorageBanners,
  TimeField,
  Toggle,
} from '../components';
import {
  clock,
  dayLabel,
  drift,
  duration,
  earlyLate,
  listNames,
  minutesText,
  nudgedSeconds,
  parseMinutes,
  taskLength,
  taskProgress,
  timer,
  words,
} from '../format';
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
  const flow = activeFlow(data);
  return <StartView key={`${dateKey(now)}-${flow.id}`} flow={flow} now={now} />;
}

// ---- Before Start ----

/** Your choices for each flow survive a trip to another tab, until that day's plan changes. */
const drafts = new Map<Id, { date: string; plan: string; on: Id[]; finishBy: string }>();

function StartView({ flow, now }: { flow: Flow; now: number }) {
  const data = useData();
  const flowTasks = tasksOf(data, flow);
  const w = words(flow.ending);
  const today = dateKey(now);
  const plan = planFor(data, today, flow.id);
  const planKey = JSON.stringify(plan ?? null);
  const [initial] = useState(() => {
    const draft = drafts.get(flow.id);
    if (draft?.date === today && draft.plan === planKey) return draft;
    const on = closeOver(flowTasks, plan?.optionalOn ?? []);
    return { on: [...on], finishBy: offeredFinishBy(flowTasks, on, plan ?? flow.usual, today) };
  });
  const [on, setOn] = useState(() => closeOver(flowTasks, initial.on));
  const [finishBy, setFinishBy] = useState(initial.finishBy);
  useEffect(() => {
    drafts.set(flow.id, { date: today, plan: planKey, on: [...on], finishBy });
  }, [flow.id, today, planKey, on, finishBy]);

  const selected = closeOver(flowTasks, on); // tasks may have been edited since
  // The same schedule a run would follow, from now.
  const schedule = simulate({ tasks: forSchedule(activeTasks(flowTasks, selected)), from: now });
  const outAt = schedule.finish;
  const length = outAt - now;
  const finishAt = finishBy ? upcomingTime(finishBy, now) : undefined;
  const earlier = finishedRuns(data).find((r) => r.date === today && r.flowId === flow.id);
  const several = data.flows.length > 1;

  const start = () => {
    drafts.delete(flow.id);
    startRun(selected, finishBy || undefined);
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>{dayLabel(today)}</h1>
        {plan && <span className="chip">From your plan</span>}
      </header>
      {several && <FlowPicker flows={data.flows} value={flow.id} onChange={selectFlow} />}
      {earlier?.finishedAt !== undefined && (
        <p className="card pad note">
          You were {words(earlier.ending).finishedAt} {clock(earlier.finishedAt)}
          {earlier.finishBy !== undefined && `, ${earlyLate(earlier.finishBy, earlier.finishedAt)}`}.
        </p>
      )}
      {flowTasks.length === 0 ? (
        <p className="card pad note">{flow.name} has no tasks yet. Add some on the Flows tab.</p>
      ) : (
        <section>
          <h2 className="section-title">Optional today</h2>
          <OptionalPicker tasks={flowTasks} on={selected} onChange={setOn} />
        </section>
      )}
      <section className="card pad">
        <TimeField label={w.by} value={finishBy} onChange={setFinishBy} />
      </section>
      <section className="card pad summary">
        <div className="summary-line">
          <span>Takes</span>
          <strong>{duration(length / 1000)}</strong>
        </div>
        <div className="summary-line">
          <span>Start now, {w.finishedAt}</span>
          <strong>{clock(ceilMinute(outAt))}</strong>
        </div>
        {finishAt !== undefined && (
          <div className="summary-line">
            <span>
              {w.by} {clock(finishAt)}
            </span>
            <SlackPill finishBy={finishAt} outAt={outAt} />
          </div>
        )}
      </section>
      {schedule.slots.length > 0 && <ComingUp slots={schedule.slots} finish={outAt} ending={flow.ending} />}
      <AlsoToday flow={flow} today={today} now={now} />
      {/* Pinned above the tab bar, so it's always in reach however long the list. */}
      <div className="start-bar">
        <button type="button" className="btn btn-primary btn-huge" onClick={start} disabled={flowTasks.length === 0}>
          {several ? `Start ${flow.name}` : 'Start'}
        </button>
      </div>
    </div>
  );
}

/** What you'll do if you start now, in order, with times: the same schedule the run will follow. */
function ComingUp({ slots, finish, ending }: { slots: Slot[]; finish: number; ending: Ending }) {
  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">Coming up</h2>
        <span className="section-note">if you start now</span>
      </div>
      <ol className="card list plan-list">
        {slots.map((s) => (
          <li key={s.task.id} className="plan-row">
            <span className="plan-time">{clock(s.start)}</span>
            <span className="plan-name">
              {s.task.name}
              {s.task.optional && <span className="chip">optional</span>}
            </span>
            <span className="plan-length">{taskLength(s.task)}</span>
          </li>
        ))}
        <li className="plan-row plan-finish">
          <span className="plan-time">{clock(ceilMinute(finish))}</span>
          <span className="plan-name">{words(ending).finish}</span>
        </li>
      </ol>
    </section>
  );
}

/** Other flows you've planned for today, still to come. Tap one to switch to it. */
function AlsoToday({ flow, today, now }: { flow: Flow; today: string; now: number }) {
  const data = useData();
  const items = data.flows
    .filter((f) => f.id !== flow.id)
    .flatMap((f) => {
      const plan = planFor(data, today, f.id);
      if (!plan?.time) return [];
      const list = tasksOf(data, f);
      const tasks = forSchedule(activeTasks(list, closeOver(list, plan.optionalOn)));
      const fixed = atTime(today, plan.time);
      const start = plan.mode === 'doneBy' ? latestStart(tasks, fixed) : fixed;
      const finish = plan.mode === 'doneBy' ? fixed : finishFrom(tasks, fixed);
      return finish > now ? [{ flow: f, start, finish }] : [];
    })
    .sort((a, b) => a.start - b.start);
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="section-title">Also planned today</h2>
      <ul className="card list">
        {items.map(({ flow: f, start, finish }) => (
          <li key={f.id}>
            <button type="button" className="row also-row" onClick={() => selectFlow(f.id)}>
              <span className="row-main">
                <span className="row-title">{f.name}</span>
                <span className="row-meta">
                  start {clock(start)} · {words(f.ending).finishedAt} {clock(ceilMinute(finish))}
                </span>
              </span>
              <Icon name="next" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
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
  const [editing, setEditing] = useState<Task | null>(null);
  const [mode, cycleMode] = useHeroMode();
  const header = useCollapsingHeader();

  const p = projectState(state, now);
  const suggestion = run.finishBy !== undefined ? suggestDrops(state, now, run.finishBy) : undefined;
  const later = p.current ? p.upcoming.slice(1) : p.upcoming;
  const stale = now - run.startedAt > 12 * 3_600_000;
  const w = words(run.ending);

  const finish = () => {
    const left = p.upcoming.length;
    if (left > 0 && !confirm(`${left} task${left > 1 ? 's' : ''} not done. ${w.finishButton} anyway?`)) return;
    finishRun();
  };

  return (
    <div className="running">
      <div
        ref={header.ref}
        className={`run-header${header.condensed ? ' condensed' : ''}${header.scrolled ? ' scrolled' : ''}`}
      >
        <StorageBanners />
        <Hero
          run={run}
          outTheDoor={p.outTheDoor}
          planned={planned}
          now={now}
          overMs={p.current ? Math.max(0, -progressOf(p.current, now).leftMs) : 0}
          mode={mode}
          onCycle={cycleMode}
        />
        <NowCard p={p} now={now} ending={run.ending} canUndo={lastUndoable(run) !== undefined} onEdit={setEditing} />
      </div>
      <div style={{ height: header.spacerHeight }} aria-hidden="true" />

      <div className="stack">
        {stale && <StaleRun run={run} />}

        {suggestion && run.finishBy !== undefined && (
          <DropCard suggestion={suggestion} finishBy={run.finishBy} ending={run.ending} />
        )}

        <div className="action-row">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} /> One-off task
          </button>
          <button type="button" className="btn btn-door" onClick={finish}>
            {w.finishButton}
          </button>
        </div>

        {later.length > 0 && (
          <section>
            <h2 className="section-title">Up next</h2>
            <ul className="card list">
              {later.map((s) => (
                <UpcomingRow key={s.task.id} slot={s} onEdit={() => setEditing(s.task)} />
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
          onClick={() => confirm("Discard this run? It won't be saved to History.") && discardRun()}
        >
          Discard this run
        </button>
      </div>

      {adding && <AddOneOffSheet onClose={() => setAdding(false)} />}
      {editing && <EditRunTaskSheet task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The big finish-time display. Tapping it cycles time, countdown and both. */
function Hero(props: {
  run: Run;
  outTheDoor: number;
  planned: number;
  now: number;
  /** How far the current task is over its planned time (0 if it isn't). */
  overMs: number;
  mode: HeroMode;
  onCycle: () => void;
}) {
  const { run, outTheDoor, planned, now, overMs, mode } = props;
  const data = useData();
  const w = words(run.ending);
  const outAt = ceilMinute(outTheDoor);
  const countdown = timer(Math.ceil((outTheDoor - now) / 1000) * 1000);
  const change = drift(outTheDoor, planned);
  const label = mode === 'countdown' ? w.finishIn : w.finish;
  return (
    <section className={`hero hero-${mode}${overMs > 0 ? ' hero-over' : ''}`}>
      <button
        type="button"
        className="hero-main"
        onClick={props.onCycle}
        aria-label={`${w.finish} at ${clock(outAt)}, in ${countdown}. Tap to switch the display.`}
      >
        <span className="hero-label">{data.flows.length > 1 ? `${run.flowName} · ${label}` : label}</span>
        <span className="hero-figures">
          {mode !== 'countdown' && <BigClock ms={outAt} />}
          {mode !== 'time' && <span className="big-clock">{countdown}</span>}
        </span>
        {overMs > 0 && <span className="hero-alert">Running over · +{timer(overMs)}</span>}
        <span className="mode-dots" aria-hidden="true">
          {HERO_MODES.map((m) => (
            <i key={m} className={m === mode ? 'on' : undefined} />
          ))}
        </span>
      </button>
      <div className="hero-sub">
        <span className={`pill pill-drift pill-${change.tone}`}>{change.text}</span>
        {run.finishBy !== undefined && (
          <>
            <SlackPill finishBy={run.finishBy} outAt={outTheDoor} />
            <span className="muted hero-leave">
              {w.by.toLowerCase()} {clock(run.finishBy)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

/** The current task, with its Done button. Slims to one line while the list is scrolled. */
function NowCard(props: {
  p: Projection;
  now: number;
  ending: Ending;
  canUndo: boolean;
  onEdit: (task: Task) => void;
}) {
  const { p, now, canUndo } = props;
  const w = words(props.ending);
  const current = p.current;
  const next = p.upcoming[0];
  return (
    <section className="card now">
      <div className="now-top">
        <div className="now-text">
          <div className="now-label">{current ? 'Now' : p.allDone ? 'All done' : 'Nothing ready yet'}</div>
          <div className="now-name">{current ? current.task.name : p.allDone ? w.allDone : next?.task.name}</div>
          {current && <AdjustPlanned task={current.task} />}
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
          {w.finishButton}
        </button>
      )}
      <div className="now-actions">
        {current && (
          <button type="button" className="btn" onClick={guarded('advance', () => skipTasks([current.task.id]))}>
            Skip
          </button>
        )}
        {current && (
          <button type="button" className="btn" onClick={() => props.onEdit(current.task)}>
            <Icon name="edit" size={18} /> Edit
          </button>
        )}
        <button type="button" className="btn" disabled={!canUndo} onClick={guarded('undo', () => undoLast())}>
          <Icon name="undo" size={20} /> Undo
        </button>
      </div>
    </section>
  );
}

const progressOf = (slot: Slot, now: number) => taskProgress(slot.task.handsOnSec * 1000, now - slot.start);

/** Quick −/+ on the live task's planned time, for this run only ("it's raining, short walk"). */
function AdjustPlanned({ task }: { task: Task }) {
  const nudge = (minutes: number) => {
    const sec = nudgedSeconds(task.handsOnSec, minutes);
    if (sec !== task.handsOnSec) editRunTask(task.id, task.name, sec);
  };
  return (
    <div className="now-adjust" role="group" aria-label="Change the planned time">
      {[-5, -1].map((m) => (
        <button key={m} type="button" className="btn btn-adjust" onClick={() => nudge(m)} aria-label={`${-m} min less`}>
          −{-m}
        </button>
      ))}
      <span className="now-planned">
        <strong>{duration(task.handsOnSec)}</strong>
        <small>planned</small>
      </span>
      {[1, 5].map((m) => (
        <button key={m} type="button" className="btn btn-adjust" onClick={() => nudge(m)} aria-label={`${m} min more`}>
          +{m}
        </button>
      ))}
    </div>
  );
}

/** Countdown ring for the current task: drains over its planned time, then a red arc grows as you run over. */
function TaskTimer({ slot, now }: { slot: Slot; now: number }) {
  const { leftMs: left, over, ring } = progressOf(slot, now);
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
          strokeDashoffset={circumference * (1 - ring)}
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

function UpcomingRow({ slot, onEdit }: { slot: Slot; onEdit: () => void }) {
  return (
    <li className="row">
      <button type="button" className="row-main row-button" onClick={onEdit} aria-label={`Edit ${slot.task.name}`}>
        <span className="row-title">{slot.task.name}</span>
        <span className="row-meta">
          {clock(slot.start)} · {taskLength(slot.task)}
          <Icon name="edit" size={14} />
        </span>
      </button>
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

function DropCard(props: { suggestion: DropSuggestion; finishBy: number; ending: Ending }) {
  const { suggestion } = props;
  const w = words(props.ending);
  const names = listNames(suggestion.drop.map((t) => t.name));
  return (
    <section className="card pad suggest">
      <p>
        {suggestion.onTime ? (
          <>
            Drop <strong>{names}</strong> {w.toBeBy} {clock(props.finishBy)}.
          </>
        ) : (
          <>
            Dropping <strong>{names}</strong> gets you closest: {w.finishedAt}{' '}
            {clock(ceilMinute(suggestion.outTheDoor))}.
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
      <p>
        {run.flowName} from {dayLabel(run.date)} is still open.
      </p>
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

/** Fixes a task during a run: for this run, and optionally for next time too. */
function EditRunTaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const data = useData();
  const def = data.tasks.find((t) => t.id === task.id);
  const usedIn = flowsUsing(data.flows, task.id).map((f) => f.name);
  const [name, setName] = useState(task.name);
  const [minutes, setMinutes] = useState(minutesText(task.handsOnSec));
  const [alsoLater, setAlsoLater] = useState(true);
  const value = parseMinutes(minutes);
  const ok = name.trim() !== '' && value !== undefined;
  const save = () => {
    if (!ok) return;
    const fixed = { name: name.trim(), handsOnSec: Math.round(value * 60) };
    if (fixed.name !== task.name || fixed.handsOnSec !== task.handsOnSec) {
      editRunTask(task.id, fixed.name, fixed.handsOnSec);
    }
    if (def && alsoLater) saveTaskDef({ ...def, ...fixed });
    onClose();
  };
  return (
    <Sheet title="Edit task" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Minutes</span>
          <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        {def ? (
          <div className="card list">
            <Toggle
              label="Also change it for next time"
              hint={usedIn.length > 0 ? `Updates it in ${listNames(usedIn)}` : 'Updates it in your task list'}
              checked={alsoLater}
              onChange={setAlsoLater}
            />
          </div>
        ) : (
          <p className="hint">A one-off task, so this only changes this run.</p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!ok}>
          Save
        </button>
      </form>
    </Sheet>
  );
}
