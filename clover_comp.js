#!/usr/bin/env node

const KEYWORKS = new Set(['let', 'fn', 'ref']);

const write = process.stdout.write.bind(process.stdout);

function main() {
  const code = require('fs').readFileSync('./clover_comp.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  readToken(state);
  readToken(state);

  const module = readModule(state);

  write('#!/usr/bin/env node\n\n');

  for (const func of module.functions) {
    write(`function __${func.name}(`);
    for (const argument of func.arguments) {
      write(`${argument.name}, `);
    }
    write(`) {\n`);
    for (const statement of func.statements) {
      writeStatement(statement);
    }
    write(`}\n\n`);
  }
  write(`function clone(v) {
  if (v == null) return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.map(a => clone(a));
  const o = {};
  for (const k in v) {
    o[k] = clone(v[k]);
  }
  return o;
}

`);
  write('__main();\n');
}

function writeStatement(statement) {
  if (statement.type === 'variable_declaration') {
    write(`  let ${statement.name} = `);
    writeExpression(statement.initialValue);
    write(';\n');
    return;
  }
  if (statement.type === 'expression') {
    write(`  `);
    writeExpression(statement.value);
    write(';\n');
    return;
  }
}

function writeExpression(expression) {
  if (expression.type === 'function_call') {
    if (expression.functionName === '__read_file') {
      write("(require('fs').readFileSync)(");
    } else {
      write(`__${expression.functionName}(`);
    }
    for (const argument of expression.arguments) {
      if (argument.type === 'expression') {
        write('clone(');
        writeExpression(argument.value);
        write(')');
      } else if (argument.type === 'reference') {
        write(argument.name);
      }
      write(', ');
    }
    if (expression.functionName === '__read_file') {
      write("'utf8'")
    }
    write(')');
    return;
  }
  if (expression.type === 'string_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.type === 'identifier') {
    write(expression.name);
    return;
  }
  if (expression.type === 'object_literal') {
    write('{');
    for (const field of expression.fields) {
      write(field.name);
      write(': ');
      writeExpression(field.value);
      write(', ');
    }
    if (expression.typeName != null) {
      write(`__type: ${JSON.stringify(expression.typeName)}`);
    }
    write('}');
  }
}

/**
 * ======== Parsing ========================================================
 */

function readModule(state) {
  const module = {functions: []};
  while (state.token.type !== 'end_of_file') {
    readModuleDeclaration(state, module);
  }
  return module;
}

function readModuleDeclaration(state, module) {
  invariant(hasKeyword(state, 'fn'));
  readToken(state);
  invariant(state.token.type === 'identifier');
  const declName = state.token.value;
  readToken(state);
  invariant(hasOperator(state, '('));
  readToken(state);

  const arguments = [];
  while (!hasOperator(state, ')')) {
    const isRef = hasKeyword(state, 'ref');
    if (isRef) {
      readToken(state);
    }
    invariant(state.token.type === 'identifier');
    const name = state.token.value;
    readToken(state);
    invariant(hasOperator(state, ':'));
    readToken(state);
    invariant(state.token.type === 'identifier');
    const typeName = state.token.value;
    readToken(state);
    if (hasOperator(state, ',')) {
      readToken(state);
    } else {
      invariant(hasOperator(state, ')'));
    }
    arguments.push({name, typeName});
  }

  readToken(state);
  invariant(hasOperator(state, '{'));
  readToken(state);
  const statements = [];
  while (!hasOperator(state, '}')) {
    statements.push(readStatement(state));
  }
  readToken(state);
  module.functions.push({name: declName, statements, arguments});
}

function readStatement(state) {
  if (hasKeyword(state, 'let')) {
    readToken(state);
    invariant(state.token.type === 'identifier');
    const name = state.token.value;
    readToken(state);
    invariant(hasOperator(state, '='));
    readToken(state);
    const initialValue = readPrimaryExpression(state);
    invariant(hasOperator(state, ';'));
    readToken(state);
    return {type: 'variable_declaration', name, initialValue};
  }
  if (state.token.type === 'identifier') {
    const value = readPrimaryExpression(state);
    invariant(hasOperator(state, ';'));
    readToken(state);
    return {type: 'expression', value};
  }
  invariant(false);
}

function readPrimaryExpression(state) {
  if (state.token.type === 'string_literal') {
    const value = state.token.value;
    readToken(state);
    return {type: 'string_literal', value};
  }

  const isQualifiedObjectLiteral =
    state.token.type === 'identifier' &&
    state.nextToken.type === 'operator' &&
    state.nextToken.value === '{';
  if (hasOperator(state, '{') || isQualifiedObjectLiteral) {
    let typeName;
    if (isQualifiedObjectLiteral) {
      typeName = state.token.value;
      readToken(state);
    }
    readToken(state);
    const fields = [];
    while (state.token.type === 'identifier') {
      const name = state.token.value;
      readToken(state);
      invariant(hasOperator(state, ':'));
      readToken(state);
      const value = readPrimaryExpression(state);
      if (hasOperator(state, ',')) {
        readToken(state);
      } else {
        invariant(hasOperator(state, '}'));
      }
      fields.push({name, value});
    }
    invariant(hasOperator(state, '}'));
    readToken(state);
    return {type: 'object_literal', typeName, fields};
  }
  invariant(state.token.type === 'identifier');
  const name = state.token.value;
  readToken(state);
  if (hasOperator(state, '(')) {
    readToken(state);
    const arguments = [readCallArgument(state)];
    invariant(hasOperator(state, ')'));
    readToken(state);
    return {type: 'function_call', functionName: name, arguments};
  }
  return {type: 'identifier', name};
}

function readCallArgument(state) {
  if (hasOperator(state, '&')) {
    readToken(state);
    invariant(state.token.type === 'identifier');
    const name = state.token.value;
    readToken(state);
    return {type: 'reference', name};
  }
  return {type: 'expression', value: readPrimaryExpression(state)};
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
  } else if (/^[(){}=;:,.&<>/*+-]$/.test(state.code[state.i])) {
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
