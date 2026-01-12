export interface LoadedStructure {
  type: 'structure';
  id: string;
  ref: string;
  representationRefs: string[];
  visible: boolean;
  color: number;
  format: string;
  isReference: boolean;
}

export interface VolumeStats {
  min: number;
  max: number;
  mean: number;
  sigma: number;
}

export interface LoadedMap {
  type: 'map';
  id: string;
  volumeRef: string;
  representationRef: string;
  visible: boolean;
  color: number;
  emdbId: string;
  isoValue: number;        // actual ISO used (can be negative)
  stats: VolumeStats;
  isInverted?: boolean;    // ADD THIS
}

export type LoadedItem = LoadedStructure | LoadedMap;

export interface StructureSource {
  url: string;
  format: 'mmcif' | 'pdb';
  isBinary: boolean;
  label: string;
}

export interface LoadMapOptions {
  isoValue?: number;
}