#!/usr/bin/env node

const KEYWORKS = new Set(['let', 'fn', 'ref', 'while', 'true',
  'false', 'set', 'dict', 'vec', 'if', 'else', 'is', 'isnt', 'return']);

const write = process.stdout.write.bind(process.stdout);

function main() {
  const code = require('fs').readFileSync('./utils.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  readToken(state);
  readToken(state);

  const module = readModule(state);

  write('#!/usr/bin/env node\n\n');

  for (const func of module.functions) {
    write(`module.exports.${func.name} = function __${func.name}(`);
    for (const argument of func.arguments) {
      write(`${argument.name}, `);
    }
    write(`) {\n`);
    for (const statement of func.statements) {
      write('  ');
      writeStatement(statement, '  ');
      write('\n');
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

function access(collection, key) {
  if (typeof collection === 'string') {
    if (key < 0 || key >= collection.length) throw new Error('out of bounds');
    return collection[key];
  }
  if (collection instanceof Set) return collection.has(key);
  throw new Error('invalid collection');
}

`);
}

function writeStatement(statement, indent) {
  if (statement.type === 'variable_declaration') {
    write(`let ${statement.name} = `);
    writeExpression(statement.initialValue);
    write(';');
    return;
  }
  if (statement.type === 'expression') {
    writeExpression(statement.value);
    write(';');
    return;
  }
  if (statement.type === 'while_loop') {
    write(`while (`);
    writeExpression(statement.condition);
    write(') ');
    writeStatement(statement.body, indent);
    return;
  }
  if (statement.type === 'if') {
    write(`if (`);
    writeExpression(statement.condition);
    write(') ');
    writeStatement(statement.consequent, indent);
    if (statement.alternate) {
      write(' else ');
      writeStatement(statement.alternate, indent);
    }
    return;
  }
  if (statement.type === 'block') {
    write('{\n');
    for (const subStatement of statement.statements) {
      write(indent + '  ');
      writeStatement(subStatement, indent + '  ');
      write('\n');
    }
    write(`${indent}}`);
    return;
  }
  if (statement.type === 'return') {
    write('return ');
    writeExpression(statement.value);
    write(';');
    return;
  }
  write(`UNKNOWN_STATEMENT_${statement.type};`);
}

function writeExpression(expression) {
  if (expression.type === 'function_call') {
    if (expression.functionName[0] === '__read_file') {
      write("(require('fs').readFileSync)(");
    } else if (expression.functionName[0] === '__write') {
      write("process.stdout.write(");
    } else {
      write(`__${expression.functionName.join('.')}(`);
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
  if (expression.type === 'bool_literal') {
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
      write(`__type: ${JSON.stringify(expression.typeName.join('.'))}`);
    }
    write('}');
    return;
  }
  if (expression.type === 'binary_operation') {
    write('(');
    writeExpression(expression.leftOperand);
    let {operation} = expression;
    if (operation === '==') operation = '===';
    write(` ${operation} `);
    writeExpression(expression.rightOperand);
    write(')');
    return;
  }
  if (expression.type === 'qualified_name') {
    write(expression.value.join('.'));
    return;
  }
  if (expression.type === 'collection_literal') {
    if (expression.dataType === 'set') {
      write('new Set([');
    }
    if (expression.dataType === 'vec') {
      write('[');
    }
    for (const value of expression.values) {
      writeExpression(value);
      write(', ');
    }
    write(']');
    if (expression.dataType === 'set') {
      write(')');
    }
    return;
  }
  if (expression.type === 'character_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.type === 'collection_access') {
    write(`access(${expression.collectionName.join('.')}, `);
    writeExpression(expression.key);
    write(')');
    return;
  }
  if (expression.type === 'in_place_assignment') {
    if (expression.isPrefix) {
      write(expression.operator);
    }
    writeExpression(expression.target);
    if (!expression.isPrefix) {
      write(expression.operator);
    }
    return;
  }
  write(`UNKNOWN_EXPRESSION_${expression.type}`);
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
    const initialValue = readExpression(state);
    invariant(hasOperator(state, ';'));
    readToken(state);
    return {type: 'variable_declaration', name, initialValue};
  }

  if (hasKeyword(state, 'while')) {
    readToken(state);
    invariant(hasOperator(state, '('));
    readToken(state);
    const condition = readExpression(state);
    invariant(hasOperator(state, ')'));
    readToken(state);
    const body = readStatement(state);
    return {type: 'while_loop', condition, body};
  }

  if (hasKeyword(state, 'if')) {
    readToken(state);
    invariant(hasOperator(state, '('));
    readToken(state);
    const condition = readExpression(state);
    invariant(hasOperator(state, ')'));
    readToken(state);
    const consequent = readStatement(state);
    let alternate;
    if (hasKeyword(state, 'else')) {
      readToken(state);
      alternate = readStatement(state);
    }
    return {type: 'if', condition, consequent, alternate};
  }

  if (hasKeyword(state, 'return')) {
    readToken(state);
    const value = readExpression(state);
    invariant(hasOperator(state, ';'));
    readToken(state);
    return {type: 'return', value};
  }

  if (hasOperator(state, '{')) {
    readToken(state);
    const statements = [];
    while (!hasOperator(state, '}')) {
      statements.push(readStatement(state));
    }
    readToken(state);
    return {type: 'block', statements};
  }

  const value = readExpression(state);
  invariant(hasOperator(state, ';'));
  readToken(state);
  return {type: 'expression', value};
}

function readExpression(state) {
  return readAssignmentExpression(state);
}

function readAssignmentExpression(state) {
  const leftOperand = readLogicalAndExpression(state);
  if (!hasOperator(state, '=')) return leftOperand;
  readToken(state);
  const rightOperand = readEqualityExpression(state);
  return {type: 'binary_operation', operation: '=', leftOperand, rightOperand};
}

function readLogicalAndExpression(state) {
  const leftOperand = readEqualityExpression(state);
  if (!hasOperator(state, '&&')) return leftOperand;
  readToken(state);
  const rightOperand = readEqualityExpression(state);
  return {type: 'binary_operation', operation: '&&', leftOperand, rightOperand};
}

function readEqualityExpression(state) {
  const leftOperand = readComparisonExpression(state);
  if (!hasOperator(state, '==') && !hasKeyword(state, 'isnt')) return leftOperand;
  const operation = state.token.value;
  readToken(state);
  const rightOperand = readComparisonExpression(state);
  return {type: 'binary_operation', operation, leftOperand, rightOperand};
}

function readComparisonExpression(state) {
  const leftOperand = readPrimaryExpression(state);
  if (!hasOperator(state, '<')) return leftOperand;
  readToken(state);
  const rightOperand = readPrimaryExpression(state);
  return {type: 'binary_operation', operation: '<', leftOperand, rightOperand};
}

function readPrimaryExpression(state) {
  if (state.token.type === 'string_literal') {
    const value = state.token.value;
    readToken(state);
    return {type: 'string_literal', value};
  }
  if (state.token.type === 'character_literal') {
    const value = state.token.value;
    readToken(state);
    return {type: 'character_literal', value};
  }
  if (hasKeyword(state, 'true')) {
    readToken(state);
    return {type: 'bool_literal', value: true};
  }
  if (hasKeyword(state, 'false')) {
    readToken(state);
    return {type: 'bool_literal', value: false};
  }

  if (hasOperator(state, '++')) {
    const operator = state.token.value;
    readToken(state);
    const target = readPrimaryExpression(state);
    return {type: 'in_place_assignment', operator, target, isPrefix: true};
  }

  if (hasKeyword(state, 'set') || hasKeyword(state, 'vec')) {
    const dataType = state.token.value;
    readToken(state);
    invariant(hasOperator(state, '['));
    readToken(state);
    const values = [];
    while (!hasOperator(state, ']')) {
      const expression = readExpression(state);
      values.push(expression);
      if (hasOperator(state, ',')) {
        readToken(state);
      } else {
        invariant(hasOperator(state, ']'));
      }
    }
    readToken(state);
    return {type: 'collection_literal', dataType, values};
  }

  const qualifiedName = [];
  if (state.token.type === 'identifier') {
    qualifiedName.push(state.token.value);
    readToken(state);
    while (hasOperator(state, '.')) {
      readToken(state);
      invariant(state.token.type === 'identifier');
      qualifiedName.push(state.token.value);
      readToken(state);
    }
  }

  if (hasOperator(state, '[')) {
    readToken(state);
    const key = readExpression(state);
    invariant(hasOperator(state, ']'));
    readToken(state);
    return {type: 'collection_access', collectionName: qualifiedName, key};
  }

  if (hasOperator(state, '{')) {
    readToken(state);
    const fields = [];
    while (state.token.type === 'identifier') {
      const name = state.token.value;
      readToken(state);
      invariant(hasOperator(state, ':'));
      readToken(state);
      const value = readExpression(state);
      if (hasOperator(state, ',')) {
        readToken(state);
      } else {
        invariant(hasOperator(state, '}'));
      }
      fields.push({name, value});
    }
    invariant(hasOperator(state, '}'));
    readToken(state);
    return {type: 'object_literal', typeName: qualifiedName, fields};
  }
  invariant(qualifiedName.length > 0);

  if (hasOperator(state, '(')) {
    readToken(state);
    const arguments = [];
    while (!hasOperator(state, ')')) {
      arguments.push(readCallArgument(state));
      if (hasOperator(state, ',')) {
        readToken(state);
      } else {
        invariant(hasOperator(state, ')'));
      }
    }
    readToken(state);
    return {type: 'function_call', functionName: qualifiedName, arguments};
  }
  return {type: 'qualified_name', value: qualifiedName};
}

function readCallArgument(state) {
  if (hasOperator(state, '&')) {
    readToken(state);
    invariant(state.token.type === 'identifier');
    const name = state.token.value;
    readToken(state);
    return {type: 'reference', name};
  }
  return {type: 'expression', value: readExpression(state)};
}

function hasOperator(state, value) {
  return state.token.type === 'operator' && state.token.value === value;
}

function hasKeyword(state, value) {
  return state.token.type === 'keyword' && state.token.value === value;
}

const OPERATORS = new Set(['&&', '++', '==']);

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
  } else if (/^[(){}=;:,.&<>/*+-\[\]]$/.test(state.code[state.i])) {
    let value = state.code[state.i];
    ++state.i;
    if (OPERATORS.has(value + state.code[state.i])) {
      value += state.code[state.i];
      ++state.i;
    }
    token = {type: 'operator', value};
  } else if (state.code[state.i] === '"') {
    ++state.i;
    const start = state.i;
    while (state.i < state.code.length && state.code[state.i] !== '"') {
      ++state.i;
    }
    invariant(state.i < state.code.length);
    token = {type: 'string_literal', value: state.code.substring(start, state.i)};
    ++state.i;
  } else if (state.code[state.i] === "'") {
    ++state.i;
    invariant(state.i < state.code.length);
    let value;
    if (state.code[state.i] === '\\') {
      ++state.i;
      invariant(state.i < state.code.length);
      value = getEscapedChar(state.code[state.i]);
    } else {
      value = state.code[state.i];
    }
    ++state.i;
    invariant(state.i < state.code.length && state.code[state.i] === "'");
    token = {type: 'character_literal', value};
    ++state.i;
  } else {
    throw new Error(`unexpected character "${state.code[state.i]}"`);
  }
  state.token = state.nextToken;
  state.nextToken = token;
}

function getEscapedChar(code) {
  switch (code) {
    case 'n':
      return '\n';
  }
  invariant(false);
}

function invariant(cond) {
  if (!cond) throw new Error('invariant failed');
}

main();
