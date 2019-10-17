#!/bin/sh

set -e

ln -sf ../cli.js dist/cli.js
ln -sf ../build.js dist/build.js
ln -sfh ../src_js dist/src_js

./cli.js > dist/compiled_src.js

dist/cli.js > dist/compiled_src.new.js
cp dist/compiled_src.new.js dist/compiled_src.js

dist/cli.js > dist/compiled_src.new.js
diff dist/compiled_src.js dist/compiled_src.new.js
