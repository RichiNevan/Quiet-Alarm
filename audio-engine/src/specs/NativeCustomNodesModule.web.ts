// Dummy implementation for web - native modules not available
export interface Spec {
  injectCustomProcessorInstaller(): void;
}

const NativeCustomNodesModule: Spec = {
  injectCustomProcessorInstaller(): void {
    // No-op on web - native custom nodes not available
    console.warn(
      'NativeCustomNodesModule.injectCustomProcessorInstaller is not available on web'
    );
  },
};

export default NativeCustomNodesModule;
