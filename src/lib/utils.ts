import type { StructureSource } from './types';

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
  // Row 6: Purples
  0x4a148c, 0x6a1b9a, 0x7b1fa2, 0x8e24aa, 0x9c27b0, 0xab47bc,
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