import { useState } from 'react';
import { finishFrom, latestStart, routineLength } from '../../engine/plan';
import { activeTasks, closeOver } from '../../engine/routine';
import { atTime, ceilMinute, dateKey, MINUTE, nextMorning } from '../../engine/time';
import type { Flow } from '../../engine/types';
import { forSchedule } from '../../features';
import { activeFlow, deletePlan, planFor, savePlan, selectFlow, tasksOf } from '../../store/actions';
import { dayTasks } from '../../store/flows';
import type { Plan } from '../../store/schema';
import { useData } from '../../store/store';
import { BigClock, FlowPicker, OptionalPicker, Segmented, Stepper, TimeField } from '../components';
import { clock, dayLabel, duration, listNames, wording } from '../format';

/** A morning is planned the night before; anything else, the same day. */
const defaultDay = (flow: Flow) => (flow.ending === 'leave' ? nextMorning(Date.now()) : dateKey(Date.now()));

export function PlanScreen() {
  const data = useData();
  const flow = activeFlow(data);
  // Keyed by flow so switching flows starts from that flow's usual day.
  return <FlowPlan key={flow.id} flow={flow} />;
}

function FlowPlan({ flow }: { flow: Flow }) {
  const data = useData();
  const w = wording;
  const wakes = flow.ending === 'leave';
  const [date, setDate] = useState(() => defaultDay(flow));
  const saved = planFor(data, date, flow.id);
  const plan: Plan = saved ?? {
    date,
    flowId: flow.id,
    optionalOn: [],
    extras: [],
    mode: flow.usual?.mode ?? 'doneBy',
    time: flow.usual?.time,
    bufferMin: data.settings.bufferMin,
  };
  // The flow's own tasks, then any added for that day on the Today screen.
  const flowList = dayTasks(data.tasks, flow, plan);
  const extraNames = flowList.slice(tasksOf(data, flow).length).map((t) => t.name);
  const on = closeOver(flowList, plan.optionalOn);
  const tasks = forSchedule(activeTasks(flowList, on));
  const length = routineLength(tasks);
  // Like Maps: fix the finish and work back to the start, or fix the start and work forward.
  const fixed = plan.time ? atTime(date, plan.time) : undefined;
  const start = fixed === undefined ? undefined : plan.mode === 'doneBy' ? latestStart(tasks, fixed) : fixed;
  const finish = fixed === undefined ? undefined : plan.mode === 'doneBy' ? fixed : finishFrom(tasks, fixed);
  const getUp = start === undefined ? undefined : start - (wakes ? plan.bufferMin : 0) * MINUTE;
  // Every change saves, so the Today screen on that day picks it up.
  const save = (change: Partial<Plan>) => savePlan({ ...plan, optionalOn: [...on], ...change, date, flowId: flow.id });

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Plan</h1>
      </header>
      {data.flows.length > 1 && <FlowPicker flows={data.flows} value={flow.id} onChange={selectFlow} />}

      <section className="card pad">
        <label className="field">
          <span>Day</span>
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
        <OptionalPicker tasks={flowList} on={on} onChange={(next) => save({ optionalOn: [...next] })} />
        {extraNames.length > 0 && <p className="hint">Also added for this day: {listNames(extraNames)}.</p>}
      </section>

      <section className="card pad stack-tight">
        <Segmented
          value={plan.mode}
          options={[
            ['doneBy', w.by],
            ['startAt', 'Start at'],
          ]}
          onChange={(mode) => save({ mode })}
        />
        <TimeField
          label={plan.mode === 'doneBy' ? w.by : 'Start at'}
          value={plan.time ?? ''}
          onChange={(v) => save({ time: v || undefined })}
        />
        {wakes && (
          <Stepper
            label="Buffer before you start"
            value={plan.bufferMin}
            unit="min"
            step={5}
            max={120}
            onChange={(bufferMin) => save({ bufferMin })}
          />
        )}
      </section>

      <section className="card hero">
        {start !== undefined && finish !== undefined && getUp !== undefined ? (
          <>
            <div className="hero-label">{plan.mode === 'startAt' ? w.finishAt : wakes ? 'Get up at' : 'Start by'}</div>
            <BigClock ms={plan.mode === 'startAt' ? ceilMinute(finish) : getUp} className="hero-clock" />
            <div className="hero-sub muted">
              {[
                wakes && plan.mode === 'startAt' && `get up ${clock(getUp)}`,
                wakes && `start ${clock(start)}`,
                plan.mode === 'doneBy' && `${w.by.toLowerCase()} ${clock(finish)}`,
                `${duration(length / 1000)} of tasks${wakes ? ` + ${plan.bufferMin} min buffer` : ''}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </>
        ) : (
          <p className="muted">
            Tasks take {duration(length / 1000)}. Set a time to see when to {wakes ? 'get up' : 'start'}.
          </p>
        )}
      </section>

      {saved ? (
        <div className="stack-tight">
          <p className="muted">
            Saved. Start will use this for {flow.name} on {dayLabel(date)}.
          </p>
          <button type="button" className="btn" onClick={() => deletePlan(date, flow.id)}>
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
