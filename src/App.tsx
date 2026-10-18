import { useEffect, useState } from 'react';
import { activeRun } from './store/actions';
import { requestPersistence, useData } from './store/store';
import { Icon, StorageBanners, type IconName } from './ui/components';
import { HistoryScreen } from './ui/screens/History';
import { PlanScreen } from './ui/screens/Plan';
import { SettingsScreen } from './ui/screens/Settings';
import { TasksScreen } from './ui/screens/Tasks';
import { TodayScreen } from './ui/screens/Today';
import { useAppUpdate } from './ui/update';

type Tab = 'today' | 'plan' | 'tasks' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function tabFromHash(): Tab {
  const id = location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.id === id)?.id ?? 'today';
}

export function App() {
  const data = useData();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const update = useAppUpdate();
  const running = activeRun(data) !== undefined;

  useEffect(() => {
    void requestPersistence();
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    history.replaceState(history.state, '', `#/${next}`);
    window.scrollTo(0, 0);
  };

  return (
    <div className="app">
      <main className="screen">
        {/* The running screen shows these in its pinned header instead. */}
        {!(running && tab === 'today') && <StorageBanners />}
        {update.ready && !running && tab !== 'settings' && (
          <div className="banner">
            <span>A new version is ready.</span>
            <button type="button" className="btn btn-small" onClick={update.apply}>
              Update
            </button>
          </div>
        )}
        {tab === 'today' && <TodayScreen />}
        {tab === 'plan' && <PlanScreen />}
        {tab === 'tasks' && <TasksScreen />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'settings' && <SettingsScreen update={update} />}
      </main>
      <nav className="tabbar" aria-label="Screens">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <span className="tab-icon">
              <Icon name={t.icon} />
              {t.id === 'today' && running && <span className="tab-dot" />}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
