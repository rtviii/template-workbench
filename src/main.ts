import { createAlignmentViewer, fetchEmdbIds, COLOR_PALETTE, colorToHex } from './lib';
import type { AlignmentViewer } from './lib';

let viewer: AlignmentViewer | null = null;

async function init() {
  const container = document.getElementById('viewer-container');
  if (!container) return;

  viewer = await createAlignmentViewer(container);
  viewer.onChange(renderItems);

  document.getElementById('load-structure-btn')?.addEventListener('click', loadStructure);
  document.getElementById('load-map-btn')?.addEventListener('click', loadMap);
  document.getElementById('clear-btn')?.addEventListener('click', () => viewer?.clear());

  log('Viewer ready');
}

async function loadStructure() {
  const input = document.getElementById('pdb-input') as HTMLInputElement;
  const pdbId = input.value.trim();
  if (!pdbId || !viewer) return;

  try {
    log(`Loading ${pdbId}...`);
    const item = await viewer.loadStructure(pdbId);
    log(`Loaded ${item.id} (${item.format}, ref=${item.isReference})`);

    const emdbIds = await fetchEmdbIds(pdbId);
    if (emdbIds.length > 0) {
      const emdbInput = document.getElementById('emdb-input') as HTMLInputElement;
      emdbInput.value = emdbIds[0].replace('EMD-', '');
      log(`Suggested EMDB: ${emdbIds.join(', ')}`);
    }
  } catch (e) {
    log(`Error: ${(e as Error).message}`);
  }
}

async function loadMap() {
  const input = document.getElementById('emdb-input') as HTMLInputElement;
  const isoInput = document.getElementById('iso-input') as HTMLInputElement;
  const emdbId = input.value.trim();
  if (!emdbId || !viewer) return;

  try {
    log(`Loading EMD-${emdbId}...`);
    await viewer.loadEmdbMap(emdbId, { isoValue: parseFloat(isoInput.value) || 1.5 });
    log(`Map loaded`);
  } catch (e) {
    log(`Error: ${(e as Error).message}`);
  }
}

function renderItems() {
  const container = document.getElementById('loaded-items');
  if (!container || !viewer) return;

  const items = viewer.getLoadedItems();
  container.innerHTML = items
    .map(
      (item) => `
    <div class="item" data-id="${item.id}">
      <button class="vis-btn">${item.visible ? 'Hide' : 'Show'}</button>
      <input type="color" class="color-input" value="${colorToHex(item.color)}">
      <span class="item-label">${item.id}${item.type === 'structure' && item.isReference ? ' [REF]' : ''}</span>
      <button class="del-btn">X</button>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('.item').forEach((el) => {
    const id = (el as HTMLElement).dataset.id!;

    el.querySelector('.vis-btn')?.addEventListener('click', async () => {
      const item = viewer!.getLoadedItems().find((i) => i.id === id);
      if (item) await viewer!.setItemVisibility(id, !item.visible);
    });

    el.querySelector('.color-input')?.addEventListener('input', async (e) => {
      const hex = (e.target as HTMLInputElement).value;
      const color = parseInt(hex.slice(1), 16);
      await viewer!.setItemColor(id, color);
    });

    el.querySelector('.del-btn')?.addEventListener('click', () => viewer!.deleteItem(id));
  });
}

function log(msg: string) {
  const el = document.getElementById('log');
  if (el) {
    el.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }
}

init();