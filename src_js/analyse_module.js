'use strict';

const invariant = require('./invariant');
const analyse_expression = require('./analyse_expression');
const merge_refinements = require('./merge_refinements');
const resolve_name = require('./resolve_name');

module.exports = analyse_module;
function analyse_module(state, scope, declarations, name_prefix) {

  for (const {id, declaration: decl} of declarations) {
    if (decl.__type !== 'Function') continue;
    const func_type = state.types.get(id);

    const func_scope = {parent: scope, names: new Map()};
    for (const arg_id of func_type.argument_ids) {
      const arg = state.types.get(arg_id);
      func_scope.names.set(arg.name,
          {__type: 'Value_reference', type: arg.type, id: arg_id});
    }

    let refims = new Map();
    const statements = [];

    for (const st of decl.statements) {
      const res = analyse_statement(state, st, func_scope, refims);
      refims = res.refinements;
      statements.push(res.statement);
    }

    state.functions.push({id, statements});
  }
}

function analyse_statement(state, statement, scope, refims) {
  if (statement.__type === 'If') {
    const void_scope = {parent: scope};
    const cond = analyse_expression(state, statement.condition,
        void_scope, refims);
    invariant(cond.type.id === state.builtin_ids.bool);

    const consequent_refims = merge_refinements('Intersection',
        cond.refinements, cond.conditional_refinements);
    const consequent = analyse_statement(state, statement.consequent,
        void_scope, consequent_refims);

    if (statement.alternate == null) {
      return {
        refinements: merge_refinements('Union', refims, consequent.refinements),
        statement: {
          __type: 'Typed_if',
          condition: cond.expression,
          consequent: consequent.statement,
        },
      };
    }

    const alternate = analyse_statement(state, statement.alternate,
        void_scope, cond.refinements);
    return {
      refinements: merge_refinements(
        'Union',
        consequent.refinements,
        alternate.refinements,
      ),
      statement: {
        __type: 'Typed_if',
        condition: cond.expression,
        consequent: consequent.statement,
        alternate: alternate.statement,
      },
    }
  }

  if (statement.__type === 'Variable_declaration') {
    if (scope.names == null) {
      throw new Error('cannot declare variable in single-statement context');
    }

    const prev = resolve_name(scope, statement.name);
    if (prev != null) {
      throw new Error(`variable "${statement.name}" would shadow existing name`);
    }

    const init_value = analyse_expression(state, statement.initialValue,
        scope, refims);
    const id = get_unique_id(state);
    scope.names.set(statement.name, {__type: 'Value_reference',
        type: init_value.type, id});
    let name = statement.name;
    if (name === 'arguments') name += '$';

    state.types.set(id, {__type: 'Variable',
        type: init_value.type, name});
    return {
      refinements: init_value.refinements,
      statement: {
        __type: 'Typed_variable_declaration',
        id,
        initial_value: init_value.expression,
      },
    };
  }

  if (statement.__type === 'Expression') {
    const value = analyse_expression(state, statement.value, scope, refims);
    return {
      refinements: value.refinements,
      statement: {__type: 'Typed_expression', value: value.expression},
    };
  }

  if (statement.__type === 'Return') {
    const value = analyse_expression(state, statement.value, scope, refims);
    // FIXME: check correct return type

    return {
      refinements: value.refinements,
      statement: {__type: 'Typed_return', value: value.expression},
    };
  }

  if (statement.__type === 'Expect') {
    const value = analyse_expression(state, statement.value, scope, refims);
    invariant(value.type.id === state.builtin_ids.bool);

    return {
      refinements: merge_refinements('Intersection',
         value.refinements, value.conditional_refinements),
      statement: {__type: 'Typed_expect', value: value.expression},
    };
  }

  if (statement.__type === 'While_loop') {
    const cond = analyse_expression(state, statement.condition, scope, refims);
    invariant(cond.type.id === state.builtin_ids.bool);
    const body_refims = merge_refinements('Intersection',
        cond.refinements, cond.conditional_refinements);
    const body_scope = {parent: scope};

    const body = analyse_statement(state, statement.body, body_scope, body_refims);
    return {
      refinements:
        merge_refinements('Union', cond.refinements, body.refinements),
      statement: {
        __type: 'Typed_while_loop',
        condition: cond.expression,
        body: body.statement,
      },
    };
  }

  if (statement.__type === 'Block') {
    const block_scope = {parent: scope, names: new Map()};
    const {statements} = statement;

    const res_statements = [];
    for (let i = 0; i < statements.length; ++i) {
      let res = analyse_statement(state, statements[i], block_scope, refims);
      refims = res.refinements;
      res_statements.push(res.statement);
    }

    return {
      refinements: refims,
      statement: {
        __type: 'Typed_block',
        statements: res_statements,
      },
    };
  }

  throw new Error(`unknown statement type "${statement.__type}"`);

}

function get_unique_id(state) {
  return state.next_id++;
}
