#!/bin/sh

set -e

./verify.sh
mkdir -p dist
./clover_comp.js > dist/clover_comp.js
cp dist/clover_comp.js ./clover_comp.js
