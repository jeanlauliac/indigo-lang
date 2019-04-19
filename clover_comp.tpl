console.log('#!/usr/bin/env node\n');
const content = require('fs').readFileSync('./clover_comp.tpl', 'utf8');
console.log(content);
