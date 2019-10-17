'use strict';

const invariant = require('./invariant');
const read_expression = require('./read_expression');

const {
  has_keyword,
  has_operator,
  read_token,
  read_qualified_name,
  read_type_name,
} = global.__utils;
const utils = global.__utils;

module.exports = read_statement;
function read_statement(state) {
  if (has_keyword(state, 'let')) {
    read_token(state);
    invariant(has_identifier(state));
    const name = state.token.value;
    read_token(state);
    invariant(has_operator(state, '='));
    read_token(state);
    const initialValue = read_expression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Variable_declaration', name, initialValue};
  }

  if (has_keyword(state, 'while')) {
    read_token(state);
    invariant(has_operator(state, '('));
    read_token(state);
    const condition = read_expression(state);
    invariant(has_operator(state, ')'));
    read_token(state);
    const body = read_statement(state);
    return {__type: 'While_loop', condition, body};
  }

  if (has_keyword(state, 'if')) {
    read_token(state);
    invariant(has_operator(state, '('));
    read_token(state);
    const condition = read_expression(state);
    invariant(has_operator(state, ')'));
    read_token(state);
    const consequent = read_statement(state);
    let alternate;
    if (has_keyword(state, 'else')) {
      read_token(state);
      alternate = read_statement(state);
    }
    return {__type: 'If', condition, consequent, alternate};
  }

  if (has_keyword(state, 'return')) {
    read_token(state);
    const value = read_expression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Return', value};
  }

  if (has_keyword(state, 'expect')) {
    read_token(state);
    const value = read_expression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Expect', value};
  }

  if (has_operator(state, '{')) {
    read_token(state);
    const statements = [];
    while (!has_operator(state, '}')) {
      statements.push(read_statement(state));
    }
    read_token(state);
    return {__type: 'Block', statements};
  }

  const value = read_expression(state);
  invariant(has_operator(state, ';'));
  read_token(state);
  return {__type: 'Expression', value};
}

function has_identifier(state) {
  return state.token.__type === 'Identifier';
}
