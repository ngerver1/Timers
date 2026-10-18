import { useState } from 'react';
import { getUpTime, routineLength } from '../../engine/plan';
import { activeTasks, closeOver } from '../../engine/routine';
import { atTime, dateKey, nextMorning } from '../../engine/time';
import { activeRoutine, deletePlan, planFor, savePlan } from '../../store/actions';
import type { Plan } from '../../store/schema';
import { useData } from '../../store/store';
import { BigClock, OptionalPicker, Stepper, TimeField } from '../components';
import { clock, dayLabel, duration } from '../format';

export function PlanScreen() {
  const data = useData();
  const routine = activeRoutine(data);
  const [date, setDate] = useState(() => nextMorning(Date.now()));
  const saved = planFor(data, date);
  const plan: Plan = saved ?? {
    date,
    routineId: routine.id,
    optionalOn: [],
    leaveBy: data.lastLeaveBy,
    bufferMin: data.settings.bufferMin,
  };
  const on = closeOver(routine.tasks, plan.optionalOn);
  const length = routineLength(activeTasks(routine.tasks, on));
  const leaveAt = plan.leaveBy ? atTime(date, plan.leaveBy) : undefined;
  const getUp = leaveAt !== undefined ? getUpTime(activeTasks(routine.tasks, on), leaveAt, plan.bufferMin) : undefined;
  // Every change saves, so the Start screen on that morning picks it up.
  const save = (change: Partial<Plan>) =>
    savePlan({ ...plan, optionalOn: [...on], ...change, date, routineId: routine.id });

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Plan a morning</h1>
      </header>

      <section className="card pad">
        <label className="field">
          <span>Morning of</span>
          <input
            type="date"
            value={date}
            min={dateKey(Date.now())}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </section>

      <section>
        <h2 className="section-title">Optional tasks</h2>
        <OptionalPicker tasks={routine.tasks} on={on} onChange={(next) => save({ optionalOn: [...next] })} />
      </section>

      <section className="card pad stack-tight">
        <TimeField label="Leave by" value={plan.leaveBy ?? ''} onChange={(v) => save({ leaveBy: v || undefined })} />
        <Stepper
          label="Buffer before you start"
          value={plan.bufferMin}
          unit="min"
          step={5}
          max={120}
          onChange={(bufferMin) => save({ bufferMin })}
        />
      </section>

      <section className="card hero">
        {getUp !== undefined && leaveAt !== undefined ? (
          <>
            <div className="hero-label">Get up at</div>
            <BigClock ms={getUp} className="hero-clock" />
            <div className="hero-sub muted">
              {duration(length / 1000)} of tasks + {plan.bufferMin} min buffer, out by {clock(leaveAt)}
            </div>
          </>
        ) : (
          <p className="muted">Tasks take {duration(length / 1000)}. Set a leave-by time to see when to get up.</p>
        )}
      </section>

      {saved ? (
        <div className="stack-tight">
          <p className="muted">Saved. Start will use this on {dayLabel(date)}.</p>
          <button type="button" className="btn" onClick={() => deletePlan(date)}>
            Clear plan
          </button>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => save({})}>
          Save plan for {dayLabel(date)}
        </button>
      )}
    </div>
  );
}
