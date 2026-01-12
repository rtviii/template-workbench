import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec';
import { StateObjectSelector, StateSelection } from 'molstar/lib/mol-state';
import { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure';
import { superpose } from 'molstar/lib/mol-model/structure/structure/util/superposition';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra';
import { setSubtreeVisibility } from 'molstar/lib/mol-plugin/behavior/static/state';
import { Color } from 'molstar/lib/mol-util/color';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { Grid } from 'molstar/lib/mol-model/volume';

import type { LoadedStructure, LoadedMap, LoadedItem, LoadMapOptions } from '../types';
import { COLOR_PALETTE, getStructureSources } from '../utils';
import {
    createStructureRepresentation,
    createVolumeRepresentation,
    updateStructureColor,
    updateVolumeColor,
    updateVolumeIsoValue,
    getVolumeStats,
    relativeToAbsolute,
} from './representations';

import { STYLIZED_POSTPROCESSING } from './postprocessing';

export class AlignmentViewer {
    plugin: PluginContext | null = null;

    private referenceStructure: Structure | null = null;
    private referenceStructureId: string | null = null;
    private structureTransforms: Map<string, Mat4> = new Map();
    private loadedItems: Map<string, LoadedItem> = new Map();
    private onChangeCallbacks: Set<() => void> = new Set();
    private colorIndex = 0;

    private referenceVolume: StateObjectSelector<SO.Volume.Data> | null = null;  // CHANGE: store selector
    private referenceVolumeRef: string | null = null;
    private referenceVolumeId: string | null = null;  // ADD THIS
    private referenceType: 'structure' | 'volume' | null = null;  // ADD THIS

    async init(container: HTMLElement): Promise<void> {
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);

        const spec = DefaultPluginSpec();
        this.plugin = new PluginContext(spec);

        await this.plugin.init();
        this.plugin.initViewer(canvas, container);

        const renderer = this.plugin.canvas3d?.props.renderer;
        const postprocessing = this.plugin.canvas3d?.props.postprocessing;

        PluginCommands.Canvas3D.SetSettings(this.plugin, {
            settings: {
                renderer: { ...renderer, backgroundColor: Color(0xffffff) },
                postprocessing: { ...postprocessing, ...STYLIZED_POSTPROCESSING },
            },
        });
    }
    private async centerStructureOnVolume(structureSelector: StateObjectSelector<SO.Molecule.Structure>, volumeObj: SO.Volume.Data): Promise<void> {
        if (!this.plugin) return;

        try {
            const structure = structureSelector.data;
            if (!structure) return;

            // Get volume center
            const gridToCartesian = Grid.getGridToCartesianTransform(volumeObj.grid);
            const gridCenter = Vec3.create(
                (volumeObj.grid.cells.space.dimensions[0] - 1) / 2,
                (volumeObj.grid.cells.space.dimensions[1] - 1) / 2,
                (volumeObj.grid.cells.space.dimensions[2] - 1) / 2
            );
            const volumeCenter = Vec3.transformMat4(Vec3(), gridCenter, gridToCartesian);

            // Get structure center
            const structCenter = structure.boundary.sphere.center;

            // Calculate translation
            const translation = Vec3.sub(Vec3(), volumeCenter, structCenter);
            const translationMatrix = Mat4.identity();
            Mat4.setTranslation(translationMatrix, translation);


            await this.applyStructureTransform(structureSelector, translationMatrix);

        } catch (e) {
            console.warn("[VIEWER] Could not center structure on volume:", e);
        }
    }

    onChange(callback: () => void): () => void {
        this.onChangeCallbacks.add(callback);
        return () => this.onChangeCallbacks.delete(callback);
    }

    private notifyChange(): void {
        this.onChangeCallbacks.forEach((cb) => cb());
    }

    getLoadedItems(): LoadedItem[] {
        return Array.from(this.loadedItems.values());
    }

    getReferenceId(): string | null {
        return this.referenceStructureId;
    }

    private getNextColor(): number {
        const color = COLOR_PALETTE[this.colorIndex % COLOR_PALETTE.length];
        this.colorIndex++;
        return color;
    }



    private async _processStructure(structureSelector: StateObjectSelector<SO.Molecule.Structure>, structureId: string, formatLabel: string): Promise<LoadedStructure> {
        const structure = structureSelector.data;
        if (!structure) throw new Error('Structure data is null');


        // Check if we have any reference at all
        const isReference = !this.referenceStructure && !this.referenceVolume;

        if (!isReference) {
            // Align to existing reference
            if (this.referenceStructure) {
                const transform = this.computeAlignmentTransform(this.referenceStructure, structure);
                if (transform) {
                    await this.applyStructureTransform(structureSelector, transform);
                    this.structureTransforms.set(structureId, transform);
                } else {
                    this.structureTransforms.set(structureId, Mat4.identity());
                }
            } else if (this.referenceVolume) {  // CHANGE: check for selector
                // Get fresh volume data from selector
                const volumeObj = this.referenceVolume.data;  // CHANGE: use .data
                if (volumeObj) {
                    await this.centerStructureOnVolume(structureSelector, volumeObj);
                } else {
                    console.warn("[VIEWER] Could not get reference volume data");
                }
            }
        } else {
            // This is the first item - set as reference
            this.referenceStructure = structure;
            this.referenceStructureId = structureId;
            this.referenceType = 'structure';
            this.structureTransforms.set(structureId, Mat4.identity());
        }

        const assignedColor = this.getNextColor();
        const reprRefs = await createStructureRepresentation(this.plugin!, structureSelector, assignedColor);

        const item: LoadedStructure = {
            type: 'structure',
            id: structureId,
            ref: structureSelector.ref,
            representationRefs: reprRefs,
            visible: true,
            color: assignedColor,
            format: formatLabel,
            isReference,
        };

        this.loadedItems.set(structureId, item);
        this.notifyChange();
        return item;
    }


    // Update the loadLocalVolume method in AlignmentViewer.ts
    async loadLocalVolume(url: string, label?: string, options: LoadMapOptions = {}): Promise<LoadedMap> {
        if (!this.plugin) throw new Error('Viewer not initialized');

        const { isoValue = 1.5 } = options;
        const itemId = label || url.split('/').pop()?.split('?')[0] || 'local_volume';
        const assignedColor = this.getNextColor();

        try {

            const data = await this.plugin.build()
                .toRoot()
                .apply(StateTransforms.Data.Download, {
                    url,
                    isBinary: true,
                    label: itemId
                }, { state: { isGhost: true } })
                .commit();

            if (!data.isOk) {
                throw new Error(`Download failed`);
            }

            const ccp4Format = this.plugin.dataFormats.get('ccp4');
            if (!ccp4Format) {
                throw new Error('CCP4 format parser not available');
            }

            const parsed = await ccp4Format.parse(this.plugin, data, { entryId: itemId });
            let volume = (parsed.volume || parsed.volumes?.[0]) as StateObjectSelector<SO.Volume.Data>;

            if (!volume?.isOk) {
                throw new Error('Failed to parse volume');
            }

            const volumeObj = this.plugin.state.data.cells.get(volume.ref)?.obj as SO.Volume.Data;
            const stats = getVolumeStats(volumeObj);

            // AUTO-DETECT if this is a "black" (inverted) template
            const isInverted = stats.max < Math.abs(stats.min) * 0.5;
            let actualIsoValue = isoValue;

            if (isInverted) {
                actualIsoValue = -Math.abs(isoValue);
            }

            // Set as reference if first item (BEFORE any transformation)
            const isFirstItem = !this.referenceStructure && !this.referenceVolume;

            if (this.referenceStructure) {
                // Align to reference structure
                volume = await this.centerVolumeOnReference(volume);  // This changes the ref!
            }

            // Store reference AFTER transformation
            if (isFirstItem) {
                this.referenceVolume = volume;  // CHANGE: store selector
                this.referenceVolumeId = itemId;
                this.referenceType = 'volume';
            }

            const reprRef = await createVolumeRepresentation(this.plugin, volume, assignedColor, actualIsoValue);

            const item: LoadedMap = {
                type: 'map',
                id: itemId,
                volumeRef: volume.ref,
                representationRef: reprRef,
                visible: true,
                color: assignedColor,
                emdbId: itemId,
                isoValue: actualIsoValue,
                stats,
                isInverted,
            };

            this.loadedItems.set(itemId, item);
            this.notifyChange();

            return item;
        } catch (e) {
            console.error("[VIEWER] Error loading local volume:", e);
            throw e;
        }
    }

    private async centerVolumeOnReference(volumeSelector: StateObjectSelector<SO.Volume.Data>): Promise<StateObjectSelector<SO.Volume.Data>> {
        if (!this.plugin || !this.referenceStructure) {
            return volumeSelector;
        }

        try {

            // Get reference structure's center
            const structCenter = this.referenceStructure.boundary.sphere.center;

            // Get volume's world center using proper grid transform
            const volumeObj = volumeSelector.data;
            if (!volumeObj) {
                return volumeSelector;
            }

            // Use Grid.getGridToCartesianTransform to handle spacegroup transforms properly
            const gridToCartesian = Grid.getGridToCartesianTransform(volumeObj.grid);

            // Calculate grid center in voxel coordinates
            const gridCenter = Vec3.create(
                (volumeObj.grid.cells.space.dimensions[0] - 1) / 2,
                (volumeObj.grid.cells.space.dimensions[1] - 1) / 2,
                (volumeObj.grid.cells.space.dimensions[2] - 1) / 2
            );

            // Transform to world coordinates
            const volumeCenter = Vec3.transformMat4(Vec3(), gridCenter, gridToCartesian);

            // Calculate translation
            const translation = Vec3.sub(Vec3(), structCenter, volumeCenter);

            // Check if translation is significant
            const translationMagnitude = Vec3.magnitude(translation);

            if (translationMagnitude < 0.1) {
                return volumeSelector;
            }

            // Create transformation matrix
            const matrix = Mat4.identity();
            Mat4.setTranslation(matrix, translation);

            // Apply volume-specific transform (NOT Model.TransformData!)

            const transformed = await this.plugin.build()
                .to(volumeSelector)
                .apply(StateTransforms.Volume.VolumeTransform, {
                    transform: {
                        name: 'matrix' as const,
                        params: { data: matrix, transpose: false }
                    },
                })
                .commit();


            return transformed;

        } catch (e) {
            console.error("[VIEWER] ERROR during volume alignment:", e);
            console.error("[VIEWER] Error stack:", e instanceof Error ? e.stack : "no stack");
            return volumeSelector;
        }
    }

    private async alignVolumeToStructure(volumeSelector: StateObjectSelector<SO.Volume.Data>): Promise<void> {
        if (!this.plugin || !this.referenceStructure) return;

        try {
            // Get structure center
            const structureObj = this.plugin.state.data.select(
                StateSelection.Generators.byRef(this.referenceStructureId!)
            )[0]?.obj as SO.Molecule.Structure | undefined;

            if (!structureObj) return;

            const structureData = structureObj.data;
            const boundary = structureData.boundary;
            const structureCenter = boundary.sphere.center;


            // Get volume data
            const volumeObj = volumeSelector.data;
            if (!volumeObj) return;

            const grid = volumeObj.grid;
            const volumeCenter = [
                (grid.cells.space.dimensions[0] / 2) * grid.cells.space.size[0],
                (grid.cells.space.dimensions[1] / 2) * grid.cells.space.size[1],
                (grid.cells.space.dimensions[2] / 2) * grid.cells.space.size[2],
            ];


            // Calculate translation to align centers
            const translation = Mat4.identity();
            Mat4.setTranslation(translation, [
                structureCenter[0] - volumeCenter[0],
                structureCenter[1] - volumeCenter[1],
                structureCenter[2] - volumeCenter[2],
            ]);


            // Apply transform
            await this.plugin.build()
                .to(volumeSelector)
                .apply(StateTransforms.Model.TransformData, {
                    transform: { name: 'matrix' as const, params: { data: translation, transpose: false } },
                })
                .commit();

        } catch (e) {
            console.warn("[VIEWER] Could not align volume to structure:", e);
        }
    }

    async loadStructure(pdbId: string): Promise<LoadedStructure> {
        if (!this.plugin) throw new Error('Viewer not initialized');

        const structureId = pdbId.toUpperCase();
        const sources = getStructureSources(pdbId);
        let lastError: Error | null = null;

        for (const source of sources) {
            try {
                const data = await this.plugin.builders.data.download({
                    url: source.url,
                    isBinary: source.isBinary,
                });

                const trajectory = await this.plugin.builders.structure.parseTrajectory(data, source.format);
                const model = await this.plugin.builders.structure.createModel(trajectory);
                const structureSelector = await this.plugin.builders.structure.createStructure(model);

                return await this._processStructure(structureSelector, structureId, source.label);
            } catch (e) {
                lastError = e as Error;
                console.warn(`Failed ${source.label}: ${lastError.message}`);
                continue;
            }
        }

        throw new Error(`Failed to load structure ${pdbId}: ${lastError?.message}`);
    }

    async loadStructureFromUrl(url: string, format: 'pdb' | 'mmcif'): Promise<LoadedStructure> {
        if (!this.plugin) throw new Error('Viewer not initialized');
        const structureId = url.split('/').pop()?.split('?')[0] || 'local_structure';

        const data = await this.plugin.builders.data.download({ url, isBinary: false });
        const trajectory = await this.plugin.builders.structure.parseTrajectory(data, format);
        const model = await this.plugin.builders.structure.createModel(trajectory);
        const structureSelector = await this.plugin.builders.structure.createStructure(model);

        return await this._processStructure(structureSelector, structureId, format);
    }

    async loadEmdbMap(emdbId: string, options: LoadMapOptions = {}): Promise<LoadedMap> {
        const cleanId = emdbId.toUpperCase().replace('EMD-', '');
        const numericId = parseInt(cleanId);
        const url = `https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-${numericId}/map/emd_${numericId}.map.gz`;
        return this.loadVolumeFromUrl(url, `EMD-${cleanId}`, options);
    }

    async loadVolumeFromUrl(url: string, label?: string, options: LoadMapOptions = {}): Promise<LoadedMap> {
        if (!this.plugin) throw new Error('Viewer not initialized');
        const { isoValue = 1.5 } = options;
        const itemId = label || url.split('/').pop()?.split('?')[0] || 'local_volume';
        const assignedColor = this.getNextColor();

        try {

            const isGzipped = url.endsWith('.gz');

            const data = await this.plugin.build()
                .toRoot()
                .apply(StateTransforms.Data.Download, {
                    url,
                    isBinary: true,
                    label: itemId
                }, { state: { isGhost: true } })
                .apply(isGzipped ? StateTransforms.Data.DeflateData : StateTransforms.Data.Passthrough)
                .commit();

            let parsed;
            let volume;

            try {
                const ccp4Format = this.plugin.dataFormats.get('ccp4');
                if (ccp4Format) {
                    parsed = await ccp4Format.parse(this.plugin, data, { entryId: itemId });
                    volume = (parsed.volume || parsed.volumes?.[0]) as StateObjectSelector<SO.Volume.Data>;
                }
            } catch (ccp4Error) {
            }

            if (!volume || !volume.isOk) {
                const volumeFormats = ['dscif', 'cube'];
                for (const formatName of volumeFormats) {
                    try {
                        const format = this.plugin.dataFormats.get(formatName);
                        if (format) {
                            parsed = await format.parse(this.plugin, data, { entryId: itemId });
                            volume = (parsed.volume || parsed.volumes?.[0]) as StateObjectSelector<SO.Volume.Data>;
                            if (volume && volume.isOk) break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            if (!volume?.isOk) {
                throw new Error('Failed to parse volume with any available format');
            }

            // Center volume on reference if available
            if (this.referenceStructure && this.referenceStructureId) {
                volume = await this.centerVolumeOnReference(volume);
            }

            const volumeObj = this.plugin.state.data.cells.get(volume.ref)?.obj as SO.Volume.Data;
            const stats = getVolumeStats(volumeObj);

            const reprRef = await createVolumeRepresentation(this.plugin, volume, assignedColor, isoValue);

            const item: LoadedMap = {
                type: 'map',
                id: itemId,
                volumeRef: volume.ref,
                representationRef: reprRef,
                visible: true,
                color: assignedColor,
                emdbId: itemId,
                isoValue,
                stats,
            };

            this.loadedItems.set(itemId, item);
            this.notifyChange();

            return item;
        } catch (e) {
            console.error("[VIEWER] Error in loadVolumeFromUrl:", e);
            throw e;
        }
    }

    async setItemVisibility(itemId: string, visible: boolean): Promise<void> {
        if (!this.plugin) return;

        const item = this.loadedItems.get(itemId);
        if (!item) return;

        const ref = item.type === 'structure' ? item.ref : item.volumeRef;
        setSubtreeVisibility(this.plugin.state.data, ref, !visible);

        item.visible = visible;
        this.notifyChange();
    }

    async setItemColor(itemId: string, color: number): Promise<void> {
        if (!this.plugin) return;

        const item = this.loadedItems.get(itemId);
        if (!item) return;

        if (item.type === 'structure') {
            await updateStructureColor(this.plugin, item.representationRefs, color);
        } else {
            await updateVolumeColor(this.plugin, item.representationRef, color);
        }

        item.color = color;
        this.notifyChange();
    }

    async setMapIsoValue(itemId: string, isoValue: number): Promise<void> {
        if (!this.plugin) return;

        const item = this.loadedItems.get(itemId);
        if (!item || item.type !== 'map') return;

        await updateVolumeIsoValue(this.plugin, item.representationRef, isoValue);
        item.isoValue = isoValue;
        this.notifyChange();
    }

    getMapAbsoluteIsoValue(itemId: string): number | null {
        const item = this.loadedItems.get(itemId);
        if (!item || item.type !== 'map') return null;
        return relativeToAbsolute(item.isoValue, item.stats);
    }

    async deleteItem(itemId: string): Promise<void> {
        if (!this.plugin) return;

        const item = this.loadedItems.get(itemId);
        if (!item) return;

        const ref = item.type === 'structure' ? item.ref : item.volumeRef;

        let rootRef = ref;
        const findRoot = (r: string): string => {
            const cell = this.plugin!.state.data.cells.get(r);
            const parentRef = cell?.transform.parent;
            if (parentRef && parentRef !== this.plugin!.state.data.tree.root.ref) {
                return findRoot(parentRef);
            }
            return r;
        };
        rootRef = findRoot(ref);

        await PluginCommands.State.RemoveObject(this.plugin, {
            state: this.plugin.state.data,
            ref: rootRef,
            removeParentGhosts: true,
        });

        if (item.type === 'structure' && item.isReference) {
            this.referenceStructure = null;
            this.referenceStructureId = null;
            for (const [, otherItem] of this.loadedItems) {
                if (otherItem.type === 'structure' && otherItem.id !== itemId) {
                    otherItem.isReference = true;
                    break;
                }
            }
        }

        this.loadedItems.delete(itemId);
        this.structureTransforms.delete(itemId);
        this.notifyChange();
    }

    async clear(): Promise<void> {
        if (!this.plugin) return;

        await PluginCommands.State.RemoveObject(this.plugin, {
            state: this.plugin.state.data,
            ref: this.plugin.state.data.tree.root.ref,
            removeParentGhosts: true,
        });

        this.referenceStructure = null;
        this.referenceStructureId = null;
        this.referenceVolume = null;  // CHANGE
        this.referenceVolumeId = null;
        this.referenceType = null;
        this.structureTransforms.clear();
        this.loadedItems.clear();
        this.colorIndex = 0;
        this.notifyChange();
    }

    dispose(): void {
        this.plugin?.dispose();
        this.plugin = null;
    }

    private computeAlignmentTransform(reference: Structure, mobile: Structure): Mat4 | null {
        const refLoci = StructureElement.Loci.all(reference);
        const mobileLoci = StructureElement.Loci.all(mobile);
        const results = superpose([refLoci, mobileLoci]);

        if (results.length === 0 || Number.isNaN(results[0].rmsd)) {
            return null;
        }
        console.log(`Alignment RMSD: ${results[0].rmsd.toFixed(2)} A`);
        return results[0].transform;
    }

    private async applyStructureTransform(
        selector: StateObjectSelector<SO.Molecule.Structure>,
        transform: Mat4
    ): Promise<void> {
        if (!this.plugin) return;

        await this.plugin
            .build()
            .to(selector)
            .apply(StateTransforms.Model.TransformStructureConformation, {
                transform: { name: 'matrix' as const, params: { data: transform, transpose: false } },
            })
            .commit();
    }
}

export async function createAlignmentViewer(container: HTMLElement): Promise<AlignmentViewer> {
    const viewer = new AlignmentViewer();
    await viewer.init(container);
    return viewer;
}