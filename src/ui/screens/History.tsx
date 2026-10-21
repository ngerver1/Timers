import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  biggestOverrun,
  minuteScale,
  runTimes,
  summarise,
  trend,
  wayOff,
  type Overrun,
  type RunTime,
  type Summary,
  type Trend,
} from '../../engine/insights';
import { LEARN_FROM, tidySeconds, usualTimes, type Usual } from '../../engine/learning';
import { MINUTE } from '../../engine/time';
import type { Flow, Id, Run, TaskDef } from '../../engine/types';
import { deleteRuns, finishedRuns, setHandsOn } from '../../store/actions';
import { flowsUsing } from '../../store/flows';
import { useData } from '../../store/store';
import { Icon, Sheet } from '../components';
import { clock, count, dayLabel, duration, earlyLate, listNames, minutes, shortDay, wording } from '../format';
import { UsualTime } from './Setup';
import { RunTimeline } from './RunTimeline';

/** Flows to look back on: today's, then any deleted ones that still have runs. */
function historyFlows(flows: readonly Flow[], runs: readonly Run[]): Flow[] {
  const gone = new Map<Id, Flow>();
  for (const r of runs) {
    if (!flows.some((f) => f.id === r.flowId) && !gone.has(r.flowId)) {
      gone.set(r.flowId, { id: r.flowId, name: r.flowName, ending: r.ending, items: [] });
    }
  }
  return [...flows, ...gone.values()];
}

/** The flow in "#/history/<flow>", when you're looking at one flow's history. */
function flowFromHash(): Id | undefined {
  const m = /^#\/history\/(.+)$/.exec(location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/**
 * History is split by flow: an overview with a card per flow, and a page for
 * each flow built only from that flow's runs. Back goes from a flow to the overview.
 */
export function HistoryScreen() {
  const data = useData();
  const finished = useMemo(() => finishedRuns(data), [data]);
  const choices = useMemo(() => historyFlows(data.flows, finished), [data.flows, finished]);
  const [viewing, setViewing] = useState(flowFromHash);
  useEffect(() => {
    const onPop = () => setViewing(flowFromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const only = choices.length === 1 ? choices[0] : undefined;
  const flow = choices.find((f) => f.id === viewing) ?? only;
  const runs = useMemo(() => finished.filter((r) => r.flowId === flow?.id), [finished, flow?.id]);

  const open = (id: Id) => {
    history.pushState({ historyFlow: id }, '', `#/history/${encodeURIComponent(id)}`);
    setViewing(id);
    window.scrollTo(0, 0);
  };
  const back = () => {
    if ((history.state as { historyFlow?: Id } | null)?.historyFlow) {
      history.back(); // the popstate listener shows the overview
    } else {
      history.replaceState(null, '', '#/history'); // opened straight from the address
      setViewing(undefined);
    }
  };

  if (flow) return <FlowHistory key={flow.id} flow={flow} runs={runs} onBack={only ? undefined : back} />;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>History</h1>
      </header>
      <div className="stack-tight">
        {choices.map((f) => (
          <FlowCard
            key={f.id}
            flow={f}
            runs={finished.filter((r) => r.flowId === f.id)}
            deleted={!data.flows.some((x) => x.id === f.id)}
            onOpen={() => open(f.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** A flow at a glance on the overview: how it usually goes, the last run, and recent run times. */
function FlowCard(props: { flow: Flow; runs: Run[]; deleted: boolean; onOpen: () => void }) {
  const { flow } = props;
  const times = useMemo(() => runTimes(props.runs), [props.runs]);
  const summary = summarise(times);
  const last = times[0];
  if (!summary || !last) {
    return (
      <div className="card pad flow-summary empty">
        <span className="row-title">{flow.name}</span>
        <span className="row-meta">No runs yet</span>
      </div>
    );
  }
  const vsPlan = Math.round(summary.vsPlanMs / MINUTE);
  const out = last.run.finishedAt!;
  return (
    <button type="button" className="card pad flow-summary" onClick={props.onOpen}>
      <span className="flow-summary-top">
        <span className="row-title">
          {flow.name}
          {props.deleted && <span className="chip">deleted</span>}
        </span>
        <span className="row-meta flow-summary-count">
          {count(times.length, 'run')} <Icon name="next" size={18} />
        </span>
      </span>
      <span>
        Typically {minutes(summary.typicalMs)}
        {vsPlan !== 0 && ` · ${duration(Math.abs(vsPlan) * 60)} ${vsPlan > 0 ? 'over' : 'under'} plan`}
      </span>
      <span className="row-meta">
        Last {dayLabel(last.run.date)}: {wording.finishedAt} {clock(out)}
        {last.run.finishBy !== undefined && `, ${earlyLate(last.run.finishBy, out)}`}
      </span>
      <Sparkline times={times} />
    </button>
  );
}

/** The newest runs' total times as tiny columns, latest on the right in the accent. */
function Sparkline({ times }: { times: RunTime[] }) {
  const shown = times.slice(0, CHART_RUNS).reverse();
  const max = Math.max(...shown.map((t) => t.tookMs));
  return (
    <span className="spark" aria-hidden="true">
      {shown.map((t, i) => (
        <i
          key={t.run.id}
          className={i === shown.length - 1 ? 'on' : undefined}
          style={{ height: `${Math.max(8, (t.tookMs / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** One flow's history, from its own runs only. */
function FlowHistory(props: { flow: Flow; runs: Run[]; onBack?: () => void }) {
  const { flow, runs } = props;
  const data = useData();
  const times = useMemo(() => runTimes(runs), [runs]);
  const usual = useMemo(() => usualTimes(runs), [runs]);
  const summary = summarise(times);
  const flowTasks = useMemo(() => {
    // A deleted flow's tasks are the ones its runs used, if they're still in your list.
    const ids = new Set(
      flow.items.length ? flow.items.map((i) => i.taskId) : times.flatMap((t) => t.run.tasks.map((x) => x.id)),
    );
    return data.tasks.filter((t) => ids.has(t.id));
  }, [data.tasks, flow, times]);
  const overrun = biggestOverrun(flowTasks, usual);
  const sharedWith = overrun
    ? flowsUsing(data.flows, overrun.task.id)
        .filter((f) => f.id !== flow.id)
        .map((f) => f.name)
    : [];

  return (
    <div className="stack">
      <header className="page-head history-head">
        {props.onBack && (
          <button type="button" className="btn btn-quiet back-link" onClick={props.onBack}>
            <Icon name="back" size={20} /> All flows
          </button>
        )}
        <h1>{flow.name}</h1>
      </header>

      {summary ? (
        <>
          <StatTiles summary={summary} />
          <RunChart times={times} />
          <Insights
            trend={trend(times)}
            overrun={overrun}
            sharedWith={sharedWith}
            odd={wayOff(times)}
            runs={times.length}
          />
          <PastRuns times={times} />
        </>
      ) : (
        <p className="card pad muted">
          No runs of {flow.name} yet. Each run is saved here when you tap {wording.finish}.
        </p>
      )}

      {flowTasks.length > 0 && times.length > 0 && <TaskTimes flow={flow} tasks={flowTasks} usual={usual} />}
    </div>
  );
}

/** Each task's usual time in this flow, folded away: the insight above points at the one that matters. */
function TaskTimes(props: { flow: Flow; tasks: TaskDef[]; usual: ReadonlyMap<Id, Usual> }) {
  return (
    <details className="card task-times">
      <summary>
        <span className="row-title">Task times</span>
        <span className="row-meta">
          Usual times from the last {LEARN_FROM} runs of {props.flow.name}
        </span>
      </summary>
      <ul className="list">
        {props.tasks.map((t) => {
          const u = props.usual.get(t.id);
          return (
            <li key={t.id} className="row usual-row">
              <div className="row-main">
                <div className="row-title">{t.name}</div>
                <div className="row-meta">
                  Standard {duration(t.handsOnSec)}
                  {!u
                    ? ' · not timed yet'
                    : tidySeconds(u.medianSec) === t.handsOnSec && ` · usually the same (${u.samples})`}
                </div>
                {u && <UsualTime task={t} usual={u} />}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The newest runs at a glance. */
function StatTiles({ summary }: { summary: Summary }) {
  const vsPlan = Math.round(summary.vsPlanMs / MINUTE);
  return (
    <div className="stat-row">
      <div className="card stat">
        <span className="stat-label">Typical run</span>
        <strong className="stat-value">{minutes(summary.typicalMs)}</strong>
        <span className="stat-sub">{summary.count === 1 ? 'from 1 run' : `last ${summary.count} runs`}</span>
      </div>
      <div className="card stat">
        <span className="stat-label">Against plan</span>
        <strong className="stat-value">
          {vsPlan === 0 ? 'On plan' : `${vsPlan > 0 ? '+' : '−'}${duration(Math.abs(vsPlan) * 60)}`}
        </strong>
        <span className="stat-sub">{vsPlan > 0 ? 'usually longer' : vsPlan < 0 ? 'usually shorter' : 'usually'}</span>
      </div>
      {summary.onTime && (
        <div className="card stat">
          <span className="stat-label">On time</span>
          <strong className="stat-value">
            {summary.onTime.made} of {summary.onTime.of}
          </strong>
          <span className="stat-sub">with a {wording.byTime}</span>
        </div>
      )}
    </div>
  );
}

const CHART_RUNS = 14;
const W = 320;
const H = 168;
const PAD = { left: 28, right: 4, top: 8, bottom: 22 };

/** A rounded-top column standing on the baseline. */
function columnPath(x: number, width: number, top: number, base: number): string {
  const r = Math.min(4, width / 2, base - top);
  return `M${x},${base}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + width - r}A${r},${r} 0 0 1 ${x + width},${top + r}V${base}Z`;
}

/**
 * Total time of the newest runs, oldest on the left. Each column carries a tick
 * at what the plan at Start said; tap a column for its details. The Past runs
 * list below has every value too.
 */
function RunChart({ times }: { times: RunTime[] }) {
  const shown = times.slice(0, CHART_RUNS).reverse();
  const [selectedId, setSelectedId] = useState<Id>();
  const [showTimeline, setShowTimeline] = useState(false);
  const selected = shown.find((t) => t.run.id === selectedId) ?? shown[shown.length - 1]!;
  const { top, step } = minuteScale(Math.max(...shown.map((t) => Math.max(t.tookMs, t.plannedMs))));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH;
  const y = (ms: number) => base - (Math.min(ms / MINUTE, top) / top) * plotH;
  // Newest at the right edge; a short history fills in from there.
  const slots = Math.max(shown.length, 7);
  const slot = plotW / slots;
  const width = Math.min(24, slot * 0.62);
  const reach = Math.min(3, (slot - width) / 4);
  const slotX = (i: number) => PAD.left + (slots - shown.length + i) * slot;
  const w = wording;
  const out = selected.run.finishedAt!;
  const choose = (id: Id) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedId(id);
    }
  };

  return (
    <section>
      <h2 className="section-title">Run times</h2>
      <figure className="card pad chart">
        <div className="chart-readout" aria-live="polite">
          <div className="chart-readout-top">
            <span>
              <strong>{minutes(selected.tookMs)}</strong> {dayLabel(selected.run.date)}
            </span>
            <span className="readout-actions">
              <button type="button" className="btn btn-small" onClick={() => setShowTimeline(true)}>
                Timeline
              </button>
              <button
                type="button"
                className="btn btn-small btn-quiet danger-text"
                onClick={() => confirmDelete([selected.run])}
              >
                Delete
              </button>
            </span>
          </div>
          <div className="muted">
            planned {minutes(selected.plannedMs)} · {w.finishedAt} {clock(out)}
            {selected.run.finishBy !== undefined && ` · ${earlyLate(selected.run.finishBy, out)}`}
          </div>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="group"
          aria-label={`Time taken by the last ${shown.length} runs, in minutes`}
        >
          {Array.from({ length: top / step + 1 }, (_, k) => k * step).map((v) => (
            <g key={v}>
              <line
                className={v === 0 ? 'chart-axis' : 'chart-grid'}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v * MINUTE)}
                y2={y(v * MINUTE)}
              />
              <text
                className="chart-tick"
                x={PAD.left - 6}
                y={y(v * MINUTE)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {v}
              </text>
            </g>
          ))}
          {shown.map((t, i) => {
            const x = slotX(i) + (slot - width) / 2;
            const on = t === selected;
            const plan = y(t.plannedMs);
            return (
              <g
                key={t.run.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${dayLabel(t.run.date)}: took ${minutes(t.tookMs)}, planned ${minutes(t.plannedMs)}`}
                className="chart-hit"
                onClick={() => setSelectedId(t.run.id)}
                onKeyDown={choose(t.run.id)}
              >
                <rect className="chart-hit-area" x={slotX(i)} y={0} width={slot} height={H} />
                {y(t.tookMs) < base && (
                  <path className={`chart-col${on ? ' on' : ''}`} d={columnPath(x, width, y(t.tookMs), base)} />
                )}
                <line className="chart-plan-halo" x1={x - reach} x2={x + width + reach} y1={plan} y2={plan} />
                <line className="chart-plan" x1={x - reach} x2={x + width + reach} y1={plan} y2={plan} />
              </g>
            );
          })}
          {shown.map((t, i) =>
            i === shown.length - 1 || (i === 0 && shown.length >= 3) ? (
              <text
                key={t.run.id}
                className="chart-tick"
                x={i === 0 ? slotX(i) + (slot - width) / 2 : slotX(i) + (slot + width) / 2}
                y={H - 6}
                textAnchor={i === 0 ? 'start' : 'end'}
              >
                {shortDay(t.run.date)}
              </text>
            ) : null,
          )}
        </svg>
        <figcaption className="chart-key">
          <span>
            <i className="key-col" aria-hidden="true" /> Took
          </span>
          <span>
            <i className="key-plan" aria-hidden="true" /> Planned at Start
          </span>
          <span className="muted">Minutes · tap a column</span>
        </figcaption>
      </figure>
      {showTimeline && (
        <Sheet
          title={`${dayLabel(selected.run.date)} · ${selected.run.flowName}`}
          onClose={() => setShowTimeline(false)}
        >
          <div className="card pad stack-tight">
            <p className="muted">
              Started {clock(selected.run.startedAt)} · {w.finishedAt} {clock(out)} · took {minutes(selected.tookMs)}
            </p>
            <RunTimeline run={selected.run} />
          </div>
        </Sheet>
      )}
    </section>
  );
}

function Insights(props: { trend?: Trend; overrun?: Overrun; sharedWith: string[]; odd: RunTime[]; runs: number }) {
  const { trend, overrun, runs, odd } = props;
  const example = odd[0];
  const change = trend && Math.round((trend.recentMs - trend.earlierMs) / MINUTE);
  return (
    <section>
      <h2 className="section-title">Insights</h2>
      <ul className="card list insights">
        {example && (
          <li className="row insight">
            <p>
              {odd.length === 1 ? (
                <>
                  <strong>{dayLabel(example.run.date)}</strong> took {minutes(example.tookMs)} against{' '}
                  {minutes(example.plannedMs)} planned.
                </>
              ) : (
                <>
                  <strong>{odd.length} runs</strong> were way off their plan, like {dayLabel(example.run.date)}:{' '}
                  {minutes(example.tookMs)} against {minutes(example.plannedMs)}.
                </>
              )}{' '}
              If {odd.length === 1 ? 'it was a test, delete it' : 'they were tests, delete them'} so{' '}
              {odd.length === 1 ? "it doesn't" : "they don't"} skew your times.
            </p>
            <button
              type="button"
              className="btn btn-small danger-text"
              onClick={() => confirmDelete(odd.map((t) => t.run))}
            >
              {odd.length === 1 ? 'Delete it' : `Delete all ${odd.length}`}
            </button>
          </li>
        )}
        {trend && change !== undefined && (
          <li className="row insight">
            <p>
              <strong>{change < 0 ? 'Getting quicker.' : change > 0 ? 'Taking longer.' : 'Steady.'}</strong> Your last{' '}
              {trend.size} runs typically took {minutes(trend.recentMs)}
              {change === 0
                ? `, the same as the ${trend.size} before.`
                : `, ${duration(Math.abs(change) * 60)} ${change < 0 ? 'less' : 'more'} than the ${trend.size} before.`}
            </p>
          </li>
        )}
        {!trend && (
          <li className="row insight">
            <p className="muted">
              After {6 - runs} more {6 - runs === 1 ? 'run' : 'runs'} you'll see whether this flow is getting quicker.
            </p>
          </li>
        )}
        {overrun ? (
          <li className="row insight">
            <p>
              <strong>{overrun.task.name}</strong> usually takes {duration(overrun.usualSec)},{' '}
              {duration(overrun.overSec)} more than its standard {duration(overrun.task.handsOnSec)}. It's the task that
              runs over most.
            </p>
            {props.sharedWith.length > 0 && (
              <p className="hint">It's also in {listNames(props.sharedWith)}, so this changes it there too.</p>
            )}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setHandsOn(overrun.task.id, overrun.usualSec)}
            >
              Use {duration(overrun.usualSec)}
            </button>
          </li>
        ) : (
          runs >= 3 && (
            <li className="row insight">
              <p className="muted">No task is regularly running more than a minute over its standard time.</p>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

const RUNS_AT_FIRST = 5;

function PastRuns({ times }: { times: RunTime[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? times : times.slice(0, RUNS_AT_FIRST);
  return (
    <section>
      <h2 className="section-title">Past runs</h2>
      <ul className="card list">
        {shown.map((t) => (
          <li key={t.run.id}>
            <RunCard time={t} sameDay={times.filter((x) => x.run.date === t.run.date).map((x) => x.run)} />
          </li>
        ))}
      </ul>
      {shown.length < times.length && (
        <button type="button" className="btn btn-quiet show-more" onClick={() => setAll(true)}>
          Show all {times.length} runs
        </button>
      )}
    </section>
  );
}

/** Asks first: deleting a run takes it out of the chart, the stats, usual times and insights for good. */
function confirmDelete(runs: Run[]) {
  const first = runs[0];
  if (!first) return;
  const what =
    runs.length === 1
      ? `the ${dayLabel(first.date)} run of ${first.flowName}`
      : runs.every((r) => r.date === first.date)
        ? `all ${runs.length} runs of ${first.flowName} on ${dayLabel(first.date)}`
        : `these ${runs.length} runs of ${first.flowName}`;
  if (confirm(`Delete ${what}? It won't count towards your times and insights any more. This can't be undone.`)) {
    deleteRuns(runs.map((r) => r.id));
  }
}

function RunCard({ time, sameDay }: { time: RunTime; sameDay: Run[] }) {
  const { run } = time;
  const out = run.finishedAt ?? run.startedAt;
  const w = wording;
  // The timeline only renders once opened: a long history stays quick.
  const [open, setOpen] = useState(false);
  return (
    <details className="run-card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <div className="run-summary-main">
          <div className="row-title">{dayLabel(run.date)}</div>
          <div>
            {w.finished} at {clock(out)}
          </div>
          <div className="row-meta">
            {run.finishBy !== undefined && `${earlyLate(run.finishBy, out)} · `}started {clock(run.startedAt)}
          </div>
        </div>
        <div className="run-took">
          <strong>{minutes(time.tookMs)}</strong>
          <span className="row-meta">planned {minutes(time.plannedMs)}</span>
        </div>
      </summary>
      {open && (
        <div className="run-detail">
          <div className="run-actions">
            <button type="button" className="btn btn-small btn-quiet danger-text" onClick={() => confirmDelete([run])}>
              Delete this run
            </button>
            {sameDay.length > 1 && (
              <button
                type="button"
                className="btn btn-small btn-quiet danger-text"
                onClick={() => confirmDelete(sameDay)}
              >
                Delete all {sameDay.length} from this day
              </button>
            )}
          </div>
          <RunTimeline run={run} />
        </div>
      )}
    </details>
  );
}
