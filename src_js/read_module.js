'use strict';

const invariant = require('./invariant');
const read_expression = require('./read_expression');
const read_statement = require('./read_statement');

const {
  has_keyword,
  has_operator,
  read_token,
  read_qualified_name,
  read_type_name,
} = global.__utils;

module.exports = read_module;
function read_module(code) {
  const state = {code, i: 0, token: null};
  read_token(state);

  const declarations = [];
  while (state.token.__type !== 'End_of_file') {
    declarations.push(read_module_declaration(state));
  }
  return {declarations};
}

function read_module_declaration(state) {
  let maybe = read_function_declaration(state);
  if (maybe.__type === 'Value') return maybe.value;
  maybe = read_enum_declaration(state);
  if (maybe.__type === 'Value') return maybe.value;
  maybe = read_struct_declaration(state);
  if (maybe.__type === 'Value') return maybe.value;
  invariant(false);
}

function read_function_declaration(state) {
  if (!has_keyword(state, 'fn')) {
    return {__type: 'None'};
  }
  read_token(state);
  invariant(has_identifier(state));
  const name = state.token.value;
  read_token(state);
  invariant(has_operator(state, '('));
  read_token(state);

  const args = [];
  while (!has_operator(state, ')')) {
    const is_by_reference = has_keyword(state, 'ref');
    if (is_by_reference) {
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
    args.push({name: arg_name, type, is_by_reference});
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
    statements.push(read_statement(state));
  }
  read_token(state);
  return {__type: 'Value',
    value: {__type: 'Function', name, statements, arguments: args, return_type}};
}

function read_enum_declaration(state) {
  if (!has_keyword(state, 'enum')) {
    return {__type: 'None'};
  }
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

  return {__type: 'Value', value: {__type: 'Enum', name, variants}};
}

function read_enum_variant(state) {
  const name = state.token.value;
  const fields = [];
  read_token(state);
  if (has_operator(state, '{')) {
    read_token(state);
    while (has_identifier(state)) {
      fields.push(read_struct_field(state));
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

function read_struct_declaration(state) {
  if (!has_keyword(state, 'struct')) {
    return {__type: 'None'};
  }
  read_token(state);
  invariant(has_identifier(state));
  const name = state.token.value;
  read_token(state);
  invariant(has_operator(state, '{'));
  read_token(state);

  const fields = [];
  while (has_identifier(state)) {
    fields.push(read_struct_field(state));
  }

  invariant(has_operator(state, '}'));
  read_token(state);

  return {__type: 'Value', value: {__type: 'Struct', name, fields}};
}

function read_struct_field(state) {
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

function has_identifier(state) {
  return state.token.__type === 'Identifier';
}
