'use strict';

const invariant = require('./invariant');

module.exports = utils => {
  const {
    has_keyword,
    has_operator,
    read_token,
    read_qualified_name,
    read_type_name,
  } = utils;

  function read_expression(state) {
    return read_assignment_expression(state);
  }

  function read_assignment_expression(state) {
    const left_operand = read_left_associative_operator(state, 0);
    if (!has_operator(state, '=')) return left_operand;
    read_token(state);
    const right_operand = read_assignment_expression(state);
    return {__type: 'Binary_operation', operation: '=', left_operand, right_operand};
  }

  const operators_by_level = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
  ].map(x => new Set(x));

  function read_left_associative_operator(state, level) {
    if (level == operators_by_level.length) {
      return read_identity_expression(state);
    }
    let left_operand = read_left_associative_operator(state, level + 1);
    const operators = operators_by_level[level];
    while (state.token.__type === 'Operator' && operators.has(state.token.value)) {
      const operation = state.token.value;
      read_token(state);
      const right_operand = read_left_associative_operator(state, level + 1);
      left_operand = {__type: 'Binary_operation', operation, left_operand, right_operand};
    }
    return left_operand;
  }

  function read_identity_expression(state) {
    const operand = read_method_call(state);
    if (
      !has_keyword(state, 'isnt') &&
      !has_keyword(state, 'is')
    ) return operand;
    const is_negative = state.token.value === 'isnt';
    read_token(state);
    const variant = read_qualified_name(state);
    return {__type: 'Identity_test', is_negative, operand, variant};
  }

  function read_method_call(state) {
    const target = utils.read_primary_expression(state);
    if (!has_operator(state, '->')) {
      return target;
    }
    read_token(state);
    const qualified_name = read_qualified_name(state);
    invariant(has_operator(state, "("));
    read_token(state);
    const prefix_arg = {
      is_by_reference: true,
      value: target,
    };
    const args = [prefix_arg].concat(utils.read_function_arguments(state));
    return {
      __type: 'Function_call',
      functionName: qualified_name,
      arguments: args,
    };
  }

  return read_expression;
}
