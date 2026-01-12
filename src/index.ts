// src/index.ts

import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { StateObjectSelector, StateSelection } from "molstar/lib/mol-state";
import { PluginStateObject as SO } from "molstar/lib/mol-plugin-state/objects";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { Structure, StructureElement } from "molstar/lib/mol-model/structure";
import { superpose } from "molstar/lib/mol-model/structure/structure/util/superposition";
import { Mat4 } from "molstar/lib/mol-math/linear-algebra";
import { DownloadDensity } from "molstar/lib/mol-plugin-state/actions/volume";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import { Color } from "molstar/lib/mol-util/color";
import { createVolumeRepresentationParams } from "molstar/lib/mol-plugin-state/helpers/volume-representation-params";
import { Volume } from "molstar/lib/mol-model/volume";

export interface LoadedStructure {
  type: "structure";
  id: string;
  ref: string;
  representationRefs: string[];
  visible: boolean;
  color: number;
  format: string;
  isReference: boolean;
}

export interface LoadedMap {
  type: "map";
  id: string;
  volumeRef: string;
  representationRef: string;
  visible: boolean;
  color: number;
  emdbId: string;
}

export type LoadedItem = LoadedStructure | LoadedMap;

interface StructureSource {
  url: string;
  format: "mmcif" | "pdb";
  isBinary: boolean;
  label: string;
}

// Color palette - export for UI use
export const COLOR_PALETTE = [
  // Row 1: Blues
  0x1a237e, 0x283593, 0x303f9f, 0x3949ab, 0x3f51b5, 0x5c6bc0,
  // Row 2: Teals/Cyans
  0x006064, 0x00838f, 0x0097a7, 0x00acc1, 0x00bcd4, 0x26c6da,
  // Row 3: Greens
  0x1b5e20, 0x2e7d32, 0x388e3c, 0x43a047, 0x4caf50, 0x66bb6a,
  // Row 4: Yellows/Oranges
  0xf57f17, 0xf9a825, 0xfbc02d, 0xfdd835, 0xffeb3b, 0xfff176,
  // Row 5: Reds/Pinks
  0xb71c1c, 0xc62828, 0xd32f2f, 0xe53935, 0xf44336, 0xef5350,
  // Row 6: Purples/Grays
  0x4a148c, 0x6a1b9a, 0x7b1fa2, 0x8e24aa, 0x9c27b0, 0xab47bc,
];
// Add to imports at the top

// Add a helper method to the class
export class AlignmentViewer {
  plugin: PluginContext | null = null;

  private referenceStructure: Structure | null = null;
  private referenceStructureId: string | null = null;
  private structureTransforms: Map<string, Mat4> = new Map();

  private loadedItems: Map<string, LoadedItem> = new Map();
  private onChangeCallbacks: Set<() => void> = new Set();

  async init(container: HTMLElement): Promise<void> {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);

    const spec = DefaultPluginSpec();
    this.plugin = new PluginContext(spec);
    await this.plugin.init();
    this.plugin.initViewer(canvas, container);

    const renderer = this.plugin.canvas3d?.props.renderer;
    PluginCommands.Canvas3D.SetSettings(this.plugin, {
      settings: { renderer: { ...renderer, backgroundColor: Color(0xffffff) } },
    });
  }

  private showToast(message: string, timeoutMs = 5000): void {
    if (!this.plugin) return;
    PluginCommands.Toast.Show(this.plugin, {
      title: "Progress",
      message,
      timeoutMs,
    });
  }

  private hideToast(): void {
    if (!this.plugin) return;
    PluginCommands.Toast.Hide(this.plugin, { key: "progress" });
  }

  onChange(callback: () => void): () => void {
    this.onChangeCallbacks.add(callback);
    return () => this.onChangeCallbacks.delete(callback);
  }

  private notifyChange() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }

  getLoadedItems(): LoadedItem[] {
    return Array.from(this.loadedItems.values());
  }

  private getStructureSources(pdbId: string): StructureSource[] {
    const id = pdbId.toUpperCase();
    return [
      {
        url: `https://models.rcsb.org/${id}.bcif`,
        format: "mmcif",
        isBinary: true,
        label: "bcif",
      },
      {
        url: `https://files.rcsb.org/download/${id}.cif`,
        format: "mmcif",
        isBinary: false,
        label: "mmcif",
      },
      {
        url: `https://files.rcsb.org/download/${id}.pdb`,
        format: "pdb",
        isBinary: false,
        label: "pdb",
      },
    ];
  }

  private colorIndex = 0;

  private getNextColor(): number {
    const color = COLOR_PALETTE[this.colorIndex % COLOR_PALETTE.length];
    this.colorIndex++;
    return color;
  }

  async loadStructure(pdbId: string): Promise<LoadedStructure> {
    if (!this.plugin) throw new Error('Viewer not initialized');

    const structureId = pdbId.toUpperCase();
    const sources = this.getStructureSources(pdbId);
    const assignedColor = this.getNextColor();

    let lastError: Error | null = null;

    for (const source of sources) {
      try {
        this.showToast(`Downloading ${structureId} (${source.label})...`, 30000);

        const data = await this.plugin.builders.data.download({
          url: source.url,
          isBinary: source.isBinary
        });

        this.showToast(`Parsing ${structureId}...`, 30000);

        const trajectory = await this.plugin.builders.structure.parseTrajectory(data, source.format);
        const model = await this.plugin.builders.structure.createModel(trajectory);
        const structureSelector = await this.plugin.builders.structure.createStructure(model);

        const structure = structureSelector.data;
        if (!structure) throw new Error('Structure data is null');

        // Handle alignment
        const isReference = !this.referenceStructure;
        if (!isReference) {
          this.showToast(`Aligning ${structureId} to reference...`, 30000);
          const transform = this.computeAlignmentTransform(this.referenceStructure!, structure);
          if (transform) {
            await this.applyStructureTransform(structureSelector, transform);
            this.structureTransforms.set(structureId, transform);
          } else {
            this.structureTransforms.set(structureId, Mat4.identity());
          }
        } else {
          this.referenceStructure = structure;
          this.referenceStructureId = structureId;
          this.structureTransforms.set(structureId, Mat4.identity());
        }

        this.showToast(`Creating representation...`, 30000);

        const reprRefs = await this.createStructureRepresentation(structureSelector, assignedColor);

        const item: LoadedStructure = {
          type: 'structure',
          id: structureId,
          ref: structureSelector.ref,
          representationRefs: reprRefs,
          visible: true,
          color: assignedColor,
          format: source.label,
          isReference
        };

        this.loadedItems.set(structureId, item);
        this.notifyChange();

        this.showToast(`${structureId} loaded`, 2000);

        return item;

      } catch (e) {
        lastError = e as Error;
        console.warn(`Failed ${source.label}: ${lastError.message}`);
        continue;
      }
    }

    this.showToast(`Failed to load ${structureId}`, 5000);
    throw new Error(`Failed to load structure ${pdbId}: ${lastError?.message}`);
  }

  private async createStructureRepresentation(
    structureSelector: StateObjectSelector<SO.Molecule.Structure>,
    color: number
  ): Promise<string[]> {
    if (!this.plugin) return [];

    const structure = structureSelector.data;
    if (!structure) return [];

    const reprRefs: string[] = [];

    // Create cartoon representation with uniform color
    const cartoonRepr = await this.plugin
      .build()
      .to(structureSelector)
      .apply(StateTransforms.Representation.StructureRepresentation3D, {
        type: { name: "cartoon", params: {} },
        colorTheme: { name: "uniform", params: { value: Color(color) } },
        sizeTheme: { name: "uniform", params: {} },
      })
      .commit();

    if (cartoonRepr.ref) {
      reprRefs.push(cartoonRepr.ref);
    }

    return reprRefs;
  }

  async loadEmdbMap(
    emdbId: string,
    options: { isoValue?: number } = {}
  ): Promise<LoadedMap> {
    if (!this.plugin) throw new Error('Viewer not initialized');

    const { isoValue = 1.5 } = options;
    const cleanId = emdbId.toUpperCase().replace('EMD-', '');
    const numericId = parseInt(cleanId);
    const itemId = `EMD-${cleanId}`;
    const assignedColor = this.getNextColor();

    const url = `https://ftp.ebi.ac.uk/pub/databases/emdb/structures/EMD-${numericId}/map/emd_${numericId}.map.gz`;

    try {
      this.showToast(`Downloading ${itemId} (this may take a while)...`, 120000);

      const data = await this.plugin.build()
        .toRoot()
        .apply(StateTransforms.Data.Download, { url, isBinary: true, label: itemId }, { state: { isGhost: true } })
        .apply(StateTransforms.Data.DeflateData)
        .commit();

      this.showToast(`Parsing ${itemId}...`, 60000);

      const parsed = await this.plugin.dataFormats.get('ccp4')!.parse(this.plugin, data, { entryId: itemId });
      const volume = (parsed.volume || parsed.volumes?.[0]) as StateObjectSelector<SO.Volume.Data>;

      if (!volume?.isOk) throw new Error('Failed to parse volume');

      this.showToast(`Creating isosurface...`, 30000);

      const repr = await this.plugin.build()
        .to(volume)
        .apply(StateTransforms.Representation.VolumeRepresentation3D,
          createVolumeRepresentationParams(this.plugin, volume.data!, {
            type: 'isosurface',
            typeParams: { alpha: 0.4, isoValue: Volume.IsoValue.relative(isoValue) },
            color: 'uniform',
            colorParams: { value: Color(assignedColor) }
          })
        )
        .commit();

      const item: LoadedMap = {
        type: 'map',
        id: itemId,
        volumeRef: volume.ref,
        representationRef: repr.ref,
        visible: true,
        color: assignedColor,
        emdbId: cleanId
      };

      this.loadedItems.set(itemId, item);
      this.notifyChange();

      this.showToast(`${itemId} loaded`, 2000);

      return item;

    } catch (e) {
      this.showToast(`Failed to load ${itemId}`, 5000);
      throw e;
    }
  }

  private getVolumeRefs(): string[] {
    if (!this.plugin) return [];
    const cells = this.plugin.state.data.select(
      StateSelection.Generators.root.subtree().ofType(SO.Volume.Data)
    );
    return cells.map((c) => c.transform.ref);
  }

  private getVolumeRepresentationRef(volumeRef: string): string | undefined {
    if (!this.plugin) return undefined;

    const collectReprRefs = (ref: string): string | undefined => {
      const children = this.plugin!.state.data.tree.children.get(ref);
      if (!children) return undefined;

      for (const childRef of children.keys()) {
        const cell = this.plugin!.state.data.cells.get(childRef);
        if (cell?.obj?.type.name === "Volume Representation 3D") {
          return childRef;
        }
        // Check deeper
        const found = collectReprRefs(childRef);
        if (found) return found;
      }
      return undefined;
    };

    return collectReprRefs(volumeRef);
  }

  async setItemVisibility(itemId: string, visible: boolean): Promise<void> {
    if (!this.plugin) return;

    const item = this.loadedItems.get(itemId);
    if (!item) return;

    const ref = item.type === "structure" ? item.ref : item.volumeRef;
    setSubtreeVisibility(this.plugin.state.data, ref, !visible);

    item.visible = visible;
    this.notifyChange();
  }

  async setItemColor(itemId: string, color: number): Promise<void> {
    if (!this.plugin) return;

    const item = this.loadedItems.get(itemId);
    if (!item) return;

    if (item.type === "structure") {
      await this.updateStructureColor(item.representationRefs, color);
    } else {
      await this.updateVolumeColor(item.representationRef, color);
    }

    item.color = color;
    this.notifyChange();
  }

  private async updateStructureColor(
    reprRefs: string[],
    color: number
  ): Promise<void> {
    if (!this.plugin || reprRefs.length === 0) return;

    const update = this.plugin.build();
    for (const ref of reprRefs) {
      update.to(ref).update((old) => ({
        ...old,
        colorTheme: { name: "uniform", params: { value: Color(color) } },
      }));
    }
    await update.commit();
  }

  private async updateVolumeColor(
    reprRef: string,
    color: number
  ): Promise<void> {
    if (!this.plugin || !reprRef) return;

    await this.plugin
      .build()
      .to(reprRef)
      .update((old) => ({
        ...old,
        colorTheme: { name: "uniform", params: { value: Color(color) } },
      }))
      .commit();
  }

  async deleteItem(itemId: string): Promise<void> {
    if (!this.plugin) return;

    const item = this.loadedItems.get(itemId);
    if (!item) return;

    const ref = item.type === "structure" ? item.ref : item.volumeRef;

    // Find root data node
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

    if (item.type === "structure" && item.isReference) {
      this.referenceStructure = null;
      this.referenceStructureId = null;
      for (const [, otherItem] of this.loadedItems) {
        if (otherItem.type === "structure" && otherItem.id !== itemId) {
          otherItem.isReference = true;
          break;
        }
      }
    }

    this.loadedItems.delete(itemId);
    this.structureTransforms.delete(itemId);
    this.notifyChange();
  }

  private computeAlignmentTransform(
    reference: Structure,
    mobile: Structure
  ): Mat4 | null {
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
        transform: {
          name: "matrix" as const,
          params: { data: transform, transpose: false },
        },
      })
      .commit();
  }

  getReferenceId(): string | null {
    return this.referenceStructureId;
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
    this.structureTransforms.clear();
    this.loadedItems.clear();
    this.colorIndex = 0;
    this.notifyChange();
  }

  dispose(): void {
    this.plugin?.dispose();
    this.plugin = null;
  }
}

export async function fetchEmdbIds(pdbId: string): Promise<string[]> {
  const url = `https://data.rcsb.org/rest/v1/core/entry/${pdbId.toUpperCase()}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return data?.rcsb_entry_container_identifiers?.emdb_ids || [];
  } catch {
    return [];
  }
}

export async function createAlignmentViewer(
  container: HTMLElement
): Promise<AlignmentViewer> {
  const viewer = new AlignmentViewer();
  await viewer.init(container);
  return viewer;
}
