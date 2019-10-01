#!/bin/sh

set -e

./cli.js > dist/compiled_src.js
cp ./cli.js dist/
cp ./build.js dist/
dist/cli.js > dist/compiled_src.new.js
cp dist/compiled_src.new.js dist/compiled_src.js
dist/cli.js > dist/compiled_src.new.js
diff dist/compiled_src.js dist/compiled_src.new.js
