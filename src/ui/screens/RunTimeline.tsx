import { useState, type CSSProperties, type ReactNode } from 'react';
import { clockTicks, timeline, type TimelineRow } from '../../engine/timeline';
import type { Id, Run } from '../../engine/types';
import { correctTaskTime } from '../../store/actions';
import { clock, clockParts, duration, minutesText, parseMinutes, wording } from '../format';

/** Places a label at `p`% along the axis, kept inside the chart near either edge. */
const place = (p: number): CSSProperties => ({
  left: `${p}%`,
  transform: `translateX(${p < 12 ? 0 : p > 88 ? -100 : -50}%)`,
});

/** To the half minute, as the labels show it. */
const halfMinutes = (ms: number) => Math.round(ms / 30_000) * 30;

/**
 * What a finished run actually looked like, Gantt style: a row per task on one
 * clock axis, the bar from when you started it to when you finished, amber for
 * any time beyond its plan, and a tick where it was planned to end. Tap a task
 * to correct how long it took.
 */
export function RunTimeline({ run }: { run: Run }) {
  const t = timeline(run);
  const [open, setOpen] = useState<Id | null>(null);
  const pct = (ms: number) => ((ms - t.from) / (t.to - t.from)) * 100;
  const ticks = clockTicks(t.from, t.to);
  const row = (r: TimelineRow) => (
    <Row
      key={r.task.id}
      row={r}
      pct={pct}
      open={open === r.task.id}
      onOpen={() => setOpen(open === r.task.id ? null : r.task.id)}
    >
      {open === r.task.id && <TookEditor run={run} row={r} onDone={() => setOpen(null)} />}
    </Row>
  );
  // Tasks tapped Done together sit next to each other; they're shown as one group.
  const groups: TimelineRow[][] = [];
  for (const r of t.rows.filter((r) => r.status === 'done')) {
    const last = groups.at(-1);
    if (r.batch !== undefined && last?.[0]?.batch === r.batch) last.push(r);
    else groups.push([r]);
  }
  return (
    <div className="gantt">
      <div className="gantt-axis" aria-hidden="true">
        {ticks.map((ms) => (
          <span key={ms} style={place(pct(ms))}>
            {clockParts(ms).time}
          </span>
        ))}
      </div>
      <div className="gantt-body">
        {ticks.map((ms) => (
          <i key={ms} className="gantt-line" style={{ left: `${pct(ms)}%` }} aria-hidden="true" />
        ))}
        {t.finishBy !== undefined && (
          <i className="gantt-line gantt-deadline" style={{ left: `${pct(t.finishBy)}%` }} aria-hidden="true" />
        )}
        <ol className="gantt-rows" aria-label="What you did, in order">
          {groups.map((g) =>
            g.length === 1 ? (
              row(g[0]!)
            ) : (
              <li key={g[0]!.task.id} className="gantt-group">
                <ol className="gantt-rows" aria-label="Done together">
                  {g.map(row)}
                </ol>
                <p className="gantt-group-note">
                  Done together · {duration(halfMinutes(g.reduce((sum, r) => sum + r.end! - r.start!, 0)))}, split by
                  plan
                </p>
              </li>
            ),
          )}
          {t.finishingUp && <FinishingUpRow span={t.finishingUp} pct={pct} />}
          {t.rows.filter((r) => r.status !== 'done').map(row)}
        </ol>
      </div>
      {t.finishBy !== undefined && (
        <div className="gantt-axis gantt-foot" aria-hidden="true">
          <span style={place(pct(t.finishBy))}>
            {wording.by.toLowerCase()} {clockParts(t.finishBy).time}
          </span>
        </div>
      )}
      <div className="chart-key">
        <span aria-hidden="true">
          <i className="key-bar" /> Took
        </span>
        <span aria-hidden="true">
          <i className="key-over" /> Over plan
        </span>
        <span aria-hidden="true">
          <i className="key-plan-end" /> Planned end
        </span>
        <span className="muted">Tap a task to correct its time</span>
      </div>
    </div>
  );
}

function Row(props: {
  row: TimelineRow;
  pct: (ms: number) => number;
  open: boolean;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const { row, pct } = props;
  const { task, start, end, plannedMs } = row;
  const name = (
    <span className="gantt-name">
      {task.name}
      {row.oneOff && <span className="chip">one-off</span>}
    </span>
  );
  if (start === undefined || end === undefined) {
    return (
      <li className="gantt-row gantt-off">
        <div className="gantt-label">
          {name}
          <span className="gantt-took">{row.status === 'skipped' ? 'skipped' : 'not done'}</span>
        </div>
      </li>
    );
  }
  const took = halfMinutes(end - start);
  const plannedEnd = start + plannedMs;
  // Under 30 s over doesn't show as over, matching the half-minute rounding of the label.
  const over = end - plannedEnd >= 30_000;
  return (
    <li className={`gantt-row${props.open ? ' open' : ''}`}>
      <button
        type="button"
        className="gantt-hit"
        onClick={props.onOpen}
        aria-expanded={props.open}
        aria-label={`${task.name}: ${clock(start)} to ${clock(end)}, took ${duration(took)}${
          row.tappedMs !== undefined ? ' (edited)' : ''
        }, planned ${duration(plannedMs / 1000)}. Correct its time`}
      >
        <span className="gantt-label">
          {name}
          <span className="gantt-took">
            {duration(took)}
            {row.tappedMs !== undefined && ' (edited)'} · plan {duration(plannedMs / 1000)}
          </span>
        </span>
        <span className="gantt-track" aria-hidden="true">
          <span
            className={`gantt-bar${over ? ' cut' : ''}`}
            style={{ left: `${pct(start)}%`, width: `${pct(over ? plannedEnd : end) - pct(start)}%` }}
          />
          {over && (
            <span
              className="gantt-over"
              style={{ left: `${pct(plannedEnd)}%`, width: `${pct(end) - pct(plannedEnd)}%` }}
            />
          )}
          <i className="gantt-plan" style={{ left: `${pct(plannedEnd)}%` }} />
        </span>
      </button>
      {props.children}
    </li>
  );
}

/** From the last task to Finish: time that wasn't any task's. */
function FinishingUpRow({ span, pct }: { span: { start: number; end: number }; pct: (ms: number) => number }) {
  const took = halfMinutes(span.end - span.start);
  return (
    <li
      className="gantt-row gantt-misc"
      aria-label={`Finishing up: ${clock(span.start)} to ${clock(span.end)}, ${duration(took)}`}
    >
      <div className="gantt-label">
        <span className="gantt-name">Finishing up</span>
        <span className="gantt-took">{duration(took)}</span>
      </div>
      <div className="gantt-track" aria-hidden="true">
        <span
          className="gantt-bar"
          style={{ left: `${pct(span.start)}%`, width: `${pct(span.end) - pct(span.start)}%` }}
        />
      </div>
    </li>
  );
}

/** How long a task really took, for its usual time and History's insights. Other tasks stay as tapped. */
function TookEditor({ run, row, onDone }: { run: Run; row: TimelineRow; onDone: () => void }) {
  const initial = minutesText(halfMinutes(row.end! - row.start!));
  const [minutes, setMinutes] = useState(initial);
  const value = parseMinutes(minutes);
  const save = () => {
    if (value === undefined) return;
    if (minutes !== initial) correctTaskTime(run.id, row.task.id, Math.round(value * 60));
    onDone();
  };
  return (
    <form
      className="gantt-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="field">
        <span>Took (minutes)</span>
        <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={value === undefined}>
        Save
      </button>
      {row.tappedMs !== undefined && (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            correctTaskTime(run.id, row.task.id);
            onDone();
          }}
        >
          Reset to {duration(halfMinutes(row.tappedMs))}
        </button>
      )}
    </form>
  );
}
