import { Color } from 'molstar/lib/mol-util/color';

export const STYLIZED_POSTPROCESSING = {
  outline: {
    name: 'on' as const,
    params: {
      scale: 1,
      color: Color(0x000000),
      threshold: 0.33,
      includeTransparent: true,
    },
  },
  occlusion: {
    name: 'on' as const,
    params: {
      multiScale: { name: 'off' as const, params: {} },
      radius: 5,
      bias: 0.8,
      blurKernelSize: 15,
      blurDepthBias: 0.5,
      samples: 32,
      resolutionScale: 1,
      color: Color(0x000000),
    },
  },
  shadow: {
    name: 'off' as const,
    params: {},
  },
};