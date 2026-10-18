import { useMemo } from 'react';
import { actualSeconds, LEARN_FROM, tidySeconds, usualTimes } from '../../engine/learning';
import { foldRun, plannedFinish } from '../../engine/run';
import { ceilMinute } from '../../engine/time';
import type { Run } from '../../engine/types';
import { activeRoutine, deleteRun, finishedRuns } from '../../store/actions';
import { useData } from '../../store/store';
import { clock, dayLabel, duration, earlyLate } from '../format';
import { UsualTime } from './Tasks';

export function HistoryScreen() {
  const data = useData();
  const routine = activeRoutine(data);
  const runs = useMemo(() => finishedRuns(data), [data]);
  const usual = useMemo(() => usualTimes(runs), [runs]);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>History</h1>
      </header>

      <section>
        <h2 className="section-title">Usual times</h2>
        <p className="muted">Median hands-on time over the last {LEARN_FROM} mornings that included each task.</p>
        <ul className="card list">
          {routine.tasks.map((t) => {
            const u = usual.get(t.id);
            return (
              <li key={t.id} className="row usual-row">
                <div className="row-main">
                  <div className="row-title">{t.name}</div>
                  <div className="row-meta">
                    Standard {duration(t.handsOnSec)}
                    {!u
                      ? ' · no mornings yet'
                      : tidySeconds(u.medianSec) === t.handsOnSec && ` · usually the same (${u.samples})`}
                  </div>
                  {u && <UsualTime task={t} usual={u} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="section-title">Past mornings</h2>
        {runs.length === 0 ? (
          <p className="muted">Nothing yet. Each morning is saved here when you tap Out the door.</p>
        ) : (
          <div className="stack-tight">
            {runs.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RunCard({ run }: { run: Run }) {
  const out = run.finishedAt ?? run.startedAt;
  const state = foldRun(run);
  const actual = actualSeconds(run);
  const notDone = run.tasks.filter((t) => !state.done.has(t.id) && !state.skipped.has(t.id));
  const oneOffs = new Set(state.tasks.filter((t) => !run.tasks.some((x) => x.id === t.id)).map((t) => t.id));
  return (
    <details className="card run-card">
      <summary>
        <div className="row-title">{dayLabel(run.date)}</div>
        <div>
          Out at {clock(out)}
          {run.leaveBy !== undefined && ` · ${earlyLate(run.leaveBy, out)}`}
        </div>
        <div className="row-meta">
          Started {clock(run.startedAt)} · took {duration(Math.round((out - run.startedAt) / 60_000) * 60)} · planned
          out by {clock(ceilMinute(plannedFinish(run)))}
        </div>
      </summary>
      <ul className="list">
        {[...state.done.values()].map((d) => (
          <li key={d.task.id} className="row">
            <div className="row-main">
              <div className="row-title">
                {d.task.name}
                {oneOffs.has(d.task.id) && <span className="chip">one-off</span>}
              </div>
              <div className="row-meta">
                {duration(actual.get(d.task.id) ?? 0)} · standard {duration(d.task.handsOnSec)}
              </div>
            </div>
          </li>
        ))}
        {[...state.skipped].map((id) => (
          <li key={id} className="row">
            <div className="row-main">
              <div className="row-title muted">{state.tasks.find((t) => t.id === id)?.name}</div>
              <div className="row-meta">skipped</div>
            </div>
          </li>
        ))}
        {notDone.map((t) => (
          <li key={t.id} className="row">
            <div className="row-main">
              <div className="row-title muted">{t.name}</div>
              <div className="row-meta">not done</div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-quiet danger-text"
        onClick={() => confirm('Delete this morning from History?') && deleteRun(run.id)}
      >
        Delete this morning
      </button>
    </details>
  );
}
