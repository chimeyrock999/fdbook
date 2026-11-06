import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ServerDisconnected } from './session/ServerDisconnected';
import { SessionGate } from './session/SessionGate';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
    <ServerDisconnected />
  </StrictMode>,
);
