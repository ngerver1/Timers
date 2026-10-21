import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';
import { tidySeconds, usualTimes, type Usual } from '../../engine/learning';
import { createsCycle } from '../../engine/routine';
import type { Ending, Flow, Id, Task, TaskDef } from '../../engine/types';
import { features } from '../../features';
import {
  activeFlow,
  activeRun,
  addToFlow,
  createFlow,
  deleteFlow,
  deleteTaskEverywhere,
  finishedRuns,
  moveInFlow,
  removeFromFlow,
  saveTaskInFlow,
  selectFlow,
  setHandsOn,
  tasksOf,
  updateFlow,
} from '../../store/actions';
import { flowsUsing, ruleGraph } from '../../store/flows';
import { newId, type StoreData } from '../../store/schema';
import { useData } from '../../store/store';
import { FlowPicker, Icon, Segmented, Sheet, Toggle } from '../components';
import { duration, listNames, minutesText, parseMinutes, taskLength } from '../format';

const KINDS: [Ending, string][] = [
  ['leave', 'Morning'],
  ['done', 'Any time'],
];

const kindHint = (kind: Ending) =>
  kind === 'leave' ? 'Planned the night before, and Plan shows when to get up.' : 'Planned on the day.';

export function SetupScreen() {
  const data = useData();
  const flow = activeFlow(data);
  const tasks = tasksOf(data, flow);
  // Usual times come from this flow's own runs: a walk on a weekend isn't a weekday walk.
  const usual = useMemo(() => usualTimes(finishedRuns(data).filter((r) => r.flowId === flow.id)), [data, flow.id]);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [sheet, setSheet] = useState<'add' | 'newFlow' | 'settings' | null>(null);
  const running = activeRun(data);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = tasks.map((t) => t.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      moveInFlow(flow.id, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Setup</h1>
      </header>
      <FlowPicker
        flows={data.flows}
        value={flow.id}
        onChange={selectFlow}
        extra={
          <button type="button" className="chip-button chip-new" onClick={() => setSheet('newFlow')}>
            <Icon name="plus" size={16} /> New flow
          </button>
        }
      />

      <section className="card pad flow-card">
        <div>
          <h2 className="flow-name">{flow.name}</h2>
          <div className="row-meta">
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} · {flow.ending === 'leave' ? 'morning' : 'any time'}
          </div>
        </div>
        <button type="button" className="btn btn-small" onClick={() => setSheet('settings')}>
          <Icon name="settings" size={18} /> Settings
        </button>
      </section>

      <p className="muted">
        The order is your priority: whenever you're free, the first task that's ready comes next. Drag the handle to
        reorder; tap a task to change it.
      </p>
      {running?.flowId === flow.id && <p className="card pad note">Changes apply from your next start.</p>}

      {tasks.length === 0 ? (
        <p className="card pad muted">
          No tasks in {flow.name} yet. Add some from your other flows, or make a new one.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="card list">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} tasks={tasks} usual={usual.get(t.id)} onEdit={() => setEditing(t)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="action-row">
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={20} /> New task
        </button>
        <button type="button" className="btn" onClick={() => setSheet('add')}>
          Add from other flows
        </button>
      </div>

      {editing && (
        <TaskEditor
          flow={flow}
          task={editing === 'new' ? undefined : editing}
          data={data}
          usual={editing === 'new' ? undefined : usual.get(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {sheet === 'add' && <AddExistingSheet flow={flow} data={data} onClose={() => setSheet(null)} />}
      {sheet === 'newFlow' && <NewFlowSheet flows={data.flows} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && (
        <FlowSettingsSheet
          flow={flow}
          deleteBlocked={
            data.flows.length <= 1
              ? "It's your only flow."
              : running?.flowId === flow.id
                ? "It's running right now."
                : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function TaskRow(props: { task: Task; tasks: Task[]; usual?: Usual; onEdit: () => void }) {
  const { task, tasks, usual } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const after = task.after.flatMap((id) => tasks.find((t) => t.id === id)?.name ?? []);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`task-row${isDragging ? ' dragging' : ''}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="handle"
        aria-label={`Move ${task.name}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" />
      </button>
      <button type="button" className="task-main" onClick={props.onEdit} aria-label={`Edit ${task.name}`}>
        <span className="task-main-text">
          <span className="row-title">
            {task.name}
            {task.optional && <span className="chip">optional</span>}
          </span>
          <span className="row-meta">
            {taskLength(task)}
            {after.length > 0 && ` · after ${listNames(after)}`}
          </span>
        </span>
        <span className="row-edit">
          <Icon name="edit" size={20} />
        </span>
      </button>
      {usual && <UsualTime task={task} usual={usual} />}
    </li>
  );
}

/** "Usually 3½ min (8 times) · Use", when the median differs from the standard time. */
export function UsualTime({ task, usual }: { task: TaskDef; usual: Usual }) {
  const tidy = tidySeconds(usual.medianSec);
  if (tidy === task.handsOnSec) return null;
  return (
    <div className="usual">
      <span>
        Usually {duration(tidy)}{' '}
        <span className="muted">
          ({usual.samples} {usual.samples === 1 ? 'time' : 'times'})
        </span>
      </span>
      <button type="button" className="btn btn-small" onClick={() => setHandsOn(task.id, tidy)}>
        Use
      </button>
    </div>
  );
}

function TaskEditor(props: { flow: Flow; task?: Task; data: StoreData; usual?: Usual; onClose: () => void }) {
  const { flow, task, data, usual, onClose } = props;
  const inFlow = tasksOf(data, flow);
  const [name, setName] = useState(task?.name ?? '');
  const [handsOn, setHandsOnText] = useState(minutesText(task?.handsOnSec ?? 300));
  const [wait, setWait] = useState(minutesText(task?.waitSec ?? 0));
  const [optional, setOptional] = useState(task?.optional ?? false);
  const [after, setAfter] = useState<Set<Id>>(() => new Set(task?.after ?? []));
  const others = inFlow.filter((t) => t.id !== task?.id);
  const elsewhere = task ? flowsUsing(data.flows, task.id).filter((f) => f.id !== flow.id) : [];
  const graph = ruleGraph(data.tasks);
  const handsOnMin = parseMinutes(handsOn);
  const waitMin = parseMinutes(wait);
  const ok = name.trim() !== '' && handsOnMin !== undefined && waitMin !== undefined;

  const toggleAfter = (id: Id, on: boolean) => {
    const next = new Set(after);
    if (on) next.add(id);
    else next.delete(id);
    setAfter(next);
  };

  const save = () => {
    if (!ok) return;
    // Rules are shared: keep the ones about tasks this flow doesn't use.
    const inThisFlow = new Set(others.map((t) => t.id));
    saveTaskInFlow(
      flow.id,
      {
        id: task?.id ?? newId(),
        name: name.trim(),
        handsOnSec: Math.round(handsOnMin * 60),
        waitSec: features.waits ? Math.round(waitMin * 60) : (task?.waitSec ?? 0),
        after: [
          ...(task?.after.filter((a) => !inThisFlow.has(a)) ?? []),
          ...others.filter((t) => after.has(t.id)).map((t) => t.id),
        ],
      },
      optional,
    );
    onClose();
  };

  const remove = () => {
    if (!task) return;
    removeFromFlow(flow.id, task.id);
    onClose();
  };

  const deleteEverywhere = () => {
    if (!task) return;
    const also = elsewhere.length ? ` It's also in ${listNames(elsewhere.map((f) => f.name))}.` : '';
    if (confirm(`Delete "${task.name}" from your task list?${also}`)) {
      deleteTaskEverywhere(task.id);
      onClose();
    }
  };

  return (
    <Sheet title={task ? 'Edit task' : `New task in ${flow.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!task} />
        </label>
        <div className="field-pair">
          <label className="field">
            <span>Minutes</span>
            <input inputMode="decimal" value={handsOn} onChange={(e) => setHandsOnText(e.target.value)} />
          </label>
          {features.waits && (
            <label className="field">
              <span>Wait after (min)</span>
              <input inputMode="decimal" value={wait} onChange={(e) => setWait(e.target.value)} />
            </label>
          )}
        </div>
        {features.waits && (
          <p className="hint">A wait runs on its own after the hands-on part, like coffee brewing. Use 0 for none.</p>
        )}
        {elsewhere.length > 0 && (
          <p className="hint">Name and minutes are shared with {listNames(elsewhere.map((f) => f.name))}.</p>
        )}
        {usual && (
          <div className="usual">
            <span>
              Usually {duration(tidySeconds(usual.medianSec))}{' '}
              <span className="muted">
                (last {usual.samples} {usual.samples === 1 ? 'time' : 'times'})
              </span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setHandsOnText(minutesText(tidySeconds(usual.medianSec)))}
            >
              Use
            </button>
          </div>
        )}
        <div className="card list">
          <Toggle
            label={`Optional in ${flow.name}`}
            hint="You switch it on for the days you need it"
            checked={optional}
            onChange={setOptional}
          />
        </div>

        <div>
          <h3 className="section-title">Can't start until these are finished</h3>
          {others.length === 0 ? (
            <p className="muted">No other tasks in {flow.name} yet.</p>
          ) : (
            <div className="card list">
              {others.map((t) => {
                const loop = task !== undefined && createsCycle(graph, task.id, t.id);
                const checked = after.has(t.id);
                return (
                  <label key={t.id} className={`check-row${loop && !checked ? ' disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={loop && !checked}
                      onChange={(e) => toggleAfter(t.id, e.target.checked)}
                    />
                    <span>
                      {t.name}
                      {loop && <small> needs this one first</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={!ok}>
          Save
        </button>
        {task && (
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={remove}>
              Remove from {flow.name}
            </button>
            <button type="button" className="btn danger-text" onClick={deleteEverywhere}>
              Delete everywhere
            </button>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/** Tasks from your list that this flow doesn't use yet. Tap to add; stays open for more. */
function AddExistingSheet({ flow, data, onClose }: { flow: Flow; data: StoreData; onClose: () => void }) {
  const inFlow = new Set(flow.items.map((i) => i.taskId));
  const available = data.tasks.filter((t) => !inFlow.has(t.id));
  return (
    <Sheet title={`Add to ${flow.name}`} onClose={onClose}>
      {available.length === 0 ? (
        <p className="muted">Every task you have is already in {flow.name}. Use New task to make another.</p>
      ) : (
        <ul className="card list">
          {available.map((t) => {
            const usedIn = flowsUsing(data.flows, t.id).map((f) => f.name);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="row row-button add-row"
                  onClick={() => addToFlow(flow.id, t.id)}
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
    </Sheet>
  );
}

function NewFlowSheet({ flows, onClose }: { flows: Flow[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [ending, setEnding] = useState<Ending>('leave');
  const [copyFrom, setCopyFrom] = useState<Id | ''>('');
  const create = () => {
    if (!name.trim()) return;
    createFlow(name.trim(), ending, copyFrom || undefined);
    onClose();
  };
  return (
    <Sheet title="New flow" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wake up" autoFocus />
        </label>
        <div className="field">
          <span>Kind</span>
          <Segmented value={ending} options={KINDS} onChange={setEnding} />
          <p className="hint">{kindHint(ending)}</p>
        </div>
        <div>
          <h3 className="section-title">Start with</h3>
          <div className="card list">
            {[
              { id: '' as const, label: 'No tasks' },
              ...flows.map((f) => ({ id: f.id, label: `Same tasks as ${f.name}` })),
            ].map((o) => (
              <label key={o.id || 'none'} className="check-row">
                <input type="radio" name="copy" checked={copyFrom === o.id} onChange={() => setCopyFrom(o.id)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <p className="hint">Tasks are shared, so you can add and remove them afterwards.</p>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Create flow
        </button>
      </form>
    </Sheet>
  );
}

function FlowSettingsSheet(props: { flow: Flow; deleteBlocked?: string; onClose: () => void }) {
  const { flow, deleteBlocked, onClose } = props;
  const [name, setName] = useState(flow.name);
  const [ending, setEnding] = useState<Ending>(flow.ending);
  const save = () => {
    if (!name.trim()) return;
    updateFlow(flow.id, { name: name.trim(), ending });
    onClose();
  };
  const remove = () => {
    if (
      confirm(`Delete the "${flow.name}" flow? Its tasks stay in your task list, and its history stays in History.`)
    ) {
      deleteFlow(flow.id);
      onClose();
    }
  };
  return (
    <Sheet title="Flow settings" onClose={onClose}>
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
        <div className="field">
          <span>Kind</span>
          <Segmented value={ending} options={KINDS} onChange={setEnding} />
          <p className="hint">{kindHint(ending)}</p>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Save
        </button>
        <button type="button" className="btn danger-text" onClick={remove} disabled={deleteBlocked !== undefined}>
          Delete flow
        </button>
        {deleteBlocked && <p className="hint">Can't delete it: {deleteBlocked}</p>}
      </form>
    </Sheet>
  );
}
