#!/bin/sh

set -e

./clover_comp.js > dist/utils.js
cp ./clover_comp.js dist/
dist/clover_comp.js > dist/utils2.js
diff dist/utils.js dist/utils.js
