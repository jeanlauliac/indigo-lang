#!/bin/sh

set -e

mkdir -p dist
./clover_comp.js > dist/clover_comp.js
node dist/clover_comp.js > dist/clover_comp2.js
diff dist/clover_comp.js dist/clover_comp2.js
