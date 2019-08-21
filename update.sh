#!/bin/sh

set -e

./build.sh
cp dist/compiled_src.js ./compiled_src.js
