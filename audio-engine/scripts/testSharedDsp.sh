#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${TMPDIR:-/tmp}/biosyncare-shared-dsp"
BIN="$OUT_DIR/shared_dsp_tests"

mkdir -p "$OUT_DIR"

c++ -std=c++17 -Wall -Wextra -Werror \
  -I"$ROOT_DIR/cpp/dsp/shared" \
  "$ROOT_DIR/cpp/dsp/shared/DspPrimitives.cpp" \
  "$ROOT_DIR/cpp/dsp/shared/SessionDspEngine.cpp" \
  "$ROOT_DIR/cpp/dsp/tests/shared_dsp_tests.cpp" \
  -o "$BIN"

"$BIN"
