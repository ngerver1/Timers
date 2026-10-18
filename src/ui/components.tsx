import { useEffect, useRef, type ReactNode } from 'react';
import { switchOff, switchOn } from '../engine/routine';
import type { Id, Task } from '../engine/types';
import { storageStatus } from '../store/store';
import { clockParts, listNames, slack, taskLength } from './format';

const ICONS = {
  today: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  plan: <path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1Z" />,
  tasks: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  history: <path d="M5.5 19.5v-8M12 19.5v-15M18.5 19.5v-11" />,
  settings: (
    <>
      <path d="M4 7h9M19 7h1M4 17h2M12 17h8" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  grip: <path d="M6 9h12M6 15h12" />,
  check: <path d="m5.5 12.5 4.2 4.2 8.8-9.2" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  undo: <path d="M9 7.5 4.5 12 9 16.5M5 12h9.5a4.5 4.5 0 0 1 0 9H12" />,
  edit: <path d="M4.5 19.5h4l10-10a2.83 2.83 0 0 0-4-4l-10 10v4ZM13.5 6.5l4 4" />,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

export function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{props.label}</span>
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

/** Optional-task switches. Switching one on/off brings along what it needs / what needs it. */
export function OptionalPicker(props: { tasks: Task[]; on: ReadonlySet<Id>; onChange: (on: Set<Id>) => void }) {
  const { tasks, on, onChange } = props;
  const optional = tasks.filter((t) => t.optional);
  if (optional.length === 0) {
    return <p className="muted">No optional tasks. Mark some as optional on the Tasks tab.</p>;
  }
  return (
    <div className="card list">
      {optional.map((t) => {
        const needs = t.after.flatMap((id) => tasks.find((x) => x.id === id && x.optional)?.name ?? []);
        return (
          <Toggle
            key={t.id}
            label={t.name}
            hint={[taskLength(t), needs.length ? `needs ${listNames(needs)}` : ''].filter(Boolean).join(' · ')}
            checked={on.has(t.id)}
            onChange={(c) => onChange(c ? switchOn(tasks, on, t.id) : switchOff(tasks, on, t.id))}
          />
        );
      })}
    </div>
  );
}

export function TimeField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field time-field">
      <label>
        <span>{props.label}</span>
        <input type="time" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </label>
      {props.value && (
        <button type="button" className="btn btn-quiet" onClick={() => props.onChange('')}>
          Clear
        </button>
      )}
    </div>
  );
}

export function Stepper(props: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const { value, step, min = 0, max = Infinity } = props;
  return (
    <div className="field stepper">
      <span>{props.label}</span>
      <div className="stepper-controls">
        <button
          type="button"
          className="btn btn-round"
          aria-label="Less"
          disabled={value <= min}
          onClick={() => props.onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <output>
          {value} {props.unit}
        </output>
        <button
          type="button"
          className="btn btn-round"
          aria-label="More"
          disabled={value >= max}
          onClick={() => props.onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={props.value === value}
          className={props.value === value ? 'on' : ''}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SlackPill({ leaveBy, outAt }: { leaveBy: number; outAt: number }) {
  const { text, tone } = slack(leaveBy, outAt);
  return <span className={`pill pill-${tone}`}>{text}</span>;
}

export function BigClock({ ms, className = '' }: { ms: number; className?: string }) {
  const { time, period } = clockParts(ms);
  return (
    <span className={`big-clock ${className}`}>
      {time}
      {period && <small>{period}</small>}
    </span>
  );
}

/** Warnings about saving on this phone. */
export function StorageBanners() {
  const status = storageStatus();
  return (
    <>
      {status.saveFailed && (
        <div className="banner banner-danger">Couldn't save on this phone. Export a backup from Settings.</div>
      )}
      {status.unreadable && (
        <div className="banner">Saved data couldn't be read, so the app started afresh. A copy was kept.</div>
      )}
    </>
  );
}

/**
 * A bottom sheet. It adds a history entry so the phone's Back gesture closes
 * the sheet instead of leaving the app.
 */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    history.pushState({ sheet: true }, '');
    const onPop = () => onClose.current();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if ((history.state as { sheet?: boolean } | null)?.sheet) history.back();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="sheet-head">
          <h2>{props.title}</h2>
          <button type="button" className="btn btn-quiet" onClick={props.onClose}>
            Close
          </button>
        </header>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
