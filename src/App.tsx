import { useEffect, useState } from 'react';
import { activeRun } from './store/actions';
import { requestPersistence, useData } from './store/store';
import { Icon, StorageBanners, type IconName } from './ui/components';
import { HistoryScreen } from './ui/screens/History';
import { PlanScreen } from './ui/screens/Plan';
import { SettingsScreen } from './ui/screens/Settings';
import { FlowsScreen } from './ui/screens/Flows';
import { TodayScreen } from './ui/screens/Today';
import { useAppUpdate } from './ui/update';

type Tab = 'today' | 'plan' | 'flows' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'flows', label: 'Flows', icon: 'tasks' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** The tab is the first part of the hash: "#/history", or "#/history/<flow>" for one flow's history. */
function tabFromHash(): Tab {
  const id = (location.hash.replace(/^#\/?/, '').split('/')[0] ?? '').replace(/^tasks$/, 'flows'); // was Tasks
  return TABS.find((t) => t.id === id)?.id ?? 'today';
}

export function App() {
  const data = useData();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  // Tapping a tab starts it afresh (History goes back to all flows), even if it's the one you're on.
  const [visit, setVisit] = useState(0);
  const update = useAppUpdate();
  const running = activeRun(data) !== undefined;

  useEffect(() => {
    void requestPersistence();
    // Back from one flow's history (or from another tab opened there) lands on the tab in the address.
    const onPop = () => setTab(tabFromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    setVisit((v) => v + 1);
    history.replaceState(null, '', `#/${next}`);
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
        {tab === 'flows' && <FlowsScreen />}
        {tab === 'history' && <HistoryScreen key={visit} />}
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
