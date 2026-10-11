#!/bin/bash
# usage: score.sh <label> [compile flags]  -> builds & scores both frames
S=/tmp/claude-0/-home-claude/309d2129-50ce-52ed-9675-fe92d01d8525/scratchpad
L=$1; shift
cd $S
$S/tools/build.sh $S/work jilislot-global-v-2 v2_$L "$@" && python3 -I tools/render.py r/v2_$L.json work/output/jilislot-global-v-2 r/v2_$L --widths 1440,1024,390 | sed 's/^/[v2] /'
$S/tools/build.sh $S/work jilislot-global v1_$L "$@" && python3 -I tools/render.py r/v1_$L.json work/output/jilislot-global r/v1_$L --widths 1440,1024,390 | sed 's/^/[v1] /'
