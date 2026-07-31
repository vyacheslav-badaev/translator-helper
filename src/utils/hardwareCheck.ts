export interface HardwareCheckResult {
  supported: boolean;
  /**
   * Largest single GPU buffer the adapter advertises, in GB. This is a
   * capability hint reported for diagnostics only — WebGPU exposes no API for
   * total VRAM, so it must NOT be used as a hard support gate.
   */
  maxBufferGb: number;
  gpuName: string;
  reason?: string;
}

/** Reads adapter identity via the modern `info` getter, with a legacy fallback. */
async function readAdapterInfo(
  adapter: GPUAdapter
): Promise<GPUAdapterInfo | undefined> {
  if (adapter.info) {
    return adapter.info;
  }
  if (typeof adapter.requestAdapterInfo === 'function') {
    try {
      return await adapter.requestAdapterInfo();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Checks whether the device can run the local WebGPU model.
 *
 * Must be called from a context with DOM access (offscreen document, not the
 * service worker). Support is determined by: WebGPU availability, an adapter
 * exposing the `shader-f16` feature (required for the q4f16 model), and the
 * ability to actually acquire a device. There is no reliable WebGPU API for
 * total VRAM, so no memory-size gate is applied.
 */
export async function checkWebGpuSupport(): Promise<HardwareCheckResult> {
  if (!navigator.gpu) {
    return {
      supported: false,
      maxBufferGb: 0,
      gpuName: 'unknown',
      reason: 'WebGPU API not available in this browser'
    };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
  } catch {
    return {
      supported: false,
      maxBufferGb: 0,
      gpuName: 'unknown',
      reason: 'Failed to request WebGPU adapter'
    };
  }

  if (!adapter) {
    return {
      supported: false,
      maxBufferGb: 0,
      gpuName: 'unknown',
      reason: 'No WebGPU adapter found (no supported GPU)'
    };
  }

  const info = await readAdapterInfo(adapter);
  const gpuName =
    info?.description || info?.vendor || info?.architecture || 'Unknown GPU';

  const maxBufferGb =
    (adapter.limits.maxBufferSize ?? 0) / (1024 * 1024 * 1024);

  const hasF16 = adapter.features.has('shader-f16');
  if (!hasF16) {
    return {
      supported: false,
      maxBufferGb,
      gpuName,
      reason: 'GPU does not support shader-f16 (required for the q4f16 model)'
    };
  }

  // Final gate: confirm a device can actually be acquired with the feature.
  let device: GPUDevice | null = null;
  try {
    device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
  } catch {
    return {
      supported: false,
      maxBufferGb,
      gpuName,
      reason: 'Failed to acquire a WebGPU device with shader-f16'
    };
  } finally {
    device?.destroy();
  }

  return {
    supported: true,
    maxBufferGb,
    gpuName
  };
}
