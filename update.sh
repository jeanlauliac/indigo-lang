#!/bin/sh

set -e

./build.sh
cp dist/utils.js ./utils.js
