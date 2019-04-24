#!/usr/bin/env node

const utils = require('./utils');
const {has_keyword, has_operator, get_escaped_char, invariant, has_identifier} = utils;

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

  write('// GENERATED, DO NOT EDIT\n\n');

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

function identity_test(value, type) {
  return value.__type === type;
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
    if (expression.functionName[0] === '__has') {
      write('(');
      writeExpression(expression.arguments[0].value);
      write('.has(');
      writeExpression(expression.arguments[1].value);
      write('))');
      return;
    }
    if (expression.functionName[0] === '__read_file') {
      write("(require('fs').readFileSync)(");
    } else if (expression.functionName[0] === '__write') {
      write("process.stdout.write(");
    } else if (expression.functionName[0] === '__die') {
      write("throw new Error(");
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
  if (expression.type === 'identity_test') {
    if (expression.isNegative) {
      write('!');
    }
    write(`identity_test(`);
    writeExpression(expression.operand);
    write(', ');
    write(JSON.stringify(expression.typeName.join('.')));
    write(')');
    return;
  }
  if (expression.type === 'unary_operation') {
    write(expression.operator);
    writeExpression(expression.operand);
    return;
  }
  write(`UNKNOWN_EXPRESSION_${expression.type}`);
}

/**
 * ======== Parsing ========================================================
 */

function readModule(state) {
  const module = {functions: []};
  while (state.token.__type !== 'End_of_file') {
    readModuleDeclaration(state, module);
  }
  return module;
}

function readModuleDeclaration(state, module) {
  invariant(has_keyword(state, 'fn'));
  readToken(state);
  invariant(has_identifier(state));
  const declName = state.token.value;
  readToken(state);
  invariant(has_operator(state, '('));
  readToken(state);

  const arguments = [];
  while (!has_operator(state, ')')) {
    const isRef = has_keyword(state, 'ref');
    if (isRef) {
      readToken(state);
    }
    invariant(has_identifier(state));
    const name = state.token.value;
    readToken(state);
    invariant(has_operator(state, ':'));
    readToken(state);
    invariant(has_identifier(state));
    const typeName = state.token.value;
    readToken(state);
    if (has_operator(state, ',')) {
      readToken(state);
    } else {
      invariant(has_operator(state, ')'));
    }
    arguments.push({name, typeName});
  }

  readToken(state);
  invariant(has_operator(state, '{'));
  readToken(state);
  const statements = [];
  while (!has_operator(state, '}')) {
    statements.push(readStatement(state));
  }
  readToken(state);
  module.functions.push({name: declName, statements, arguments});
}

function readStatement(state) {
  if (has_keyword(state, 'let')) {
    readToken(state);
    invariant(has_identifier(state));
    const name = state.token.value;
    readToken(state);
    invariant(has_operator(state, '='));
    readToken(state);
    const initialValue = readExpression(state);
    invariant(has_operator(state, ';'));
    readToken(state);
    return {type: 'variable_declaration', name, initialValue};
  }

  if (has_keyword(state, 'while')) {
    readToken(state);
    invariant(has_operator(state, '('));
    readToken(state);
    const condition = readExpression(state);
    invariant(has_operator(state, ')'));
    readToken(state);
    const body = readStatement(state);
    return {type: 'while_loop', condition, body};
  }

  if (has_keyword(state, 'if')) {
    readToken(state);
    invariant(has_operator(state, '('));
    readToken(state);
    const condition = readExpression(state);
    invariant(has_operator(state, ')'));
    readToken(state);
    const consequent = readStatement(state);
    let alternate;
    if (has_keyword(state, 'else')) {
      readToken(state);
      alternate = readStatement(state);
    }
    return {type: 'if', condition, consequent, alternate};
  }

  if (has_keyword(state, 'return')) {
    readToken(state);
    const value = readExpression(state);
    invariant(has_operator(state, ';'));
    readToken(state);
    return {type: 'return', value};
  }

  if (has_operator(state, '{')) {
    readToken(state);
    const statements = [];
    while (!has_operator(state, '}')) {
      statements.push(readStatement(state));
    }
    readToken(state);
    return {type: 'block', statements};
  }

  const value = readExpression(state);
  invariant(has_operator(state, ';'));
  readToken(state);
  return {type: 'expression', value};
}

function readExpression(state) {
  return readAssignmentExpression(state);
}

function readAssignmentExpression(state) {
  const leftOperand = readLogicalAndExpression(state);
  if (!has_operator(state, '=')) return leftOperand;
  readToken(state);
  const rightOperand = readLogicalAndExpression(state);
  return {type: 'binary_operation', operation: '=', leftOperand, rightOperand};
}

function readLogicalAndExpression(state) {
  const leftOperand = readIdentityExpression(state);
  if (!has_operator(state, '&&')) return leftOperand;
  readToken(state);
  const rightOperand = readIdentityExpression(state);
  return {type: 'binary_operation', operation: '&&', leftOperand, rightOperand};
}

function readIdentityExpression(state) {
  const operand = readEqualityExpression(state);
  if (
    !has_keyword(state, 'isnt') &&
    !has_keyword(state, 'is')
  ) return operand;
  const isNegative = state.token.value === 'isnt';
  readToken(state);
  const typeName = readQualifiedName(state);
  return {type: 'identity_test', isNegative, operand, typeName};
}

function readEqualityExpression(state) {
  const leftOperand = readComparisonExpression(state);
  if (!has_operator(state, '==')) return leftOperand;
  const operation = state.token.value;
  readToken(state);
  const rightOperand = readComparisonExpression(state);
  return {type: 'binary_operation', operation, leftOperand, rightOperand};
}

function readComparisonExpression(state) {
  const leftOperand = readPrimaryExpression(state);
  if (!has_operator(state, '<')) return leftOperand;
  readToken(state);
  const rightOperand = readPrimaryExpression(state);
  return {type: 'binary_operation', operation: '<', leftOperand, rightOperand};
}

function readPrimaryExpression(state) {
  if (state.token.__type === 'String_literal') {
    const value = state.token.value;
    readToken(state);
    return {type: 'string_literal', value};
  }
  if (state.token.__type === 'Character_literal') {
    const value = state.token.value;
    readToken(state);
    return {type: 'character_literal', value};
  }
  if (has_keyword(state, 'true')) {
    readToken(state);
    return {type: 'bool_literal', value: true};
  }
  if (has_keyword(state, 'false')) {
    readToken(state);
    return {type: 'bool_literal', value: false};
  }

  if (has_operator(state, '++')) {
    const operator = state.token.value;
    readToken(state);
    const target = readPrimaryExpression(state);
    return {type: 'in_place_assignment', operator, target, isPrefix: true};
  }

  if (has_operator(state, '!')) {
    const operator = state.token.value;
    readToken(state);
    const operand = readPrimaryExpression(state);
    return {type: 'unary_operation', operator, operand};
  }

  if (has_keyword(state, 'set') || has_keyword(state, 'vec')) {
    const dataType = state.token.value;
    readToken(state);
    invariant(has_operator(state, '['));
    readToken(state);
    const values = [];
    while (!has_operator(state, ']')) {
      const expression = readExpression(state);
      values.push(expression);
      if (has_operator(state, ',')) {
        readToken(state);
      } else {
        invariant(has_operator(state, ']'));
      }
    }
    readToken(state);
    return {type: 'collection_literal', dataType, values};
  }

  let qualifiedName;
  if (has_identifier(state)) {
    qualifiedName = readQualifiedName(state);
  }

  if (has_operator(state, '[')) {
    readToken(state);
    const key = readExpression(state);
    invariant(has_operator(state, ']'));
    readToken(state);
    return {type: 'collection_access', collectionName: qualifiedName, key};
  }

  if (has_operator(state, '{')) {
    readToken(state);
    const fields = [];
    while (has_identifier(state)) {
      const name = state.token.value;
      readToken(state);
      invariant(has_operator(state, ':'));
      readToken(state);
      const value = readExpression(state);
      if (has_operator(state, ',')) {
        readToken(state);
      } else {
        invariant(has_operator(state, '}'));
      }
      fields.push({name, value});
    }
    invariant(has_operator(state, '}'));
    readToken(state);
    return {type: 'object_literal', typeName: qualifiedName, fields};
  }
  invariant(qualifiedName != null);

  if (has_operator(state, '(')) {
    readToken(state);
    const arguments = [];
    while (!has_operator(state, ')')) {
      arguments.push(readCallArgument(state));
      if (has_operator(state, ',')) {
        readToken(state);
      } else {
        invariant(has_operator(state, ')'));
      }
    }
    readToken(state);
    return {type: 'function_call', functionName: qualifiedName, arguments};
  }
  return {type: 'qualified_name', value: qualifiedName};
}

function readQualifiedName(state) {
  invariant(has_identifier(state));
  const qualifiedName = [state.token.value];
  readToken(state);
  while (has_operator(state, '.')) {
    readToken(state);
    invariant(has_identifier(state));
    qualifiedName.push(state.token.value);
    readToken(state);
  }
  return qualifiedName;
}

function readCallArgument(state) {
  if (has_operator(state, '&')) {
    readToken(state);
    invariant(has_identifier(state));
    const name = state.token.value;
    readToken(state);
    return {type: 'reference', name};
  }
  return {type: 'expression', value: readExpression(state)};
}

const OPERATORS = new Set(['&&', '++', '==']);

function readToken(state) {
  utils.read_whitespace(state);
  state.token = state.nextToken;
  state.nextToken = read_next_token(state);
}

function read_next_token(state) {
  if (state.i === state.code.length) {
    return {__type: 'End_of_file'};
  }
  if (/^[_a-zA-Z]$/.test(state.code[state.i])) {
    return read_identifier(state);
  }
  if (/^[(){}=;:,.&<>/*+\[\]!-]$/.test(state.code[state.i])) {
    return read_operator(state);
  }
  if (state.code[state.i] === '"') {
    return read_string_literal(state);
  }
  if (state.code[state.i] === "'") {
    return read_character_literal(state);
  }
  throw new Error(`unexpected character "${state.code[state.i]}"`);
}

function read_identifier(state) {
  const token = {__type: 'Identifier', value: state.code[state.i]};
  ++state.i;
  while (state.i < state.code.length && /^[_a-zA-Z0-9]$/.test(state.code[state.i])) {
    token.value += state.code[state.i];
    ++state.i;
  }
  if (KEYWORKS.has(token.value)) {
    token.__type = 'Keyword';
  }
  return token;
}

function read_operator(state) {
  let value = state.code[state.i];
  ++state.i;
  if (OPERATORS.has(value + state.code[state.i])) {
    value += state.code[state.i];
    ++state.i;
  }
  return {__type: 'Operator', value};
}

function read_string_literal(state) {
  ++state.i;
  const start = state.i;
  while (state.i < state.code.length && state.code[state.i] !== '"') {
    ++state.i;
  }
  invariant(state.i < state.code.length);
  const token = {__type: 'String_literal', value: state.code.substring(start, state.i)};
  ++state.i;
  return token;
}

function read_character_literal(state) {
  ++state.i;
  invariant(state.i < state.code.length);
  let value;
  if (state.code[state.i] === '\\') {
    ++state.i;
    invariant(state.i < state.code.length);
    value = get_escaped_char(state.code[state.i]);
  } else {
    value = state.code[state.i];
  }
  ++state.i;
  invariant(state.i < state.code.length && state.code[state.i] === "'");
  const token = {__type: 'Character_literal', value};
  ++state.i;
  return token;
}

main();
