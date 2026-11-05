import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { keepAppFresh } from './lib/updates';

keepAppFresh();

document.documentElement.style.setProperty('--brand-foot', '"Compass · SToMS v' + __APP_VERSION__ + '"');
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
