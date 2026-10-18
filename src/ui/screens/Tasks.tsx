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
import type { Id, Task } from '../../engine/types';
import {
  activeRoutine,
  activeRun,
  deleteTask,
  finishedRuns,
  moveTask,
  saveTask,
  setHandsOn,
} from '../../store/actions';
import { features } from '../../features';
import { newId } from '../../store/schema';
import { useData } from '../../store/store';
import { Icon, Sheet, Toggle } from '../components';
import { duration, listNames, minutesText, parseMinutes, taskLength } from '../format';

export function TasksScreen() {
  const data = useData();
  const routine = activeRoutine(data);
  const usual = useMemo(() => usualTimes(finishedRuns(data)), [data]);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = routine.tasks.map((t) => t.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) moveTask(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Tasks</h1>
      </header>
      <p className="muted">
        The order is your priority: whenever you're free, the first task that's ready comes next. Drag the handle to
        reorder; tap a task to edit it.
      </p>
      {activeRun(data) && <p className="card pad note">Changes apply from your next start.</p>}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {routine.tasks.length === 0 && <p className="muted">No tasks yet. Add your first one below.</p>}
          <ul className="card list">
            {routine.tasks.map((t) => (
              <TaskRow key={t.id} task={t} tasks={routine.tasks} usual={usual.get(t.id)} onEdit={() => setEditing(t)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <button type="button" className="btn" onClick={() => setEditing('new')}>
        <Icon name="plus" size={20} /> Add task
      </button>

      {editing && (
        <TaskEditor
          task={editing === 'new' ? undefined : editing}
          tasks={routine.tasks}
          usual={editing === 'new' ? undefined : usual.get(editing.id)}
          onClose={() => setEditing(null)}
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
      <button type="button" className="task-main" onClick={props.onEdit}>
        <span className="row-title">
          {task.name}
          {task.optional && <span className="chip">optional</span>}
        </span>
        <span className="row-meta">
          {taskLength(task)}
          {after.length > 0 && ` · after ${listNames(after)}`}
        </span>
      </button>
      {usual && <UsualTime task={task} usual={usual} />}
    </li>
  );
}

/** "Usually 3½ min (8 mornings) · Use", when the median differs from the standard time. */
export function UsualTime({ task, usual }: { task: Task; usual: Usual }) {
  const tidy = tidySeconds(usual.medianSec);
  if (tidy === task.handsOnSec) return null;
  return (
    <div className="usual">
      <span>
        Usually {duration(tidy)}{' '}
        <span className="muted">
          ({usual.samples} {usual.samples === 1 ? 'morning' : 'mornings'})
        </span>
      </span>
      <button type="button" className="btn btn-small" onClick={() => setHandsOn(task.id, tidy)}>
        Use
      </button>
    </div>
  );
}

function TaskEditor(props: { task?: Task; tasks: Task[]; usual?: Usual; onClose: () => void }) {
  const { task, tasks, usual, onClose } = props;
  const [name, setName] = useState(task?.name ?? '');
  const [handsOn, setHandsOnText] = useState(minutesText(task?.handsOnSec ?? 300));
  const [wait, setWait] = useState(minutesText(task?.waitSec ?? 0));
  const [optional, setOptional] = useState(task?.optional ?? false);
  const [after, setAfter] = useState<Set<Id>>(() => new Set(task?.after ?? []));
  const others = tasks.filter((t) => t.id !== task?.id);
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
    saveTask({
      id: task?.id ?? newId(),
      name: name.trim(),
      handsOnSec: Math.round(handsOnMin * 60),
      waitSec: features.waits ? Math.round(waitMin * 60) : (task?.waitSec ?? 0),
      after: others.filter((t) => after.has(t.id)).map((t) => t.id),
      optional,
    });
    onClose();
  };

  const remove = () => {
    if (!task) return;
    const used = tasks.some((t) => t.after.includes(task.id));
    const warning = used ? ' Tasks that come after it will drop that rule.' : '';
    if (confirm(`Delete "${task.name}"?${warning}`)) {
      deleteTask(task.id);
      onClose();
    }
  };

  return (
    <Sheet title={task ? 'Edit task' : 'New task'} onClose={onClose}>
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
        {usual && (
          <div className="usual">
            <span>
              Usually {duration(tidySeconds(usual.medianSec))}{' '}
              <span className="muted">
                (last {usual.samples} {usual.samples === 1 ? 'morning' : 'mornings'})
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
            label="Optional"
            hint="You switch it on for the mornings you need it"
            checked={optional}
            onChange={setOptional}
          />
        </div>

        <div>
          <h3 className="section-title">Can't start until these are finished</h3>
          {others.length === 0 ? (
            <p className="muted">No other tasks yet.</p>
          ) : (
            <div className="card list">
              {others.map((t) => {
                const loop = task !== undefined && createsCycle(tasks, task.id, t.id);
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

        <div className="sheet-actions">
          {task && (
            <button type="button" className="btn danger-text" onClick={remove}>
              Delete
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!ok}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
