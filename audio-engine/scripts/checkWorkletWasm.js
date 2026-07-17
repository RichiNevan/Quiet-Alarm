const {
  REQUIRED_WASM_EXPORTS,
  buildWorkletWasmBytes,
  readEmbeddedWasmBytes,
} = require('./buildWorkletWasm');

const readWasmExports = async (bytes) => {
  const mod = await WebAssembly.compile(bytes);
  return {
    exports: WebAssembly.Module.exports(mod)
      .map((entry) => entry.name)
      .sort(),
    imports: WebAssembly.Module.imports(mod),
  };
};

const assertRequiredExports = (wasmExports) => {
  const missing = REQUIRED_WASM_EXPORTS.filter((name) => !wasmExports.includes(name));
  if (missing.length) {
    throw new Error(
      [
        'WASM export drift detected.',
        missing.length ? `Missing from embedded WASM: ${missing.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
};

const ALLOWED_IMPORTS = new Set([
  'wasi_snapshot_preview1.fd_close',
  'wasi_snapshot_preview1.fd_seek',
  'wasi_snapshot_preview1.fd_write',
]);

const assertAllowedImports = (imports) => {
  const unexpected = imports.filter(
    (entry) => !ALLOWED_IMPORTS.has(`${entry.module}.${entry.name}`),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected Worklet WASM imports found: ${unexpected
        .map((entry) => `${entry.module}.${entry.name}`)
        .join(', ')}`,
    );
  }
};

const assertSameBytes = (embeddedBytes, compiledBytes) => {
  if (!compiledBytes.equals(embeddedBytes)) {
    throw new Error(
      'Embedded BSC_DSP_WASM_BASE64 does not match cpp/dsp/wasm/WorkletWasmExports.cpp. Run npm run wasm:build.',
    );
  }
};

(async () => {
  const embeddedBytes = readEmbeddedWasmBytes();
  const compiledBytes = buildWorkletWasmBytes();
  const embedded = await readWasmExports(embeddedBytes);
  assertRequiredExports(embedded.exports);
  assertAllowedImports(embedded.imports);
  assertSameBytes(embeddedBytes, compiledBytes);
  console.log('Worklet/WASM C++ source check passed.');
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
