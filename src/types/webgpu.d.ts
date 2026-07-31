interface GPUAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

interface GPUAdapterLimits {
  readonly maxBufferSize: number;
  readonly maxTextureDimension1D: number;
  readonly maxTextureDimension2D: number;
  readonly maxTextureDimension3D: number;
  [key: string]: number;
}

interface GPUAdapter {
  readonly features: ReadonlySet<string>;
  readonly limits: GPUAdapterLimits;
  readonly isFallbackAdapter: boolean;
  /** Modern synchronous adapter info (replaces requestAdapterInfo). */
  readonly info?: GPUAdapterInfo;
  /** @deprecated Removed from the spec; kept only as a runtime fallback. */
  requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: Iterable<string>;
  requiredLimits?: Record<string, number>;
}

interface GPUDevice {
  destroy(): void;
}

interface GPU {
  requestAdapter(
    options?: GPURequestAdapterOptions
  ): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}

type GPUTextureFormat = string;

interface Navigator {
  readonly gpu: GPU | undefined;
}
