import { AlignmentViewer, createAlignmentViewer } from '../lib';
import type { LoadedItem } from '../lib';

export type BridgeCommand =
  | { action: 'loadStructure'; pdbId: string }
  | { action: 'loadEmdbMap'; emdbId: string; isoValue?: number }
  | { action: 'load_structure'; url: string; format: 'pdb' | 'mmcif' }
  | { action: 'load_volume'; url: string }
  | { action: 'setVisibility'; itemId: string; visible: boolean }
  | { action: 'setColor'; itemId: string; color: number }
  | { action: 'setIsoValue'; itemId: string; isoValue: number }
  | { action: 'deleteItem'; itemId: string }
  | { action: 'clear' }
  | { action: 'getItems' };

export type BridgeEvent =
  | { type: 'ready' }
  | { type: 'itemsChanged'; items: LoadedItem[] }
  | { type: 'structureLoaded'; item: LoadedItem }
  | { type: 'mapLoaded'; item: LoadedItem }
  | { type: 'error'; action: string; message: string };

function emit(event: BridgeEvent): void {
  window.parent.postMessage(event, '*');
}

export async function initBridge(container: HTMLElement): Promise<AlignmentViewer> {
  const viewer = await createAlignmentViewer(container);

  viewer.onChange(() => {
    emit({ type: 'itemsChanged', items: viewer.getLoadedItems() });
  });

  window.addEventListener('message', async (e) => {
    const cmd = e.data as BridgeCommand;
    if (!cmd || !cmd.action) return;

    try {
      switch (cmd.action) {
        case 'loadStructure': {
          const item = await viewer.loadStructure(cmd.pdbId);
          emit({ type: 'structureLoaded', item });
          break;
        }
        case 'loadEmdbMap': {
          const item = await viewer.loadEmdbMap(cmd.emdbId, { isoValue: cmd.isoValue });
          emit({ type: 'mapLoaded', item });
          break;
        }
        case 'load_structure': {
          const item = await viewer.loadStructureFromUrl(cmd.url, cmd.format);
          emit({ type: 'structureLoaded', item });
          break;
        }
        case 'load_volume': {
          const item = await viewer.loadVolumeFromUrl(cmd.url);
          emit({ type: 'mapLoaded', item });
          break;
        }
        case 'setVisibility': {
          await viewer.setItemVisibility(cmd.itemId, cmd.visible);
          break;
        }
        case 'setColor': {
          await viewer.setItemColor(cmd.itemId, cmd.color);
          break;
        }
        case 'setIsoValue': {
          await viewer.setMapIsoValue(cmd.itemId, cmd.isoValue);
          break;
        }
        case 'deleteItem': {
          await viewer.deleteItem(cmd.itemId);
          break;
        }
        case 'clear': {
          await viewer.clear();
          break;
        }
        case 'getItems': {
          emit({ type: 'itemsChanged', items: viewer.getLoadedItems() });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', action: cmd.action, message });
    }
  });

  emit({ type: 'ready' });

  return viewer;
}