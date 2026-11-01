import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startWatchBridge } from './platform/watch';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Only does anything in the Android app, where the watch plugin is.
startWatchBridge();
