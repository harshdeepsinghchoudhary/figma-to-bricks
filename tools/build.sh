#!/bin/bash
# usage: build.sh <workdir> <frame-name> <label> [compile flags...]   -> r/<label>.json (merged tree)
W=$1; F=$2; L=$3; shift 3
cd "$W" || exit 1
OUT=output/$F
names=$(python3 -I -c "
import json,os
n=json.load(open('$OUT/sections.json')); 
print(' '.join(v for v in n.values() if os.path.exists('$OUT/sections/%s/normalized.json'%v)))")
for s in $names; do node scripts/3_compile_bricks.js $OUT/sections/$s "$@" > /tmp/claude-0/build_$s.log 2>&1 || echo "COMPILE FAIL $s"; done
node scripts/merge_sections.js $OUT $names > /tmp/claude-0/merge.log 2>&1 || echo "MERGE FAIL"
cp $OUT/merged/bricks-tree.json ../r/$L.json
