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
  // console.log("[BRIDGE] Starting initialization...");
  
  const viewer = await createAlignmentViewer(container);
  // console.log("[BRIDGE] Viewer created, container:", container);

  viewer.onChange(() => {
    const items = viewer.getLoadedItems();
    // console.log("[BRIDGE] Items Changed, emitting to parent:", items);
    emit({ type: 'itemsChanged', items });
  });

  window.addEventListener('message', async (e) => {
    const cmd = e.data;
    
    // CRITICAL: Filter out non-command messages
    if (typeof cmd !== 'object' || cmd === null || !('action' in cmd)) {
      // console.log("[BRIDGE] Ignoring non-command message:", cmd);
      return;
    }
    
    // console.log("[BRIDGE] Processing command:", cmd.action, cmd);

    try {
      switch (cmd.action) {
        case 'loadStructure': {
          // console.log("[BRIDGE] Loading structure:", cmd.pdbId);
          const item = await viewer.loadStructure(cmd.pdbId);
          emit({ type: 'structureLoaded', item });
          break;
        }
        case 'loadEmdbMap': {
          // console.log("[BRIDGE] Loading EMDB map:", cmd.emdbId);
          const item = await viewer.loadEmdbMap(cmd.emdbId, { isoValue: cmd.isoValue });
          emit({ type: 'mapLoaded', item });
          break;
        }
        case 'load_structure': {
          // console.log("[BRIDGE] Loading structure from URL:", cmd.url);
          const item = await viewer.loadStructureFromUrl(cmd.url, cmd.format);
          emit({ type: 'structureLoaded', item });
          break;
        }
        case 'load_volume': {
          // console.log("[BRIDGE] Loading volume from URL:", cmd.url);
          const item = await viewer.loadLocalVolume(cmd.url);
          emit({ type: 'mapLoaded', item });
          break;
        }
        case 'setVisibility': {
          // console.log("[BRIDGE] Setting visibility for:", cmd.itemId, "to", cmd.visible);
          await viewer.setItemVisibility(cmd.itemId, cmd.visible);
          break;
        }
        case 'setColor': {
          // console.log("[BRIDGE] Setting color for:", cmd.itemId, "to", cmd.color);
          await viewer.setItemColor(cmd.itemId, cmd.color);
          break;
        }
        case 'setIsoValue': {
          // console.log("[BRIDGE] Setting ISO for:", cmd.itemId, "to", cmd.isoValue);
          await viewer.setMapIsoValue(cmd.itemId, cmd.isoValue);
          break;
        }
        case 'deleteItem': {
          // console.log("[BRIDGE] Deleting item:", cmd.itemId);
          await viewer.deleteItem(cmd.itemId);
          break;
        }
        case 'clear': {
          // console.log("[BRIDGE] Clearing all items");
          await viewer.clear();
          break;
        }
        case 'getItems': {
          // console.log("[BRIDGE] Getting items");
          const items = viewer.getLoadedItems();
          // console.log("[BRIDGE] Current items:", items);
          emit({ type: 'itemsChanged', items });
          break;
        }
        default: {
          console.warn("[BRIDGE] Unknown command:", cmd.action);
          emit({ type: 'error', action: cmd.action, message: `Unknown command: ${cmd.action}` });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[BRIDGE] Command Error:", message, err);
      emit({ type: 'error', action: cmd.action, message });
    }
  });

  // console.log("[BRIDGE] Viewer initialized, sending ready event");
  emit({ type: 'ready' });
  
  return viewer;
}