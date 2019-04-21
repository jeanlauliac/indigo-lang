#!/usr/bin/env node

const KEYWORKS = new Set(['let']);

function main() {
  const code = require('fs').readFileSync('./clover_comp.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  readToken(state);
  readToken(state);

  const module = readModule(state);

  console.log('#!/usr/bin/env node\n');
  for (const func of module.functions) {
    console.log(`function __${func.name}() {`);
    console.log(`}\n`);
  }
  console.log('__main();');
}

function readModule(state) {
  const module = {functions: []};
  while (state.token.type === 'identifier') {
    readModuleDeclaration(state, module);
  }
  return module;
}

function readModuleDeclaration(state, module) {
  const declType = state.token.value;
  readToken(state);
  invariant(state.token.type === 'identifier');
  const declName = state.token.value;
  readToken(state);
  invariant(hasOperator(state, '('));
  readToken(state);
  invariant(hasOperator(state, ')'));
  readToken(state);
  invariant(hasOperator(state, '{'));
  readToken(state);
  const statements = [];
  while (!hasOperator(state, '}')) {
    statements.push(readStatement(state));
  }
  module.functions.push({returnType: declType, name: declName, statements});
}

function readStatement(state) {
  invariant(hasKeyword(state, 'let'));
  readToken(state);
  invariant(state.token.type === 'identifier');
  const name = state.token.value;
  readToken(state);
  invariant(hasOperator(state, '='));
  readToken(state);
  const initialValue = readPrimaryExpression(state);
  invariant(hasOperator(state, ';'));
  readToken(state);
  return {type: 'variable_declaration', name, initialValue}
}

function readPrimaryExpression(state) {
  if (state.token.type === 'string_literal') {
    readToken(state);
    return {type: 'string_literal', value: state.token.value};
  }
  invariant(state.token.type === 'identifier');
  const name = state.token.value;
  readToken(state);
  invariant(hasOperator(state, '('));
  readToken(state);
  const arguments = [readPrimaryExpression(state)];
  invariant(hasOperator(state, ')'));
  readToken(state);
  return {type: 'function_call', functionName: name, arguments};
}

function hasOperator(state, value) {
  return state.token.type === 'operator' && state.token.value === value;
}

function hasKeyword(state, value) {
  return state.token.type === 'keyword' && state.token.value === value;
}

function readToken(state) {
  while (state.i < state.code.length && /^[ \n]$/.test(state.code[state.i])) {
    ++state.i;
  }
  let token;
  if (state.i === state.code.length) {
    token = {type: 'end_of_file'};
  } else if (/^[_a-zA-Z]$/.test(state.code[state.i])) {
    token = {type: 'identifier', value: state.code[state.i]};
    ++state.i;
    while (state.i < state.code.length && /^[_a-zA-Z0-9]$/.test(state.code[state.i])) {
      token.value += state.code[state.i];
      ++state.i;
    }
    if (KEYWORKS.has(token.value)) {
      token.type = 'keyword';
    }
  } else if (/^[(){}=;]$/.test(state.code[state.i])) {
    token = {type: 'operator', value: state.code[state.i]};
    ++state.i;
  } else if (state.code[state.i] === '"') {
    ++state.i;
    const start = state.i;
    while (state.i < state.code.length && state.code[state.i] !== '"') {
      ++state.i;
    }
    invariant(state.i < state.code.length);
    token = {type: 'string_literal', value: state.code.substring(start, state.i)};
    ++state.i;
  } else {
    throw new Error(`unexpected character "${state.code[state.i]}"`);
  }
  state.token = state.nextToken;
  state.nextToken = token;
}

function invariant(cond) {
  if (!cond) throw new Error('invariant failed');
}

main();
