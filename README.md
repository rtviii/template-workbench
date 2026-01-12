# Molstar Alignment Viewer - Integration Guide

## Overview

A custom Molstar-based viewer for loading, aligning, and visualizing molecular structures and density maps. The viewer is packaged as an embeddable iframe bundle with a postMessage-based bridge for communication with host applications (e.g., NiceGUI).

## Project Structure

```
src/
├── lib/                          # Core library (reusable logic)
│   ├── types.ts                  # LoadedStructure, LoadedMap, VolumeStats interfaces
│   ├── utils.ts                  # COLOR_PALETTE, fetchEmdbIds, getStructureSources
│   ├── core/
│   │   ├── AlignmentViewer.ts    # Main viewer class
│   │   ├── representations.ts    # Structure/volume representation helpers
│   │   └── postprocessing.ts     # Stylized lighting config
│   └── index.ts                  # Library exports
├── embed/
│   ├── bridge.ts                 # postMessage command/event handling
│   └── index.ts                  # Iframe entry point (mounts viewer + bridge)
└── main.ts                       # Dev UI entry point

dev/
├── index.html                    # Dev test page with controls
└── embed.html                    # Bare iframe test page
```

## Build Outputs

```bash
npm run build        # → dist/embed.js (iframe bundle)
npm run build:lib    # → dist/lib/molstar-lib.js (library only, no bridge)
```

For NiceGUI integration, you need `dist/embed.js`.

## Bridge Protocol

The embed bundle listens for commands via `window.postMessage` and emits events back to the parent.

### Commands (Parent → Iframe)

```typescript
// Load a PDB structure (auto-fetches from RCSB, aligns to reference)
{ action: 'loadStructure', pdbId: '3J7Z' }

// Load an EMDB density map
{ action: 'loadEmdbMap', emdbId: '6057', isoValue?: 1.5 }

// Set visibility
{ action: 'setVisibility', itemId: '3J7Z', visible: false }

// Set color (hex number, not string)
{ action: 'setColor', itemId: '3J7Z', color: 0xff0000 }

// Set ISO value for maps (sigma units)
{ action: 'setIsoValue', itemId: 'EMD-6057', isoValue: 2.0 }

// Delete item
{ action: 'deleteItem', itemId: '3J7Z' }

// Clear all
{ action: 'clear' }

// Request current items list
{ action: 'getItems' }
```

### Events (Iframe → Parent)

```typescript
// Viewer initialized and ready
{ type: 'ready' }

// Items list changed (after any load/delete/visibility/color change)
{ 
  type: 'itemsChanged', 
  items: [
    { type: 'structure', id: '3J7Z', visible: true, color: 0x5c6bc0, isReference: true, ... },
    { type: 'map', id: 'EMD-6057', visible: true, color: 0x26c6da, isoValue: 1.5, stats: {...}, ... }
  ]
}

// Structure loaded successfully
{ type: 'structureLoaded', item: {...} }

// Map loaded successfully  
{ type: 'mapLoaded', item: {...} }

// Error occurred
{ type: 'error', action: 'loadStructure', message: 'Failed to fetch...' }
```

## NiceGUI Integration

### 1. Serve the embed bundle

You need to serve the built `dist/embed.js` and a minimal HTML wrapper. Add a FastAPI route:

```python
from fastapi.responses import HTMLResponse

MOLSTAR_EMBED_HTML = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #app { width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/static/molstar/embed.js"></script>
</body>
</html>
"""

@app.get("/molstar-embed")
def molstar_embed():
    return HTMLResponse(MOLSTAR_EMBED_HTML)
```

Copy `dist/embed.js` to your static files directory (e.g., `static/molstar/embed.js`).

### 2. Create the iframe in NiceGUI

```python
from nicegui import ui
import json

class MolstarViewer:
    def __init__(self):
        self.items = []
        self.ready = False
        
        # Create iframe
        self.iframe = ui.element('iframe').props(
            'src="/molstar-embed" id="molstar-viewer"'
        ).classes('w-full h-full border-none')
        
        # Set up message listener
        ui.run_javascript('''
            window.addEventListener('message', (e) => {
                if (e.data && e.data.type) {
                    // Forward to Python via NiceGUI's call mechanism
                    window.molstarEvent(JSON.stringify(e.data));
                }
            });
        ''')
        
        # Register Python callback
        ui.on('molstarEvent', self._handle_event)
    
    def _handle_event(self, event_json: str):
        event = json.loads(event_json)
        
        if event['type'] == 'ready':
            self.ready = True
        elif event['type'] == 'itemsChanged':
            self.items = event['items']
            self._update_ui()
        elif event['type'] == 'error':
            ui.notify(f"Error: {event['message']}", type='negative')
    
    def _send_command(self, command: dict):
        cmd_json = json.dumps(command)
        ui.run_javascript(f'''
            document.getElementById('molstar-viewer')
                .contentWindow.postMessage({cmd_json}, '*');
        ''')
    
    def load_structure(self, pdb_id: str):
        self._send_command({'action': 'loadStructure', 'pdbId': pdb_id})
    
    def load_map(self, emdb_id: str, iso_value: float = 1.5):
        self._send_command({
            'action': 'loadEmdbMap', 
            'emdbId': emdb_id, 
            'isoValue': iso_value
        })
    
    def set_visibility(self, item_id: str, visible: bool):
        self._send_command({
            'action': 'setVisibility',
            'itemId': item_id,
            'visible': visible
        })
    
    def set_color(self, item_id: str, color: int):
        self._send_command({
            'action': 'setColor',
            'itemId': item_id,
            'color': color
        })
    
    def set_iso_value(self, item_id: str, iso_value: float):
        self._send_command({
            'action': 'setIsoValue',
            'itemId': item_id,
            'isoValue': iso_value
        })
    
    def delete_item(self, item_id: str):
        self._send_command({'action': 'deleteItem', 'itemId': item_id})
    
    def clear(self):
        self._send_command({'action': 'clear'})
```

### 3. Use in your UI

```python
def create_workbench():
    with ui.row().classes('w-full h-screen'):
        # Controls panel
        with ui.column().classes('w-80 p-4 bg-gray-100'):
            pdb_input = ui.input('PDB ID', value='3J7Z')
            ui.button('Load Structure', on_click=lambda: viewer.load_structure(pdb_input.value))
            
            emdb_input = ui.input('EMDB ID')
            iso_input = ui.number('ISO (σ)', value=1.5)
            ui.button('Load Map', on_click=lambda: viewer.load_map(emdb_input.value, iso_input.value))
            
            ui.button('Clear All', on_click=viewer.clear)
        
        # Viewer panel
        with ui.column().classes('flex-1 h-full'):
            viewer = MolstarViewer()
```

## Key Behaviors

**Structure alignment**: The first loaded structure becomes the reference. Subsequent structures are automatically superposed onto the reference using Molstar's `superpose` function.

**Color assignment**: Colors are assigned sequentially from `COLOR_PALETTE`. You can override with `setColor`.

**Map statistics**: When a map is loaded, grid statistics (min, max, mean, sigma) are captured. ISO values are in sigma units; the `stats` object in `LoadedMap` allows conversion to absolute values if needed.

**Stylized rendering**: Structures render with cartoon representation, ambient occlusion, and outlines (defined in `postprocessing.ts`).

## Data Types Reference

```typescript
interface LoadedStructure {
  type: 'structure';
  id: string;              // e.g., '3J7Z'
  ref: string;             // internal Molstar state ref
  representationRefs: string[];
  visible: boolean;
  color: number;           // e.g., 0x5c6bc0
  format: string;          // 'bcif' | 'mmcif' | 'pdb'
  isReference: boolean;    // true for first structure
}

interface LoadedMap {
  type: 'map';
  id: string;              // e.g., 'EMD-6057'
  volumeRef: string;
  representationRef: string;
  visible: boolean;
  color: number;
  emdbId: string;          // e.g., '6057'
  isoValue: number;        // sigma units
  stats: {
    min: number;
    max: number;
    mean: number;
    sigma: number;
  };
}
```

## Extending the Bridge

To add new commands, edit `src/embed/bridge.ts`:

```typescript
// Add to BridgeCommand type
| { action: 'myNewCommand', someParam: string }

// Add to switch statement in message handler
case 'myNewCommand': {
  // call viewer method
  await viewer.someMethod(cmd.someParam);
  // optionally emit event
  emit({ type: 'myNewCommandDone', result: ... });
  break;
}
```

Rebuild with `npm run build` after changes.