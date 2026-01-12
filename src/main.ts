import { createAlignmentViewer, fetchEmdbIds, colorToHex, relativeToAbsolute, COLOR_PALETTE } from './lib';
import type { AlignmentViewer, LoadedMap } from './lib';

// Trailing-edge throttle (fires after delay when user stops)
function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return ((...args: any[]) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), ms);
    }) as T;
}
let viewer: AlignmentViewer | null = null;
let openPaletteId: string | null = null;

async function init() {
    const container = document.getElementById('viewer-container');
    if (!container) return;

    viewer = await createAlignmentViewer(container);
    viewer.onChange(renderItems);

    document.getElementById('load-structure-btn')?.addEventListener('click', loadStructure);
    document.getElementById('load-map-btn')?.addEventListener('click', loadMap);
    document.getElementById('clear-btn')?.addEventListener('click', () => viewer?.clear());

    // Close palette on outside click
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.color-swatch-btn') && !target.closest('.color-palette')) {
            document.querySelectorAll('.color-palette').forEach((p) => p.classList.remove('open'));
            openPaletteId = null;
        }
    });

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

function renderColorPalette(itemId: string, currentColor: number): string {
    const swatches = COLOR_PALETTE.map(
        (c) => `
    <div class="palette-swatch ${c === currentColor ? 'selected' : ''}" 
         style="background-color: ${colorToHex(c)}" 
         data-color="${c}"></div>
  `
    ).join('');

    return `<div class="color-palette" data-for="${itemId}"><div class="palette-grid">${swatches}</div></div>`;
}

function renderItems() {
    const container = document.getElementById('loaded-items');
    if (!container || !viewer) return;

    const items = viewer.getLoadedItems();
    container.innerHTML = items
        .map((item) => {
            const isMap = item.type === 'map';
            const mapItem = item as LoadedMap;

            let isoControls = '';
            if (isMap) {
                const absValue = relativeToAbsolute(mapItem.isoValue, mapItem.stats);
                isoControls = `
          <div class="iso-controls">
            <input type="range" class="iso-slider" min="-2" max="6" step="0.1" value="${mapItem.isoValue}">
            <span class="iso-value">${mapItem.isoValue.toFixed(2)}σ</span>
            <span class="iso-abs">(${absValue.toFixed(4)})</span>
          </div>
        `;
            }

            return `
        <div class="item" data-id="${item.id}">
          <div class="item-header">
            <button class="vis-btn">${item.visible ? 'Hide' : 'Show'}</button>
            <button class="color-swatch-btn" style="background-color: ${colorToHex(item.color)}"></button>
            ${renderColorPalette(item.id, item.color)}
            <span class="item-label">${item.id}${item.type === 'structure' && item.isReference ? ' [REF]' : ''}</span>
            <button class="del-btn">X</button>
          </div>
          ${isoControls}
        </div>
      `;
        })
        .join('');

    // Attach event listeners
    container.querySelectorAll('.item').forEach((el) => {
        const id = (el as HTMLElement).dataset.id!;

        el.querySelector('.vis-btn')?.addEventListener('click', async () => {
            const item = viewer!.getLoadedItems().find((i) => i.id === id);
            if (item) await viewer!.setItemVisibility(id, !item.visible);
        });

        // Color swatch button toggles palette
        el.querySelector('.color-swatch-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const palette = el.querySelector('.color-palette');
            document.querySelectorAll('.color-palette').forEach((p) => {
                if (p !== palette) p.classList.remove('open');
            });
            palette?.classList.toggle('open');
            openPaletteId = palette?.classList.contains('open') ? id : null;
        });

        // Palette swatches apply color immediately
        el.querySelectorAll('.palette-swatch').forEach((swatch) => {
            swatch.addEventListener('click', async (e) => {
                e.stopPropagation();
                const color = parseInt((swatch as HTMLElement).dataset.color!);
                await viewer!.setItemColor(id, color);
                el.querySelector('.color-palette')?.classList.remove('open');
                openPaletteId = null;
            });
        });

        el.querySelector('.del-btn')?.addEventListener('click', () => viewer!.deleteItem(id));

        // ISO slider for maps - throttled to 100ms trailing
        const isoSlider = el.querySelector('.iso-slider') as HTMLInputElement;
        if (isoSlider) {
            const updateIso = throttle(async (value: number) => {
                await viewer!.setMapIsoValue(id, value);
            }, 400);

            isoSlider.addEventListener('input', (e) => {
                const value = parseFloat((e.target as HTMLInputElement).value);

                // Update display immediately (cheap)
                const item = viewer!.getLoadedItems().find((i) => i.id === id) as LoadedMap;
                if (item) {
                    const isoValueSpan = el.querySelector('.iso-value');
                    const isoAbsSpan = el.querySelector('.iso-abs');
                    if (isoValueSpan) isoValueSpan.textContent = `${value.toFixed(2)}σ`;
                    if (isoAbsSpan) isoAbsSpan.textContent = `(${relativeToAbsolute(value, item.stats).toFixed(4)})`;
                }

                // Throttled 3D update (expensive)
                updateIso(value);
            });
        }
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