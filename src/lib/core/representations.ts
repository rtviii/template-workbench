import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { StateObjectSelector } from 'molstar/lib/mol-state';
import { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { Color } from 'molstar/lib/mol-util/color';
import { createVolumeRepresentationParams } from 'molstar/lib/mol-plugin-state/helpers/volume-representation-params';
import { Volume } from 'molstar/lib/mol-model/volume';

export async function createStructureRepresentation(
  plugin: PluginContext,
  structureSelector: StateObjectSelector<SO.Molecule.Structure>,
  color: number
): Promise<string[]> {
  const structure = structureSelector.data;
  if (!structure) return [];

  const reprRefs: string[] = [];

  const cartoonRepr = await plugin
    .build()
    .to(structureSelector)
    .apply(StateTransforms.Representation.StructureRepresentation3D, {
      type: { name: 'cartoon', params: {} },
      colorTheme: { name: 'uniform', params: { value: Color(color) } },
      sizeTheme: { name: 'uniform', params: {} },
    })
    .commit();

  if (cartoonRepr.ref) {
    reprRefs.push(cartoonRepr.ref);
  }

  return reprRefs;
}

export async function createVolumeRepresentation(
  plugin: PluginContext,
  volume: StateObjectSelector<SO.Volume.Data>,
  color: number,
  isoValue: number
): Promise<string> {
  const repr = await plugin
    .build()
    .to(volume)
    .apply(
      StateTransforms.Representation.VolumeRepresentation3D,
      createVolumeRepresentationParams(plugin, volume.data!, {
        type: 'isosurface',
        typeParams: { alpha: 0.4, isoValue: Volume.IsoValue.relative(isoValue) },
        color: 'uniform',
        colorParams: { value: Color(color) },
      })
    )
    .commit();

  return repr.ref;
}

export async function updateStructureColor(
  plugin: PluginContext,
  reprRefs: string[],
  color: number
): Promise<void> {
  if (reprRefs.length === 0) return;

  const update = plugin.build();
  for (const ref of reprRefs) {
    update.to(ref).update((old) => ({
      ...old,
      colorTheme: { name: 'uniform', params: { value: Color(color) } },
    }));
  }
  await update.commit();
}

export async function updateVolumeColor(
  plugin: PluginContext,
  reprRef: string,
  color: number
): Promise<void> {
  if (!reprRef) return;

  await plugin
    .build()
    .to(reprRef)
    .update((old) => ({
      ...old,
      colorTheme: { name: 'uniform', params: { value: Color(color) } },
    }))
    .commit();
}