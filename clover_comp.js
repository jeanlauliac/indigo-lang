#!/usr/bin/env node


function main() {
  console.log('#!/usr/bin/env node\n');
  const template = require('fs').readFileSync('./clover_comp.tpl', 'utf8');
  console.log(template);

  const code = require('fs').readFileSync('./clover_comp.clv', 'utf8');
  const state = {code, i: 0, phase: 'module', module: {functions: []}};
  let curFunc;

  while (state.i < code.length) {
    while (/^[ \n]$/.test(state.code[state.i])) {
      ++state.i;
    }
    let token;
    if (/[_a-zA-Z]/.test(state.code[state.i])) {
      token = {type: 'identifier', value: state.code[state.i]};
      ++state.i;
      while (state.i < state.code.length && /[_a-zA-Z0-9]/.test(state.code[state.i])) {
        token.value += state.code[state.i];
        ++state.i;
      }
    } else if (/[(){}]/.test(state.code[state.i])) {
      token = {type: 'operator', value: state.code[state.i]};
      ++state.i;
    } else {
      throw new Error(`unexpected character "${state.code[state.i]}"`);
    }

    const curPhase = state.phase;
    switch (state.phase) {
      case 'module':
        if (token.type === 'identifier') {
          curFunc = {returnType: token.value, name: null};
          state.phase = 'function_name';
        }
        break;
      case 'function_name':
        if (token.type === 'identifier') {
          curFunc.name = token.value;
          state.phase = 'function_argument_list';
        }
        break;
      case 'function_argument_list':
        if (token.type === 'operator' && token.value === '(') {
          state.phase = 'function_argument';
        }
        break;
      case 'function_argument':
        if (token.type === 'operator' && token.value === ')') {
          state.phase = 'function_scope';
        }
        break;
      case 'function_scope':
        if (token.type === 'operator' && token.value === '{') {
          state.phase = 'function_statement';
        }
        break;
      case 'function_statement':
        if (token.type === 'operator' && token.value === '}') {
          state.phase = 'module';
        }
        break;
      default:
        throw new Error(`wrong phase "${state.phase}"`);
    }
    if (curPhase === state.phase) {
      throw new Error(`phase did not change: "${curPhase}"`);
    }
  }
}

main();

