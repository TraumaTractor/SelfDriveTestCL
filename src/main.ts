import { startApp } from './ui/app';

const root = document.getElementById('app')!;
try {
  startApp(root);
} catch (e) {
  // Never leave a blank window: if saved data from an older version breaks start-up, drop it and start fresh.
  console.error('start-up failed, resetting saved data', e);
  try {
    localStorage.removeItem('selfdrive-testbench-v1');
    localStorage.removeItem('selfdrive-settings');
  } catch { /* storage unavailable */ }
  root.replaceChildren();
  startApp(root);
}
