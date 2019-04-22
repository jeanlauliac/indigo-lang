#!/bin/sh

set -e

./build.sh
cp dist/utils.js ./utils.js
./build.sh
diff ./utils.js dist/utils.js
