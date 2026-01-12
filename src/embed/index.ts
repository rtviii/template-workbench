import { initBridge } from './bridge';

const container = document.getElementById('app');
if (container) {
  initBridge(container).catch((err) => {
    console.error('Failed to initialize viewer:', err);
  });
}