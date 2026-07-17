const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const processorSourcePath = path.join(
  repoRoot,
  'src/engine/workletWasm/workletWasmProcessorSource.js',
);

const cppSources = [
  path.join(repoRoot, 'cpp/dsp/wasm/WorkletWasmExports.cpp'),
  path.join(repoRoot, 'cpp/dsp/shared/DspPrimitives.cpp'),
  path.join(repoRoot, 'cpp/dsp/shared/SessionDspEngine.cpp'),
];

const REQUIRED_WASM_EXPORTS = [
  'memory',
  'wave',
  'renderStereoQuantum',
  'renderMartigliQuantum',
  'renderSymmetryQuantum',
  'bsc_quantum_frames',
  'bsc_phase_ptr',
  'bsc_out_l_ptr',
  'bsc_out_r_ptr',
  'bsc_symmetry_phases_ptr',
  'bsc_symmetry_freqs_ptr',
  'bsc_symmetry_slot_freqs_ptr',
  'bsc_symmetry_slot_sizes_ptr',
  'bsc_symmetry_rows_ptr',
  'bsc_session_out_l_ptr',
  'bsc_session_out_r_ptr',
  'bsc_session_snapshot_ptr',
  'bsc_session_clear',
  'bsc_session_add_binaural',
  'bsc_session_add_symmetry',
  'bsc_session_add_martigli',
  'bsc_session_add_martigli_binaural',
  'bsc_session_add_noise',
  'bsc_session_load',
  'bsc_session_start',
  'bsc_session_pause',
  'bsc_session_resume',
  'bsc_session_reset_breathing',
  'bsc_session_stop',
  'bsc_session_set_voice_gain',
  'bsc_session_update_binaural',
  'bsc_session_update_symmetry',
  'bsc_session_update_martigli',
  'bsc_session_update_martigli_binaural',
  'bsc_session_update_noise',
  'bsc_session_set_inhale_ratio',
  'bsc_session_render',
  'bsc_session_get_breath_snapshot',
  'bsc_session_elapsed',
];

const LINKER_EXPORTS = REQUIRED_WASM_EXPORTS.filter((name) => name !== 'memory');

function readEmbeddedWasmBytes() {
  const source = fs.readFileSync(processorSourcePath, 'utf8');
  const match = source.match(/const BSC_DSP_WASM_BASE64 =\s*\n\s*'([^']+)'/);
  if (!match) {
    throw new Error('Could not find BSC_DSP_WASM_BASE64 in processor source.');
  }
  return Buffer.from(match[1], 'base64');
}

function writeEmbeddedWasmBytes(bytes) {
  const source = fs.readFileSync(processorSourcePath, 'utf8');
  const base64 = Buffer.from(bytes).toString('base64');
  const next = source.replace(
    /const BSC_DSP_WASM_BASE64 =\s*\n\s*'[^']+';/,
    `const BSC_DSP_WASM_BASE64 =\n  '${base64}';`,
  );
  if (next === source && readEmbeddedWasmBytes().equals(bytes)) {
    return;
  }
  if (next === source) {
    throw new Error('Could not replace BSC_DSP_WASM_BASE64 in processor source.');
  }
  fs.writeFileSync(processorSourcePath, next);
}

function buildWorkletWasmBytes() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsc-worklet-wasm-'));
  const outPath = path.join(tempDir, 'bscDspCore.wasm');
  const emxx = process.env.EMXX || 'em++';
  const emCache = process.env.EM_CACHE || path.join(os.tmpdir(), 'bsc-emscripten-cache');
  const args = [
    '-std=c++17',
    '-O3',
    '-fno-exceptions',
    '-fno-rtti',
    '-I',
    path.join(repoRoot, 'cpp/dsp/shared'),
    ...cppSources,
    '-sSTANDALONE_WASM=1',
    '-sERROR_ON_UNDEFINED_SYMBOLS=0',
    '-sFILESYSTEM=0',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sINITIAL_MEMORY=131072',
    '-sSTACK_SIZE=32768',
    '-Wl,--no-entry',
    ...LINKER_EXPORTS.map((name) => `-Wl,--export=${name}`),
    '-o',
    outPath,
  ];

  try {
    const compile = spawnSync(emxx, args, {
      encoding: 'utf8',
      env: { ...process.env, EM_CACHE: emCache },
    });
    if (compile.error) {
      throw new Error(
        `${emxx} is required to build the Worklet WASM module. Install Emscripten or set EMXX. ${compile.error.message}`,
      );
    }
    if (compile.status !== 0) {
      throw new Error(
        compile.stderr || compile.stdout || `${emxx} failed with status ${compile.status}.`,
      );
    }
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const bytes = buildWorkletWasmBytes();
  writeEmbeddedWasmBytes(bytes);
  console.log(
    `Embedded ${bytes.length} bytes of C++ Worklet WASM into ${path.relative(
      repoRoot,
      processorSourcePath,
    )}.`,
  );
}

module.exports = {
  REQUIRED_WASM_EXPORTS,
  buildWorkletWasmBytes,
  readEmbeddedWasmBytes,
  writeEmbeddedWasmBytes,
};
