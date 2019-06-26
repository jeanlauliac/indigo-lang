#!/bin/sh

set -e

./clover_comp.js > dist/utils.js
cp ./clover_comp.js dist/
dist/clover_comp.js > dist/utils_new.js
cp dist/utils_new.js dist/utils.js
dist/clover_comp.js > dist/utils_new.js
diff dist/utils.js dist/utils_new.js
