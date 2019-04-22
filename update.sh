#!/bin/sh

set -e

./clover_comp.js > dist/utils.js
cp dist/utils.js ./utils.js
./clover_comp.js > dist/utils.js
diff ./utils.js dist/utils.js
