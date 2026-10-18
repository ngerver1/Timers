import { useEffect, useRef, useState } from 'react';
import { dateKey } from '../../engine/time';
import { replaceAll, setDefaultBuffer } from '../../store/actions';
import { fromBackup, isBadData, toBackup } from '../../store/schema';
import { useData } from '../../store/store';
import { Stepper } from '../components';
import type { AppUpdate } from '../update';

export function SettingsScreen({ update }: { update: AppUpdate }) {
  const data = useData();
  const [persisted, setPersisted] = useState<boolean>();
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => undefined);
  }, []);

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([toBackup(data)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `out-the-door-${dateKey(Date.now())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage('Backup saved to your Downloads folder.');
  };

  const importBackup = async (file: File) => {
    try {
      const next = fromBackup(await file.text());
      const mornings = next.runs.filter((r) => r.finishedAt !== undefined).length;
      const tasks = next.routines.reduce((n, r) => n + r.tasks.length, 0);
      if (!confirm(`Replace everything in the app with this backup (${tasks} tasks, ${mornings} mornings)?`)) return;
      replaceAll(next);
      setMessage('Backup imported.');
    } catch (e) {
      setMessage(isBadData(e) ? e.message : "Couldn't read that file.");
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="card pad">
        <Stepper
          label="Default buffer before you start"
          value={data.settings.bufferMin}
          unit="min"
          step={5}
          max={120}
          onChange={setDefaultBuffer}
        />
        <p className="hint">Used by Plan to work out when to get up.</p>
      </section>

      <section className="card pad stack-tight">
        <h2 className="section-title">Backup</h2>
        <p className="muted">
          Everything lives on this phone only. Export now and then (it saves a file to Downloads), and import it to
          restore or move to another device.
        </p>
        <div className="action-row">
          <button type="button" className="btn" onClick={exportBackup}>
            Export backup
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            Import backup
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importBackup(file);
          }}
        />
        {message && <p className="note-text">{message}</p>}
        <p className="hint">
          {persisted === true
            ? 'Chrome has agreed not to clear this data to free up space.'
            : persisted === false
              ? 'Chrome may clear this data if the phone runs low on space; installing the app usually stops that.'
              : ''}
        </p>
      </section>

      <section className="card pad stack-tight">
        <h2 className="section-title">App</h2>
        <p className="muted">Version {__APP_VERSION__}. Works offline once installed.</p>
        {update.ready && (
          <button type="button" className="btn btn-primary" onClick={update.apply}>
            Update to the new version
          </button>
        )}
      </section>
    </div>
  );
}
