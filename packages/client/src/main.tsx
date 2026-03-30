import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import './pwa-install';

createRoot(document.getElementById('root')!).render(<App />);
