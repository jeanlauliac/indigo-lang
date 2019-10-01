#!/usr/bin/env node

const build = require('./build');
const fs = require('fs');
const path = require('path');

function main() {
  let filesystem = new Map();
  const write = process.stdout.write.bind(process.stdout);

  if (process.argv[2] === '-i') {
    fileTree = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const key of Object.keys(fileTree)) {
      const code = fileTree[key];
      filesystem.set(key, code);
    }
    build(filesystem, write, true);
    return;
  }

  const all_files = fs.readdirSync('./src');
  for (const file_name of all_files) {
    const code = fs.readFileSync(`./src/${file_name}`, 'utf8');
    filesystem.set(file_name, code);
  }
  build(filesystem, write, false);
}

main();
