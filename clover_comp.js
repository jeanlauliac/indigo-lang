#!/usr/bin/env node

const utils = require('./utils');
const {has_keyword, has_operator, get_escaped_char,
  invariant, has_identifier, read_token, read_qualified_name} = utils;

const write = process.stdout.write.bind(process.stdout);

function main() {
  const code = require('fs').readFileSync('./utils.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  read_token(state);
  read_token(state);

  const module = readModule(state);
  const namespace = resolveModule(module);

  write('// GENERATED, DO NOT EDIT\n\n');

  for (const decl of module.declarations) {
    if (decl.__type !== 'Function') continue;
    const func = decl;
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
  if (typeof v === 'function') return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(a => clone(a));
  if (typeof v !== 'object') throw new Error('failed to clone: ' + typeof v);
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

const builtin_types = [
  {__type: 'BuiltinType', name: 'bool'},
  {__type: 'BuiltinType', parameter_count: 1, name: 'vec'},
  {__type: 'BuiltinType', name: 'str'},
  {__type: 'BuiltinType', name: 'char'},
];

function resolveModule(module) {
  const state = {next_id: 1, types: new Map()};

  const global_scope = {parent: null, names: new Map()};

  for (const type of builtin_types) {
    const id = get_unique_id(state);
    state.types.set(id, type);
    global_scope.names.set(type.name, id);
  }

  const {type_names, declaration_ids} = build_module_type_names(state, module);
  const module_scope = {parent: global_scope, names: type_names};

  build_module_types(state, module, declaration_ids, module_scope);

  // console.error(require('util').inspect(state, {depth: 10}));

  // const scope = {
  //   parent: {parent: null, names: globalNamespace},
  //   names: namespace,
  // };
  // // Analyse functions
  // for (const decl of module.declarations) {
  //   if (decl.__type !== 'Function') continue;
  //   const func_scope = {parent: scope, names: new Map()};
  //   for (const arg of decl.arguments) {
  //     func_scope.names.set(arg.name, {});
  //   }
  //   for (const st of decl.statements) {
  //     analyse_statement(st, func_scope);
  //   }
  // }

}

/**
 * We build a map of all the top-level names that represent types (struct,
 * enums...) and assign a unique ID to each one. This will allow us to resolve
 * types within types (ex. struct fields) as the next step. Having unique IDs
 * means we can later resolve types in any order, even recursive ones.
 */
function build_module_type_names(state, module) {
  const type_names = new Map();
  const declaration_ids = new Map();

  for (const [declaration_index, decl] of module.declarations.entries()) {
    if (decl.__type !== 'Enum') continue;

    if (type_names.has(decl.name)) {
      throw new Error(`duplicate name "${decl.name}"`);
    }
    const id = get_unique_id(state);
    type_names.set(decl.name, id);
    const variant_ids = new Map();
    declaration_ids.set(declaration_index, {id, variant_ids});

    for (const [variant_index, variant] of decl.variants.entries()) {
      if (type_names.has(variant.name)) {
        throw new Error(`duplicate name "${variant.name}"`);
      }
      const vid = get_unique_id(state);
      type_names.set(variant.name, vid);
      variant_ids.set(variant_index, vid);
    }
  }
  return {type_names, declaration_ids};
}

/**
 * For each type (struct, enum...) declaration, resolve all the fields types.
 * For each function, resolve the argument and return types. A resolved type is
 * represented by an ID, which can then be used to look up its properties in the
 * state's type map.
 */
function build_module_types(state, module, declaration_ids, scope) {

  for (const [decl_index, decl] of module.declarations.entries()) {

    if (decl.__type === 'Enum') {
      const variants = [];
      const {id, variant_ids} = declaration_ids.get(decl_index);

      for (const [variant_index, variant] of decl.variants.entries()) {
        const fields = new Map();
        for (const [field_index, field] of variant.fields.entries()) {
          if (fields.has(field.name)) {
            throw new Error(`duplicate field name "${field.name}" in ` +
              `enum variant "${variant.name}"`);
          }
          fields.set(field.name, {
            type: resolve_type(scope, field.type),
          });
        }
        const variant_id = variant_ids.get(variant_index);
        state.types.set(variant_id, {__type: 'Enum_variant', fields});
        variants.push(variant_id);
      }

      state.types.set(id, {__type: 'Enum', variants});

      continue;
    }

    if (decl.__type === 'Function') {
    //   for (const arg of decl.arguments) {
    //     resolve_type(namespace, arg.type);
    //   }
    //   if (decl.return_type != null) {
    //     resolve_type(namespace, decl.return_type);
    //   }
      continue;
    }

    invariant(false);
  }
}

function get_unique_id(state) {
  return state.next_id++;
}

function analyse_statement(statement, scope) {
  if (statement.__type === 'If') {
    const exp = analyse_expression(statement.condition,
        globalNamespace.get('bool'), scope);

    return;
  }

}

function analyse_expression(exp, type_hint, scope) {
  if (exp.__type === 'Bool_literal') {
    return {type: globalNamespace.get('bool')};
  }
  if (exp.__type === 'Character_literal') {
    return {type: globalNamespace.get('char')};
  }
  if (exp.__type === 'In_place_assignment') {
    const sub = analyse_expression(exp.target);
    return {type: sub.type};
  }
  if (exp.__type === 'String_literal') {
    return {type: globalNamespace.get('str')};
  }
  if (exp.__type === 'Unary_operation') {
    return analyse_expression(exp.operand, type_hint, scope);
  }
  if (exp.__type === 'Identity_test') {
    const operand = analyse_expression(exp.operand, null, scope);
    // TODO: check 'variant'
    return globalNamespace.get('bool');
  }
  if (exp.__type === 'Qualified_name') {
    resolve_qualified_name(scope, exp.value);
    return {type: null};
  }
  if (exp.__type === 'Function_call') {
    // TODO: resolve function
    return {type: null};
  }
  if (exp.__type === 'Binary_operation') {
    // TODO: resolve operands
    return {type: null};
  }
  throw new Error(`unknown "${exp.__type}"`);
}

function resolve_qualified_name(scope, name) {
  invariant(name.length >= 1);
  const ref = scope.names.get(name[0]);
  if (ref == null) {
    throw new Error(`cannot find "${name[0]}" in scope`);
  }
  for (let i = 1; i < name.length; ++i) {
    if (ref.__type === 'BuiltinType') {
      throw new Error('cannot access member of built-in type');
    }
    throw new Error(`unknown "${ref.__type}"`);
  }
  return ref;
}

function resolve_type(scope, type) {
  const name = type.name[0];
  let id = scope.names.get(name);
  while (id == null && scope.parent != null) {
    scope = scope.parent;
    id = scope.names.get(name);
  }
  if (id == null) {
    throw new Error(`unknown type name "${type.name.join('.')}"`);
  }

  // const parameter_count =
  //     def.__type === 'BuiltinType' && def.parameter_count || 0;

  // if (type.parameters.length != parameter_count) {
  //   throw new Error(`expected ${parameter_count} type parameter(s) ` +
  //     `for "${type.name.join('.')}"`);
  // }

  const parameters = [];
  for (const param of type.parameters) {
    parameters.push(resolve_type(scope, param));
  }
  return {id, parameters};
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
    if (expression.functionName[0] === '__push') {
      write('(');
      writeExpression(expression.arguments[0].value);
      write('.push(');
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
  if (expression.__type === 'Object_literal') {
    write('{');
    for (const field of expression.fields) {
      write(field.name);
      write(': ');
      if (field.is_shorthand) {
        writeExpression({__type: 'Qualified_name', value: [field.name]});
      } else {
        writeExpression(field.value);
      }
      write(', ');
    }
    if (expression.typeName.__type !== 'None') {
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
    if (expression.is_prefix) {
      write(expression.operator);
    }
    writeExpression(expression.target);
    if (!expression.is_prefix) {
      write(expression.operator);
    }
    return;
  }
  if (expression.__type === 'Identity_test') {
    if (expression.is_negative) {
      write('!');
    }
    write(`identity_test(`);
    writeExpression(expression.operand);
    write(', ');
    write(JSON.stringify(expression.variant.join('.')));
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
  const declarations = [];
  while (state.token.__type !== 'End_of_file') {
    declarations.push(readModuleDeclaration(state));
  }
  return {declarations};
}

function readModuleDeclaration(state) {
  if (has_keyword(state, 'fn')) {
    return read_function_declaration(state);
    return;
  }
  return read_enum_declaration(state);
}

function read_function_declaration(state) {
  invariant(has_keyword(state, 'fn'));
  read_token(state);
  invariant(has_identifier(state));
  const name = state.token.value;
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
    const arg_name = state.token.value;
    read_token(state);
    invariant(has_operator(state, ':'));
    read_token(state);
    const type = read_type_name(state);
    if (has_operator(state, ',')) {
      read_token(state);
    } else {
      invariant(has_operator(state, ')'));
    }
    arguments.push({name: arg_name, type});
  }
  read_token(state);

  let return_type = null;
  if (has_operator(state, ':')) {
    read_token(state);
    return_type = read_type_name(state);
  }
  invariant(has_operator(state, '{'));
  read_token(state);

  const statements = [];
  while (!has_operator(state, '}')) {
    statements.push(readStatement(state));
  }
  read_token(state);
  return {__type: 'Function', name,
    statements, arguments, return_type};
}

function read_enum_declaration(state) {
  invariant(has_keyword(state, 'enum'));
  read_token(state);
  invariant(has_identifier(state));
  const name = state.token.value;
  read_token(state);
  invariant(has_operator(state, '{'));
  read_token(state);

  let variants = [];
  while (has_identifier(state)) {
    variants.push(read_enum_variant(state));
  }

  invariant(has_operator(state, '}'));
  read_token(state);

  return {__type: 'Enum', name, variants};
}

function read_enum_variant(state) {
  const name = state.token.value;
  const fields = [];
  read_token(state);
  if (has_operator(state, '{')) {
    read_token(state);
    while (has_identifier(state)) {
      fields.push(read_variant_field(state));
    }
    invariant(has_operator(state, '}'));
    read_token(state);
  }
  if (has_operator(state, ',')) {
    read_token(state);
  } else {
    invariant(has_operator(state, '}'));
  }
  return {name, fields};
}

function read_variant_field(state) {
  const name = state.token.value;
  read_token(state);
  invariant(has_operator(state, ':'));
  read_token(state);
  const type = read_type_name(state);
  if (has_operator(state, ',')) {
    read_token(state);
  } else {
    invariant(has_operator(state, '}'));
  }
  return {name, type};
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
  const operand = utils.read_primary_expression(state, readExpression);
  if (
    !has_keyword(state, 'isnt') &&
    !has_keyword(state, 'is')
  ) return operand;
  const is_negative = state.token.value === 'isnt';
  read_token(state);
  const variant = read_qualified_name(state);
  return {__type: 'Identity_test', is_negative, operand, variant};
}

function read_type_name(state) {
  let name;
  if (has_keyword(state, 'set') || has_keyword(state, 'vec')
      || has_keyword(state, 'dict')) {
    name = [state.token.value];
    read_token(state);
  } else {
    name = read_qualified_name(state);
  }
  const parameters = [];
  if (has_operator(state, '<')) {
    read_token(state);
    while (!has_operator(state, '>')) {
      parameters.push(read_type_name(state));
      if (has_operator(state, ',')) {
        read_token(state);
      }
    }
    invariant(has_operator(state, '>'));
    read_token(state);
  }
  return {name, parameters};
}

main();
