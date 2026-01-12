import type { StructureSource } from './types';

// Lighter, more vibrant palette
export const COLOR_PALETTE = [
  // Blues (lighter)
  0x5c6bc0, 0x7986cb, 0x9fa8da, 0x42a5f5, 0x64b5f6, 0x90caf9,
  // Teals/Cyans
  0x26c6da, 0x4dd0e1, 0x80deea, 0x26a69a, 0x4db6ac, 0x80cbc4,
  // Greens
  0x66bb6a, 0x81c784, 0xa5d6a7, 0x9ccc65, 0xaed581, 0xc5e1a5,
  // Oranges/Yellows
  0xffa726, 0xffb74d, 0xffcc80, 0xffee58, 0xfff176, 0xfff59d,
  // Reds/Pinks
  0xef5350, 0xe57373, 0xef9a9a, 0xec407a, 0xf06292, 0xf48fb1,
  // Purples
  0xab47bc, 0xba68c8, 0xce93d8, 0x7e57c2, 0x9575cd, 0xb39ddb,
];

export function getStructureSources(pdbId: string): StructureSource[] {
  const id = pdbId.toUpperCase();
  return [
    { url: `https://models.rcsb.org/${id}.bcif`, format: 'mmcif', isBinary: true, label: 'bcif' },
    { url: `https://files.rcsb.org/download/${id}.cif`, format: 'mmcif', isBinary: false, label: 'mmcif' },
    { url: `https://files.rcsb.org/download/${id}.pdb`, format: 'pdb', isBinary: false, label: 'pdb' },
  ];
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

export function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}