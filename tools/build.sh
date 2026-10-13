#!/bin/bash
# usage: build.sh <workdir> <frame-name> <label> [compile flags...]   -> r/<label>.json (merged tree)
set -euo pipefail
W=$1; F=$2; L=$3; shift 3
cd "$W"
OUT="output/$F"
mkdir -p "r/logs/$L"
names=$(node --input-type=module - "$OUT" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const names = JSON.parse(fs.readFileSync(path.join(dir, 'sections.json')));
const figma = JSON.parse(fs.readFileSync(path.join(dir, 'figma-node.json')));
const sorted = [...(figma.children || [])].filter(n => n.visible !== false && n.absoluteBoundingBox)
 .sort((a,b) => a.absoluteBoundingBox.y-b.absoluteBoundingBox.y || a.absoluteBoundingBox.x-b.absoluteBoundingBox.x);
console.log(sorted.map(n => names[n.id]).filter(n => n && fs.existsSync(path.join(dir,'sections',n,'normalized.json'))).join('\n'));
NODE
)
mapfile -t sections <<< "$names"
for s in "${sections[@]}"; do node scripts/3_compile_bricks.js "$OUT/sections/$s" "$@" > "r/logs/$L/build_$s.log" 2>&1; done
node scripts/merge_sections.js "$OUT" "${sections[@]}" > "r/logs/$L/merge.log" 2>&1
cp "$OUT/merged/bricks-tree.json" "r/$L.json"
