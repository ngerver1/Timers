import { arrayMove } from '@dnd-kit/sortable';
import { useMemo, useState, type ReactNode } from 'react';
import { finishFrom, latestStart } from '../../engine/plan';
import { activeTasks, closeOver, switchOff, switchOn } from '../../engine/routine';
import {
  allDoneAt,
  foldRun,
  lastUndoable,
  plannedFinish,
  projectState,
  type DoneTask,
  type Projection,
} from '../../engine/run';
import { simulate, type Slot } from '../../engine/simulate';
import { suggestDrops, type DropSuggestion } from '../../engine/suggest';
import { atTime, ceilMinute, dateKey, upcomingTime } from '../../engine/time';
import type { Flow, Id, Run, Task, TaskDef } from '../../engine/types';
import {
  activeFlow,
  activeRun,
  addOneOff,
  addToFlow,
  discardRun,
  editRunTask,
  finishRun,
  finishedRuns,
  orderFlow,
  planFor,
  reorderRun,
  savePlan,
  saveTaskDef,
  saveTaskInFlow,
  selectFlow,
  skipTasks,
  startRun,
  tapDone,
  undoLast,
} from '../../store/actions';
import { dayTasks, flowsUsing, offeredFinishBy, planTasks, withChange, type DayTask } from '../../store/flows';
import { newId, type Plan, type PlanExtra } from '../../store/schema';
import { useData } from '../../store/store';
import { forSchedule } from '../../features';
import {
  BigClock,
  FlowPicker,
  Icon,
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
  listNames,
  minutesText,
  nudgedSeconds,
  parseMinutes,
  slack,
  taskLength,
  taskProgress,
  timer,
  wording,
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
import { SortableList, useSortableRow } from '../sortable';

export function FlowScreen() {
  const data = useData();
  const now = useNow(1000);
  const run = activeRun(data);
  // The clock ticks once a second, so a tap can be a moment newer than it. Never show the run from before it.
  if (run) return <RunningView run={run} now={Math.max(now, run.startedAt, run.events.at(-1)?.at ?? 0)} />;
  const flow = activeFlow(data);
  return <StartView key={`${dateKey(now)}-${flow.id}`} flow={flow} now={now} />;
}

// ---- Before Start ----

/**
 * Today's plan for the picked flow, and Start. The plan is what's coming up; Edit
 * plan switches optional tasks, adds others for today and sets the finish-by time,
 * all saved as today's plan (the one the Plan tab shows for today).
 */
function StartView({ flow, now }: { flow: Flow; now: number }) {
  const data = useData();
  const w = wording;
  const today = dateKey(now);
  const saved = planFor(data, today, flow.id);
  const plan: Plan = saved ?? {
    date: today,
    flowId: flow.id,
    optionalOn: [],
    extras: [],
    changes: [],
    mode: flow.usual?.mode ?? 'doneBy',
    time: flow.usual?.time,
    bufferMin: data.settings.bufferMin,
  };
  const [editing, setEditing] = useState(false);

  const list = planTasks(data.tasks, flow, plan); // the flow's own, then today's extras, as changed for today
  const tasks = dayTasks(data.tasks, flow, plan); // the ones not left out
  const selected = closeOver(tasks, plan.optionalOn); // tasks may have been edited since
  const finishBy = offeredFinishBy(tasks, selected, saved ?? flow.usual, today);
  const edit = (change: Partial<Plan>) =>
    savePlan({ ...plan, optionalOn: [...selected], ...change, date: today, flowId: flow.id });
  // The same schedule a run would follow, from now.
  const schedule = simulate({ tasks: forSchedule(activeTasks(tasks, selected)), from: now });
  const finish = schedule.finish;
  const length = finish - now;
  const finishAt = finishBy ? upcomingTime(finishBy, now) : undefined;
  const startBy = finishAt === undefined ? undefined : finishAt - length;
  const several = data.flows.length > 1;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Flow</h1>
      </header>
      {several && <FlowPicker flows={data.flows} value={flow.id} onChange={selectFlow} />}
      {tasks.length === 0 ? (
        <p className="card pad note">
          {list.length === 0
            ? `${flow.name} has no tasks yet. Add some on the Setup tab, or just for today under Edit plan.`
            : `Every task in ${flow.name} is left out today. Put some back under Edit plan.`}
        </p>
      ) : (
        <>
          <section className="card hero">
            <div className="hero-label">
              {flow.name} · {w.finishAt}
            </div>
            <BigClock ms={ceilMinute(finish)} className="hero-clock" />
            <div className="hero-sub">
              <span>{duration(length / 1000)} of tasks</span>
              {finishAt !== undefined && <SlackPill finishBy={finishAt} outAt={finish} />}
            </div>
            {finishAt !== undefined && (
              <div className="hero-sub muted today-by">
                {w.by.toLowerCase()} {clock(finishAt)}
                {startBy !== undefined && startBy >= now && ` · start by ${clock(startBy)}`}
              </div>
            )}
          </section>
          <ComingUp slots={schedule.slots} finish={finish} list={list} />
        </>
      )}
      <AlsoToday flow={flow} today={today} now={now} />
      {/* Pinned above the tab bar, so they're always in reach however long the list. */}
      <div className="start-bar">
        <button type="button" className="btn btn-edit-plan" onClick={() => setEditing(true)}>
          <Icon name="edit" size={20} /> Edit plan
        </button>
        <button
          type="button"
          className="btn btn-primary btn-start"
          onClick={() => startRun(selected, finishBy || undefined)}
          disabled={tasks.length === 0}
        >
          {several ? `Start ${flow.name}` : 'Start'}
        </button>
      </div>
      {editing && (
        <EditPlanSheet
          flow={flow}
          plan={plan}
          list={list}
          tasks={tasks}
          selected={selected}
          finishBy={finishBy}
          edit={edit}
          summary={`Takes ${duration(length / 1000)}. Start now and you'll finish at ${clock(ceilMinute(finish))}${
            finishAt !== undefined ? ` (${slack(finishAt, finish).text.toLowerCase()})` : ''
          }.`}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

const sameOrder = (a: readonly Id[], b: readonly Id[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The day's plan, changed in place: its tasks, tasks added for the day, and the finish-by time. */
function EditPlanSheet(props: {
  flow: Flow;
  plan: Plan;
  list: DayTask[];
  tasks: Task[];
  selected: ReadonlySet<Id>;
  finishBy: string;
  edit: (change: Partial<Plan>) => void;
  summary: string;
  onClose: () => void;
}) {
  const { flow, plan, list, tasks, selected, edit } = props;
  const data = useData();
  // One thing open at a time: a task being changed, or a way to add one.
  const [open, setOpen] = useState<Id | null>(null);
  const [adding, setAdding] = useState<'list' | 'new' | null>(null);
  // A one-off for today's plan, or into the flow for every run (the same as adding it on the Setup tab).
  const [scope, setScope] = useState<'today' | 'flow'>('today');
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [status, setStatus] = useState('');
  const value = parseMinutes(minutes);
  const ids = list.map((d) => d.task.id);
  // Without today's order: the flow's own tasks, then the ones added for today.
  const usual = planTasks(data.tasks, flow, { ...plan, order: undefined }).map((d) => d.task.id);
  const reordered = !sameOrder(ids, usual);
  // Tasks added for today aren't in the flow, so only the flow's own can be kept in a new order.
  const own = new Set(flow.items.map((i) => i.taskId));
  const ownOf = (order: Id[]) => order.filter((id) => own.has(id));
  const flowReordered = !sameOrder(ownOf(ids), ownOf(usual));
  const inPlan = new Set(ids);
  const available = data.tasks.filter((t) => !inPlan.has(t.id));
  const where = scope === 'today' ? 'for today' : `to ${flow.name}`;
  const toggleOpen = (id: Id) => {
    setOpen(open === id ? null : id);
    setAdding(null);
  };
  const toggleAdding = (what: 'list' | 'new') => {
    setAdding(adding === what ? null : what);
    setOpen(null);
  };
  const done = (text: string) => {
    setOpen(null);
    setStatus(text);
  };
  const addExisting = (t: TaskDef) => {
    if (scope === 'today') edit({ extras: [...plan.extras, { taskId: t.id }] });
    else addToFlow(flow.id, t.id);
    setStatus(`${t.name} added ${where}.`);
  };
  const addNew = () => {
    if (!name.trim() || value === undefined) return;
    const def = { id: newId(), name: name.trim(), handsOnSec: Math.round(value * 60), waitSec: 0, after: [] };
    if (scope === 'today') edit({ extras: [...plan.extras, { oneOff: def }] });
    else saveTaskInFlow(flow.id, def, false);
    setStatus(`${def.name} added ${where}.`);
    setName('');
    setMinutes('5');
    setAdding(null);
  };
  const leaveOut = (d: DayTask, out: boolean) => {
    edit({ changes: withChange(plan.changes, d.task.id, { leftOut: out || undefined }) });
    done(`${d.task.name} ${out ? 'left out today' : 'put back'}.`);
  };
  const reorder = (next: Id[]) => {
    edit({ order: sameOrder(next, usual) ? undefined : next });
    setStatus('');
  };
  const keepOrder = () => {
    orderFlow(flow.id, ids);
    // Today keeps its own order only if tasks added for today were moved in among the flow's.
    const after = [...ownOf(ids), ...usual.filter((id) => !own.has(id))];
    edit({ order: sameOrder(ids, after) ? undefined : ids });
    setStatus('Order kept for every run.');
  };
  const resetOrder = () => {
    edit({ order: undefined });
    setStatus('Back to the usual order.');
  };
  const remove = (d: DayTask) => {
    const idOf = (e: PlanExtra) => ('oneOff' in e ? e.oneOff.id : e.taskId);
    edit({
      extras: plan.extras.filter((e) => idOf(e) !== d.task.id),
      changes: plan.changes.filter((c) => c.taskId !== d.task.id),
    });
    done(`${d.task.name} removed.`);
  };
  const scopePicker = (
    <Segmented
      value={scope}
      options={[
        ['today', 'One-off'],
        ['flow', 'Every run'],
      ]}
      onChange={(next) => {
        setScope(next);
        setStatus('');
      }}
    />
  );
  return (
    <Sheet title={`Today's plan · ${flow.name}`} onClose={props.onClose}>
      <div className="stack">
        {list.length > 0 && (
          <section>
            <h3 className="section-title">Tasks</h3>
            <p className="hint plan-hint">Drag to reorder for today. Tap a task to edit it.</p>
            <SortableList ids={ids} onMove={(from, to) => reorder(arrayMove(ids, from, to))}>
              {list.map((d) => (
                <PlanTaskRow
                  key={d.task.id}
                  item={d}
                  tasks={tasks}
                  on={selected.has(d.task.id)}
                  open={open === d.task.id}
                  onOpen={() => toggleOpen(d.task.id)}
                  onSwitch={(on) => edit({ optionalOn: [...(on ? switchOn : switchOff)(tasks, selected, d.task.id)] })}
                  onPutBack={() => leaveOut(d, false)}
                >
                  {open === d.task.id && (
                    <PlanTaskEditor
                      item={d}
                      flow={flow}
                      plan={plan}
                      edit={edit}
                      onLeaveOut={() => leaveOut(d, true)}
                      onRemove={() => remove(d)}
                      onDone={done}
                    />
                  )}
                </PlanTaskRow>
              ))}
            </SortableList>
            {reordered && (
              <div className="reorder-bar">
                <p className="muted">Reordered for today.</p>
                <div className="action-row">
                  {flowReordered && (
                    <button type="button" className="btn btn-small" onClick={keepOrder}>
                      Keep for every run
                    </button>
                  )}
                  <button type="button" className="btn btn-small" onClick={resetOrder}>
                    Reset
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="stack-tight">
          {status && (
            <p className="note-text" role="status">
              {status}
            </p>
          )}
          <div className="action-row">
            {/* Tasks you've made that this flow doesn't have yet, from another flow or ones you took out. */}
            {available.length > 0 && (
              <button
                type="button"
                className={`btn${adding === 'list' ? ' on' : ''}`}
                onClick={() => toggleAdding('list')}
              >
                <Icon name="plus" size={20} /> Existing task
              </button>
            )}
            <button type="button" className={`btn${adding === 'new' ? ' on' : ''}`} onClick={() => toggleAdding('new')}>
              <Icon name="plus" size={20} /> New task
            </button>
          </div>
          {adding === 'list' && available.length > 0 && scopePicker}
          {adding === 'list' && available.length > 0 && (
            <ul className="card list">
              {available.map((t) => {
                const usedIn = flowsUsing(data.flows, t.id).map((f) => f.name);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="row row-button add-row"
                      onClick={() => addExisting(t)}
                      aria-label={`Add ${t.name}`}
                    >
                      <span className="row-main">
                        <span className="row-title">{t.name}</span>
                        <span className="row-meta">
                          {duration(t.handsOnSec)} · {usedIn.length ? `in ${listNames(usedIn)}` : 'not in any flow'}
                        </span>
                      </span>
                      <span className="add-plus">
                        <Icon name="plus" size={20} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {adding === 'new' && (
            <form
              className="card pad stack-tight"
              onSubmit={(e) => {
                e.preventDefault();
                addNew();
              }}
            >
              <label className="field">
                <span>What is it?</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={scope === 'today' ? 'Drop off parcel' : 'Make the bed'}
                />
              </label>
              <label className="field">
                <span>Minutes</span>
                <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </label>
              {scopePicker}
              <button type="submit" className="btn" disabled={!name.trim() || value === undefined}>
                {scope === 'today' ? 'Add to today' : `Add to ${flow.name}`}
              </button>
            </form>
          )}
        </section>

        <section className="card pad">
          <TimeField
            label={wording.by}
            value={props.finishBy}
            onChange={(v) => edit({ mode: 'doneBy', time: v || undefined })}
          />
        </section>
        <p className="muted plan-edit-summary">{props.summary}</p>
        <button type="button" className="btn btn-primary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** One of the day's tasks in Edit plan. Tap it to change it; an optional one has its switch too. */
function PlanTaskRow(props: {
  item: DayTask;
  tasks: Task[];
  on: boolean;
  open: boolean;
  onOpen: () => void;
  onSwitch: (on: boolean) => void;
  onPutBack: () => void;
  children?: ReactNode;
}) {
  const { item, open } = props;
  const { task } = item;
  const { row, dragging, handle } = useSortableRow(task.id, task.name);
  const dragged = dragging ? ' dragging' : '';
  if (item.leftOut) {
    return (
      <li {...row} className={`plan-task left-out${dragged}`}>
        {handle}
        <div className="row">
          <div className="row-main">
            <div className="row-title">{task.name}</div>
            <div className="row-meta">left out today</div>
          </div>
          <button
            type="button"
            className="btn btn-small"
            onClick={props.onPutBack}
            aria-label={`Put back ${task.name}`}
          >
            Put back
          </button>
        </div>
      </li>
    );
  }
  // Switching it on brings these along.
  const needs = task.optional
    ? task.after.flatMap((id) => props.tasks.find((t) => t.id === id && t.optional)?.name ?? [])
    : [];
  return (
    <li {...row} className={`plan-task${open ? ' open' : ''}${dragged}`}>
      {handle}
      <div className="row">
        <button
          type="button"
          className="row-main row-button"
          onClick={props.onOpen}
          aria-expanded={open}
          aria-label={`Edit ${task.name}`}
        >
          <span className="row-title">
            {task.name}
            {task.optional && <span className="chip">optional</span>}
            {item.added && <span className="chip">added</span>}
            {item.changed && <span className="chip">changed</span>}
          </span>
          <span className="row-meta">
            {taskLength(task)}
            {needs.length > 0 && ` · needs ${listNames(needs)}`}
            <Icon name="edit" size={14} />
          </span>
        </button>
        {task.optional && (
          <label className="row-switch">
            <input
              type="checkbox"
              role="switch"
              checked={props.on}
              aria-label={task.name}
              onChange={(e) => props.onSwitch(e.target.checked)}
            />
            <span className="switch" aria-hidden="true" />
          </label>
        )}
      </div>
      {props.children}
    </li>
  );
}

/** Changes one of the day's tasks: for today only, or the task itself for every run. */
function PlanTaskEditor(props: {
  item: DayTask;
  flow: Flow;
  plan: Plan;
  edit: (change: Partial<Plan>) => void;
  onLeaveOut: () => void;
  onRemove: () => void;
  onDone: (status: string) => void;
}) {
  const { item, flow, plan, edit } = props;
  const { task } = item;
  const data = useData();
  const def = data.tasks.find((t) => t.id === task.id); // a one-off isn't in your task list
  const [name, setName] = useState(task.name);
  const [minutes, setMinutes] = useState(minutesText(task.handsOnSec));
  // Only the flow's own tasks run every time; one added for today changes for today.
  const [scope, setScope] = useState<'today' | 'flow'>('today');
  const value = parseMinutes(minutes);
  const ok = name.trim() !== '' && value !== undefined;
  const elsewhere = flowsUsing(data.flows, task.id).flatMap((f) => (f.id === flow.id ? [] : [f.name]));

  const save = () => {
    if (!ok) return;
    const fixed = { name: name.trim(), handsOnSec: Math.round(value * 60) };
    if (scope === 'today' && fixed.name === task.name && fixed.handsOnSec === task.handsOnSec) {
      props.onDone('');
      return;
    }
    if (!def) {
      edit({
        extras: plan.extras.map((e) =>
          'oneOff' in e && e.oneOff.id === task.id ? { oneOff: { ...e.oneOff, ...fixed } } : e,
        ),
      });
    } else if (scope === 'flow') {
      saveTaskDef({ ...def, ...fixed });
      // The task itself has it now, so today needs no change of its own.
      if (item.changed)
        edit({ changes: withChange(plan.changes, task.id, { name: undefined, handsOnSec: undefined }) });
    } else {
      edit({
        changes: withChange(plan.changes, task.id, {
          name: fixed.name === def.name ? undefined : fixed.name,
          handsOnSec: fixed.handsOnSec === def.handsOnSec ? undefined : fixed.handsOnSec,
        }),
      });
    }
    props.onDone(`${fixed.name} changed ${scope === 'flow' ? 'for every run' : 'for today'}.`);
  };

  return (
    <form
      className="plan-task-edit stack-tight"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="field-pair">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field-minutes">
          <span>Minutes</span>
          <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      {!item.added && (
        <Segmented
          value={scope}
          options={[
            ['today', 'One-off'],
            ['flow', 'Every run'],
          ]}
          onChange={setScope}
        />
      )}
      {scope === 'flow' && elsewhere.length > 0 && <p className="hint">Also changes it in {listNames(elsewhere)}.</p>}
      <div className="action-row">
        <button type="submit" className="btn" disabled={!ok}>
          Save
        </button>
        {item.added ? (
          <button type="button" className="btn btn-quiet" onClick={props.onRemove}>
            Remove
          </button>
        ) : (
          !task.optional && (
            <button type="button" className="btn btn-quiet" onClick={props.onLeaveOut}>
              Leave out today
            </button>
          )
        )}
      </div>
    </form>
  );
}

/** What you'll do, in order, with times: the same schedule the run will follow. */
function ComingUp({ slots, finish, list }: { slots: Slot[]; finish: number; list: DayTask[] }) {
  const day = new Map(list.map((d) => [d.task.id, d]));
  const leftOut = list.flatMap((d) => (d.leftOut ? [d.task.name] : []));
  return (
    <section>
      <h2 className="section-title">Coming up</h2>
      <ol className="card list plan-list">
        {slots.map((s) => (
          <li key={s.task.id} className="plan-row">
            <span className="plan-time">{clock(s.start)}</span>
            <span className="plan-name">
              {s.task.name}
              {s.task.optional && <span className="chip">optional</span>}
              {day.get(s.task.id)?.added && <span className="chip">added</span>}
              {day.get(s.task.id)?.changed && <span className="chip">changed</span>}
            </span>
            <span className="plan-length">{taskLength(s.task)}</span>
          </li>
        ))}
        <li className="plan-row plan-finish">
          <span className="plan-time">{clock(ceilMinute(finish))}</span>
          <span className="plan-name">{wording.finish}</span>
        </li>
      </ol>
      {leftOut.length > 0 && <p className="hint plan-left-out">Left out today: {listNames(leftOut)}</p>}
    </section>
  );
}

/** Other flows you've planned for today, still to come and not done yet. Tap one to switch to it. */
function AlsoToday({ flow, today, now }: { flow: Flow; today: string; now: number }) {
  const data = useData();
  const doneToday = new Set(finishedRuns(data).flatMap((r) => (r.date === today ? [r.flowId] : [])));
  const items = data.flows
    .filter((f) => f.id !== flow.id && !doneToday.has(f.id))
    .flatMap((f) => {
      const plan = planFor(data, today, f.id);
      if (!plan?.time) return [];
      const list = dayTasks(data.tasks, f, plan);
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
                  start {clock(start)} · finish {clock(ceilMinute(finish))}
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
  const laterIds = later.map((s) => s.task.id);
  // Drag what's up next into a new order; the task you're on stays first.
  const reorder = (from: number, to: number) =>
    reorderRun([...(p.current ? [p.current.task.id] : []), ...arrayMove(laterIds, from, to)]);
  const stale = now - run.startedAt > 12 * 3_600_000;
  const w = wording;

  const finish = () => {
    const left = p.upcoming.length;
    if (left > 0 && !confirm(`${left} task${left > 1 ? 's' : ''} not done. ${w.finish} anyway?`)) return;
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
        <NowCard
          p={p}
          now={now}
          doneAt={allDoneAt(state)}
          canUndo={lastUndoable(run) !== undefined}
          onEdit={setEditing}
        />
      </div>
      <div style={{ height: header.spacerHeight }} aria-hidden="true" />

      <div className="stack">
        {stale && <StaleRun run={run} />}

        {suggestion && run.finishBy !== undefined && <DropCard suggestion={suggestion} finishBy={run.finishBy} />}

        <div className="action-row">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} /> One-off task
          </button>
          {/* Once everything's done, the Finish above is the one to tap. */}
          {!p.allDone && (
            <button type="button" className="btn btn-door" onClick={finish}>
              {w.finish}
            </button>
          )}
        </div>

        {later.length > 0 && (
          <section>
            <h2 className="section-title">Up next</h2>
            <SortableList ids={laterIds} onMove={reorder}>
              {later.map((s) => (
                <UpcomingRow key={s.task.id} slot={s} onEdit={() => setEditing(s.task)} />
              ))}
            </SortableList>
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
  const w = wording;
  const outAt = ceilMinute(outTheDoor);
  const countdown = timer(Math.ceil((outTheDoor - now) / 1000) * 1000);
  const change = drift(outTheDoor, planned);
  const label = mode === 'countdown' ? w.finishIn : w.finishAt;
  return (
    <section className={`hero hero-${mode}${overMs > 0 ? ' hero-over' : ''}`}>
      <button
        type="button"
        className="hero-main"
        onClick={props.onCycle}
        aria-label={`${w.finishAt} ${clock(outAt)}, in ${countdown}. Tap to switch the display.`}
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
  /** When the last task was done, once everything is: finishing up runs from then until Finish. */
  doneAt?: number;
  canUndo: boolean;
  onEdit: (task: Task) => void;
}) {
  const { p, now, canUndo } = props;
  const w = wording;
  const current = p.current;
  const next = p.upcoming[0];
  return (
    <section className="card now">
      <div className="now-top">
        <div className="now-text">
          <div className="now-label">{current ? 'Now' : p.allDone ? 'All done' : 'Nothing ready yet'}</div>
          <div className="now-name">{current ? current.task.name : p.allDone ? 'Finishing up' : next?.task.name}</div>
          {current && <AdjustPlanned task={current.task} />}
          {p.allDone && <div className="now-detail">until you tap {w.finish}</div>}
          {!current && next && <div className="now-detail">can start at {clock(next.start)}</div>}
        </div>
        {current && <TaskTimer key={current.task.id} slot={current} now={now} />}
        {p.allDone && props.doneAt !== undefined && <FinishingUpTimer since={props.doneAt} now={now} />}
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
          {w.finish}
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

/** Time spent finishing up so far. It has no planned time, so it just counts up. */
function FinishingUpTimer({ since, now }: { since: number; now: number }) {
  const text = timer(Math.max(0, Math.floor((now - since) / 1000) * 1000));
  return (
    <div className="task-timer" role="timer" aria-label={`${text} finishing up`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="16" />
      </svg>
      <span className="task-timer-text">
        {text}
        <small>so far</small>
      </span>
    </div>
  );
}

function UpcomingRow({ slot, onEdit }: { slot: Slot; onEdit: () => void }) {
  const { row, dragging, handle } = useSortableRow(slot.task.id, slot.task.name);
  return (
    <li {...row} className={`row upcoming-row${dragging ? ' dragging' : ''}`}>
      {handle}
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

function DropCard(props: { suggestion: DropSuggestion; finishBy: number }) {
  const { suggestion } = props;
  const w = wording;
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
            Dropping <strong>{names}</strong> gets you closest: {w.finishAt.toLowerCase()}{' '}
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
