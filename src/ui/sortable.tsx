// Lists you reorder by dragging a row's handle (or with the keyboard on the handle).
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import type { Id } from '../engine/types';
import { Icon } from './components';

/** A card list of rows made with useSortableRow, in the order of `ids`. */
export function SortableList(props: { ids: Id[]; onMove: (from: number, to: number) => void; children: ReactNode }) {
  const { ids, onMove } = props;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="card list">{props.children}</ul>
      </SortableContext>
    </DndContext>
  );
}

/** One row of a SortableList: props for its <li>, whether it's being dragged, and its handle. */
export function useSortableRow(id: Id, name: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return {
    row: { ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition } },
    dragging: isDragging,
    handle: (
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="handle"
        aria-label={`Move ${name}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" />
      </button>
    ),
  };
}
