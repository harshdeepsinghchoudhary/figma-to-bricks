#!/bin/bash
# usage: score.sh <label> [compile flags]  -> builds & scores both frames
set -euo pipefail
S=$(cd "$(dirname "$0")/.." && pwd)
L=$1; shift
cd "$S"
for F in jilislot-global-v-2 jilislot-global; do
  [ -f "output/$F/figma-node.json" ] || continue
  bash tools/build.sh "$S" "$F" "${F}_$L" "$@"
  python3 -I tools/render.py "r/${F}_$L.json" "output/$F" "r/${F}_$L" --widths 1440,1024,390
done
