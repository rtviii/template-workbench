// src/index.ts

import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec';
import { StateObjectSelector } from 'molstar/lib/mol-state';
import { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure';
import { superpose } from 'molstar/lib/mol-model/structure/structure/util/superposition';
import { Mat4 } from 'molstar/lib/mol-math/linear-algebra';
import { DownloadDensity } from 'molstar/lib/mol-plugin-state/actions/volume';

export interface LoadStructureOptions {
    format?: 'mmcif' | 'pdb' | 'bcif';
}

export interface LoadMapOptions {
    isoValue?: number;
    detail?: number;
    server?: 'pdbe' | 'rcsb';
}

interface StructureSource {
    url: string;
    format: 'mmcif' | 'pdb';
    isBinary: boolean;
    label: string;
}

export class AlignmentViewer {
    plugin: PluginContext | null = null;

    private referenceStructure: Structure | null = null;
    private referenceStructureId: string | null = null;

    private structureTransforms: Map<string, Mat4> = new Map();
    private structureSelectors: Map<string, StateObjectSelector<SO.Molecule.Structure>> = new Map();

    async init(container: HTMLElement): Promise<void> {
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);

        const spec = DefaultPluginSpec();
        this.plugin = new PluginContext(spec);
        await this.plugin.init();
        this.plugin.initViewer(canvas, container);
    }

    private getStructureSources(pdbId: string): StructureSource[] {
        const id = pdbId.toUpperCase();
        return [
            {
                url: `https://models.rcsb.org/${id}.bcif`,
                format: 'mmcif',
                isBinary: true,
                label: 'bcif'
            },
            {
                url: `https://files.rcsb.org/download/${id}.cif`,
                format: 'mmcif',
                isBinary: false,
                label: 'mmcif'
            },
            {
                url: `https://files.rcsb.org/download/${id}.pdb`,
                format: 'pdb',
                isBinary: false,
                label: 'pdb'
            }
        ];
    }

    async loadStructure(
        pdbId: string,
        id?: string
    ): Promise<{ selector: StateObjectSelector<SO.Molecule.Structure>; format: string }> {
        if (!this.plugin) throw new Error('Viewer not initialized');

        const structureId = id || pdbId.toUpperCase();
        const sources = this.getStructureSources(pdbId);

        let lastError: Error | null = null;
        
        for (const source of sources) {
            try {
                const data = await this.plugin.builders.data.download({ 
                    url: source.url, 
                    isBinary: source.isBinary 
                });
                
                const trajectory = await this.plugin.builders.structure.parseTrajectory(data, source.format);
                const model = await this.plugin.builders.structure.createModel(trajectory);
                const structureSelector = await this.plugin.builders.structure.createStructure(model);

                const structure = structureSelector.data;
                if (!structure) throw new Error('Structure data is null');

                // Handle alignment
                if (!this.referenceStructure) {
                    this.referenceStructure = structure;
                    this.referenceStructureId = structureId;
                    this.structureTransforms.set(structureId, Mat4.identity());
                } else {
                    const transform = this.computeAlignmentTransform(this.referenceStructure, structure);
                    if (transform) {
                        await this.applyStructureTransform(structureSelector, transform);
                        this.structureTransforms.set(structureId, transform);
                    } else {
                        console.warn(`Alignment failed for ${structureId}, loading without transform`);
                        this.structureTransforms.set(structureId, Mat4.identity());
                    }
                }

                this.structureSelectors.set(structureId, structureSelector);
                await this.plugin.builders.structure.representation.applyPreset(structureSelector, 'auto');

                return { selector: structureSelector, format: source.label };
                
            } catch (e) {
                lastError = e as Error;
                console.warn(`Failed to load ${pdbId} via ${source.label}: ${lastError.message}`);
                continue;
            }
        }

        throw new Error(`Failed to load structure ${pdbId} from any source. Last error: ${lastError?.message}`);
    }

    async loadEmdbMap(
        emdbId: string,
        options: LoadMapOptions = {}
    ): Promise<void> {
        if (!this.plugin) throw new Error('Viewer not initialized');

        const { detail = 3, server = 'pdbe' } = options;
        
        // Normalize EMDB ID: accept "6057", "EMD-6057", "emd-6057" etc.
        const cleanId = emdbId.toUpperCase().replace('EMD-', '');
        const formattedId = `emd-${cleanId}`;

        await this.plugin.runTask(
            this.plugin.state.data.applyAction(DownloadDensity, {
                source: {
                    name: 'pdb-emd-ds' as const,
                    params: {
                        provider: {
                            id: formattedId,
                            server: server,
                        },
                        detail: detail,
                    }
                }
            })
        );
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

        await this.plugin.build()
            .to(selector)
            .apply(StateTransforms.Model.TransformStructureConformation, {
                transform: {
                    name: 'matrix' as const,
                    params: { data: transform, transpose: false }
                }
            })
            .commit();
    }

    setReference(structureId: string): boolean {
        const selector = this.structureSelectors.get(structureId);
        if (!selector?.data) return false;

        this.referenceStructure = selector.data;
        this.referenceStructureId = structureId;
        return true;
    }

    getTransform(structureId: string): Mat4 | undefined {
        return this.structureTransforms.get(structureId);
    }

    getReferenceId(): string | null {
        return this.referenceStructureId;
    }

    async clear(): Promise<void> {
        if (!this.plugin) return;

        await this.plugin.clear();
        this.referenceStructure = null;
        this.referenceStructureId = null;
        this.structureTransforms.clear();
        this.structureSelectors.clear();
    }

    dispose(): void {
        this.plugin?.dispose();
        this.plugin = null;
    }
}

// Utility: fetch EMDB IDs associated with a PDB entry
export async function fetchEmdbIds(pdbId: string): Promise<string[]> {
    const url = `https://data.rcsb.org/rest/v1/core/entry/${pdbId.toUpperCase()}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        
        const data = await response.json();
        const identifiers = data?.rcsb_entry_container_identifiers || {};
        return identifiers.emdb_ids || [];
    } catch {
        return [];
    }
}

export async function createAlignmentViewer(container: HTMLElement): Promise<AlignmentViewer> {
    const viewer = new AlignmentViewer();
    await viewer.init(container);
    return viewer;
}