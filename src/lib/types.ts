import type { Mat4 } from 'molstar/lib/mol-math/linear-algebra';

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

export interface LoadedMap {
  type: 'map';
  id: string;
  volumeRef: string;
  representationRef: string;
  visible: boolean;
  color: number;
  emdbId: string;
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

export interface AlignmentResult {
  rmsd: number;
  transform: Mat4;
}