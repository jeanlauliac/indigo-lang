#!/usr/bin/env node

const utils = require('./utils');
const {has_keyword, has_operator, get_escaped_char,
  invariant, has_identifier, read_token} = utils;

const write = process.stdout.write.bind(process.stdout);

function main() {
  const code = require('fs').readFileSync('./utils.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  read_token(state);
  read_token(state);

  const module = readModule(state);

  write('// GENERATED, DO NOT EDIT\n\n');

  for (const func of module.functions) {
    write(`module.exports.${func.name} = __${func.name};\n`);
    write(`function __${func.name}(`);
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
  if (statement.__type === 'Variable_declaration') {
    write(`let ${statement.name} = `);
    writeExpression(statement.initialValue);
    write(';');
    return;
  }
  if (statement.__type === 'Expression') {
    writeExpression(statement.value);
    write(';');
    return;
  }
  if (statement.__type === 'While_loop') {
    write(`while (`);
    writeExpression(statement.condition);
    write(') ');
    writeStatement(statement.body, indent);
    return;
  }
  if (statement.__type === 'If') {
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
  if (statement.__type === 'Block') {
    write('{\n');
    for (const subStatement of statement.statements) {
      write(indent + '  ');
      writeStatement(subStatement, indent + '  ');
      write('\n');
    }
    write(`${indent}}`);
    return;
  }
  if (statement.__type === 'Return') {
    write('return ');
    writeExpression(statement.value);
    write(';');
    return;
  }
  write(`UNKNOWN_STATEMENT_${statement.__type};`);
}

function writeExpression(expression) {
  if (expression.__type === 'Function_call') {
    if (expression.functionName[0] === '__has') {
      write('(');
      writeExpression(expression.arguments[0].value);
      write('.has(');
      writeExpression(expression.arguments[1].value);
      write('))');
      return;
    }
    if (expression.functionName[0] === '__substring') {
      write('(');
      writeExpression(expression.arguments[0].value);
      write('.substring(');
      writeExpression(expression.arguments[1].value);
      write(', ');
      writeExpression(expression.arguments[2].value);
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
      if (argument.__type === 'Expression') {
        write('clone(');
        writeExpression(argument.value);
        write(')');
      } else if (argument.__type === 'Reference') {
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
  if (expression.__type === 'String_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'Bool_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'identifier') {
    write(expression.name);
    return;
  }
  if (expression.__type === 'Object_literal') {
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
  if (expression.__type === 'Binary_operation') {
    write('(');
    writeExpression(expression.leftOperand);
    let {operation} = expression;
    if (operation === '==') operation = '===';
    if (operation === '!=') operation = '!==';
    write(` ${operation} `);
    writeExpression(expression.rightOperand);
    write(')');
    return;
  }
  if (expression.__type === 'Qualified_name') {
    write(expression.value.join('.'));
    return;
  }
  if (expression.__type === 'Collection_literal') {
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
  if (expression.__type === 'Character_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'Collection_access') {
    write(`access(${expression.collectionName.join('.')}, `);
    writeExpression(expression.key);
    write(')');
    return;
  }
  if (expression.__type === 'In_place_assignment') {
    if (expression.isPrefix) {
      write(expression.operator);
    }
    writeExpression(expression.target);
    if (!expression.isPrefix) {
      write(expression.operator);
    }
    return;
  }
  if (expression.__type === 'Identity_test') {
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
  if (expression.__type === 'Unary_operation') {
    write(expression.operator);
    writeExpression(expression.operand);
    return;
  }
  write(`UNKNOWN_EXPRESSION_${expression.__type}`);
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
  read_token(state);
  invariant(has_identifier(state));
  const declName = state.token.value;
  read_token(state);
  invariant(has_operator(state, '('));
  read_token(state);

  const arguments = [];
  while (!has_operator(state, ')')) {
    const isRef = has_keyword(state, 'ref');
    if (isRef) {
      read_token(state);
    }
    invariant(has_identifier(state));
    const name = state.token.value;
    read_token(state);
    invariant(has_operator(state, ':'));
    read_token(state);
    invariant(has_identifier(state));
    const typeName = state.token.value;
    read_token(state);
    if (has_operator(state, ',')) {
      read_token(state);
    } else {
      invariant(has_operator(state, ')'));
    }
    arguments.push({name, typeName});
  }

  read_token(state);
  invariant(has_operator(state, '{'));
  read_token(state);
  const statements = [];
  while (!has_operator(state, '}')) {
    statements.push(readStatement(state));
  }
  read_token(state);
  module.functions.push({name: declName, statements, arguments});
}

function readStatement(state) {
  if (has_keyword(state, 'let')) {
    read_token(state);
    invariant(has_identifier(state));
    const name = state.token.value;
    read_token(state);
    invariant(has_operator(state, '='));
    read_token(state);
    const initialValue = readExpression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Variable_declaration', name, initialValue};
  }

  if (has_keyword(state, 'while')) {
    read_token(state);
    invariant(has_operator(state, '('));
    read_token(state);
    const condition = readExpression(state);
    invariant(has_operator(state, ')'));
    read_token(state);
    const body = readStatement(state);
    return {__type: 'While_loop', condition, body};
  }

  if (has_keyword(state, 'if')) {
    read_token(state);
    invariant(has_operator(state, '('));
    read_token(state);
    const condition = readExpression(state);
    invariant(has_operator(state, ')'));
    read_token(state);
    const consequent = readStatement(state);
    let alternate;
    if (has_keyword(state, 'else')) {
      read_token(state);
      alternate = readStatement(state);
    }
    return {__type: 'If', condition, consequent, alternate};
  }

  if (has_keyword(state, 'return')) {
    read_token(state);
    const value = readExpression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Return', value};
  }

  if (has_operator(state, '{')) {
    read_token(state);
    const statements = [];
    while (!has_operator(state, '}')) {
      statements.push(readStatement(state));
    }
    read_token(state);
    return {__type: 'Block', statements};
  }

  const value = readExpression(state);
  invariant(has_operator(state, ';'));
  read_token(state);
  return {__type: 'Expression', value};
}

function readExpression(state) {
  return readAssignmentExpression(state);
}

function readAssignmentExpression(state) {
  const leftOperand = readLogicalOrExpression(state);
  if (!has_operator(state, '=')) return leftOperand;
  read_token(state);
  const rightOperand = readAssignmentExpression(state);
  return {__type: 'Binary_operation', operation: '=', leftOperand, rightOperand};
}

const readSumExpression =
  makeLeftAssociativeOperatorReader(readIdentityExpression, new Set(['+', '-']));

const readComparisonExpression =
  makeLeftAssociativeOperatorReader(readSumExpression, new Set(['<', '<=', '>', '>=']));

const readEqualityExpression =
  makeLeftAssociativeOperatorReader(readComparisonExpression, new Set(['==', '!=']));

const readLogicalAndExpression =
  makeLeftAssociativeOperatorReader(readEqualityExpression, new Set(['&&']));

const readLogicalOrExpression =
  makeLeftAssociativeOperatorReader(readLogicalAndExpression, new Set(['||']));

function makeLeftAssociativeOperatorReader(expressionReader, operators) {
  return state => {
    let leftOperand = expressionReader(state);
    while (state.token.__type === 'Operator' && operators.has(state.token.value)) {
      const operation = state.token.value;
      read_token(state);
      const rightOperand = expressionReader(state);
      leftOperand = {__type: 'Binary_operation', operation, leftOperand, rightOperand};
    }
    return leftOperand;
  }
}

function readIdentityExpression(state) {
  const operand = readPrimaryExpression(state);
  if (
    !has_keyword(state, 'isnt') &&
    !has_keyword(state, 'is')
  ) return operand;
  const isNegative = state.token.value === 'isnt';
  read_token(state);
  const typeName = readQualifiedName(state);
  return {__type: 'Identity_test', isNegative, operand, typeName};
}

function readPrimaryExpression(state) {
  if (state.token.__type === 'String_literal') {
    const value = state.token.value;
    read_token(state);
    return {__type: 'String_literal', value};
  }
  if (state.token.__type === 'Character_literal') {
    const value = state.token.value;
    read_token(state);
    return {__type: 'Character_literal', value};
  }
  if (has_keyword(state, 'true')) {
    read_token(state);
    return {__type: 'Bool_literal', value: true};
  }
  if (has_keyword(state, 'false')) {
    read_token(state);
    return {__type: 'Bool_literal', value: false};
  }

  if (has_operator(state, '++')) {
    const operator = state.token.value;
    read_token(state);
    const target = readPrimaryExpression(state);
    return {__type: 'In_place_assignment', operator, target, isPrefix: true};
  }

  if (has_operator(state, '!')) {
    const operator = state.token.value;
    read_token(state);
    const operand = readPrimaryExpression(state);
    return {__type: 'Unary_operation', operator, operand};
  }

  if (has_keyword(state, 'set') || has_keyword(state, 'vec')) {
    const dataType = state.token.value;
    read_token(state);
    invariant(has_operator(state, '['));
    read_token(state);
    const values = [];
    while (!has_operator(state, ']')) {
      const expression = readExpression(state);
      values.push(expression);
      if (has_operator(state, ',')) {
        read_token(state);
      } else {
        invariant(has_operator(state, ']'));
      }
    }
    read_token(state);
    return {__type: 'Collection_literal', dataType, values};
  }

  let qualifiedName;
  if (has_identifier(state)) {
    qualifiedName = readQualifiedName(state);
  }

  if (has_operator(state, '[')) {
    read_token(state);
    const key = readExpression(state);
    invariant(has_operator(state, ']'));
    read_token(state);
    return {__type: 'Collection_access', collectionName: qualifiedName, key};
  }

  if (has_operator(state, '{')) {
    read_token(state);
    const fields = [];
    while (has_identifier(state)) {
      const name = state.token.value;
      read_token(state);
      invariant(has_operator(state, ':'));
      read_token(state);
      const value = readExpression(state);
      if (has_operator(state, ',')) {
        read_token(state);
      } else {
        invariant(has_operator(state, '}'));
      }
      fields.push({name, value});
    }
    invariant(has_operator(state, '}'));
    read_token(state);
    return {__type: 'Object_literal', typeName: qualifiedName, fields};
  }
  invariant(qualifiedName != null);

  if (has_operator(state, '(')) {
    read_token(state);
    const arguments = [];
    while (!has_operator(state, ')')) {
      arguments.push(utils.read_call_argument(state, readExpression));
      if (has_operator(state, ',')) {
        read_token(state);
      } else {
        invariant(has_operator(state, ')'));
      }
    }
    read_token(state);
    return {__type: 'Function_call', functionName: qualifiedName, arguments};
  }
  return {__type: 'Qualified_name', value: qualifiedName};
}

function readQualifiedName(state) {
  invariant(has_identifier(state));
  const qualifiedName = [state.token.value];
  read_token(state);
  while (has_operator(state, '.')) {
    read_token(state);
    invariant(has_identifier(state));
    qualifiedName.push(state.token.value);
    read_token(state);
  }
  return qualifiedName;
}

main();
