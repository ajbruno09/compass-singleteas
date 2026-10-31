import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { keepAppFresh } from './lib/updates';

keepAppFresh();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
