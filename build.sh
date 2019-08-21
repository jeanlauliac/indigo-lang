#!/bin/sh

set -e

./clover_comp.js > dist/compiled_src.js
cp ./clover_comp.js dist/
dist/clover_comp.js > dist/compiled_src.new.js
cp dist/compiled_src.new.js dist/compiled_src.js
dist/clover_comp.js > dist/compiled_src.new.js
diff dist/compiled_src.js dist/compiled_src.new.js
