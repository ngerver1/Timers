import type { CSSProperties } from 'react';
import { clockTicks, timeline, type TimelineRow } from '../../engine/timeline';
import type { Run } from '../../engine/types';
import { clock, clockParts, duration, words } from '../format';

/** Places a label at `p`% along the axis, kept inside the chart near either edge. */
const place = (p: number): CSSProperties => ({
  left: `${p}%`,
  transform: `translateX(${p < 12 ? 0 : p > 88 ? -100 : -50}%)`,
});

/**
 * What a finished run actually looked like, Gantt style: a row per task on one
 * clock axis, the bar from when you started it to when you finished, amber for
 * any time beyond its plan, and a tick where it was planned to end.
 */
export function RunTimeline({ run }: { run: Run }) {
  const t = timeline(run);
  const pct = (ms: number) => ((ms - t.from) / (t.to - t.from)) * 100;
  const ticks = clockTicks(t.from, t.to);
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
          {t.rows.map((r) => (
            <Row key={r.task.id} row={r} pct={pct} />
          ))}
        </ol>
      </div>
      {t.finishBy !== undefined && (
        <div className="gantt-axis gantt-foot" aria-hidden="true">
          <span style={place(pct(t.finishBy))}>
            {words(run.ending).by.toLowerCase()} {clockParts(t.finishBy).time}
          </span>
        </div>
      )}
      <div className="chart-key" aria-hidden="true">
        <span>
          <i className="key-bar" /> Took
        </span>
        <span>
          <i className="key-over" /> Over plan
        </span>
        <span>
          <i className="key-plan-end" /> Planned end
        </span>
      </div>
    </div>
  );
}

function Row({ row, pct }: { row: TimelineRow; pct: (ms: number) => number }) {
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
  const took = Math.round((end - start) / 30_000) * 30;
  const plannedEnd = start + plannedMs;
  // Under 30 s over doesn't show as over, matching the half-minute rounding of the label.
  const over = end - plannedEnd >= 30_000;
  return (
    <li
      className="gantt-row"
      aria-label={`${task.name}: ${clock(start)} to ${clock(end)}, took ${duration(took)}, planned ${duration(plannedMs / 1000)}`}
    >
      <div className="gantt-label">
        {name}
        <span className="gantt-took">
          {duration(took)} · plan {duration(plannedMs / 1000)}
        </span>
      </div>
      <div className="gantt-track" aria-hidden="true">
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
      </div>
    </li>
  );
}
