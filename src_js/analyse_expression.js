'use strict';

const invariant = require('./invariant');
const resolve_qualified_name = require('./resolve_qualified_name');
const resolve_type = require('./resolve_type');
const try_match_types = require('./try_match_types');
const merge_refinements = require('./merge_refinements');

const EMPTY_MAP = new Map();

module.exports = analyse_expression;
function analyse_expression(state, exp, scope, refims) {
  if (exp.__type === 'Bool_literal') {
    return {
      type: {id: state.builtin_ids.bool, parameters: []},
      expression: {
        __type: 'Typed_bool_literal',
        value: exp.value,
      },
    };
  }

  if (exp.__type === 'Character_literal') {
    return {
      type: {id: state.builtin_ids.char, parameters: []},
      expression: {
        __type: 'Typed_character_literal',
        value: exp.value,
      },
    };
  }

  if (exp.__type === 'In_place_assignment') {
    const operand = analyse_expression(state, exp.target, scope, refims);
    switch (exp.operation) {
      case '++': {
        const type = state.types.get(operand.type.id);
        invariant(type.__type === 'BuiltinType' && type.is_number);
        return {
          type: operand.type,
          expression: {
            __type: 'Typed_in_place_assignment',
            is_prefix: exp.is_prefix,
            operand: operand.expression,
            operator: exp.operation,
            type: operand.type,
          },
        };
      }
    }
    throw new Error(`unknown op "${exp.operation}"`);
  }

  if (exp.__type === 'String_literal') {
    return {
      type: {id: state.builtin_ids.str, parameters: []},
      expression: {
        __type: 'Typed_string_literal',
        value: exp.value,
      },
    };
  }

  if (exp.__type === 'Number_literal') {
    const value = Number.parseInt(exp.value, 10);
    invariant(value.toString() === exp.value);
    invariant(value < Math.pow(2, 31) - 1);
    invariant(value > -Math.pow(2, 31));
    return {
      type: {id: state.builtin_ids.u32, parameters: []},
      expression: {
        __type: 'Typed_number_literal',
        value,
      },
    };
  }

  if (exp.__type === 'Unary_operation') {
    const operand = analyse_expression(state, exp.operand, scope);
    const {operator} = exp;
    if (exp.operator === '-') {
      const type_def = state.types.get(operand.type.id);
      invariant(type_def.__type === 'BuiltinType');
      invariant(type_def.is_number && type_def.is_signed);
      return {
        type: operand.type,
        expression: {
          __type: 'Typed_unary_operation',
          type: operand.type,
          operand: operand.expression,
          operator,
        },
      };
    }
    if (exp.operator === '!') {
      invariant(operand.type.id === state.builtin_ids.bool);
      return {
        type: operand.type,
        expression: {
          __type: 'Typed_unary_operation',
          type: operand.type,
          operand: operand.expression,
          operator,
        },
      };
    }
    throw new Error(`invalid op "${exp.operator}"`);
  }

  if (exp.__type === 'Identity_test') {
    // TODO: handle "is_negative"

    const {id: variant_id} =
        resolve_type(state, scope, {name: exp.variant, parameters: []});
    const variant = state.types.get(variant_id);
    invariant(variant.__type === 'Enum_variant');

    const operand = analyse_expression(state, exp.operand, scope, refims);
    invariant(variant.enum_id === operand.type.id);

    const {reference, refinements} = operand;
    invariant(reference != null);
    const {path} = reference;
    let target = {
      __type: 'Enum_refinement',
      fields_by_variant_id: new Map([[variant_id, EMPTY_MAP]]),
    };
    for (let i = path.length - 1; i >= 0; --i) {
      const item = path[i];
      const fields = new Map([[item.name, target]]);
      if (item.__type === 'Struct_field_access') {
        target = {__type: 'Struct_refinement', fields};
        continue;
      }
      invariant(item.__type === 'Enum_field_access');
      target = {
        __type: 'Enum_refinement',
        fields_by_variant_id: new Map([[item.variant_id, fields]]),
      };
    }
    const conditional_refinements = new Map();
    conditional_refinements.set(reference.value_id, target);

    return {
      type: {id: state.builtin_ids.bool, parameters: []},
      conditional_refinements,
      refinements,
      expression: {
        __type: 'Typed_identity_test',
        is_negative: exp.is_negative,
        operand: operand.expression,
        variant_id,
      }
    };
  }

  if (exp.__type === 'Qualified_name') {
    const res = resolve_qualified_name(state, scope, exp.value, refims);
    invariant(res.__type === 'Reference');
    const reference = {
      value_id: res.value_id,
      path: res.path,
    };

    return {
      type: res.type,
      reference,
      expression: {
        __type: 'Typed_reference',
        value_id: res.value_id,
        path: res.path,
      }
    };
  }

  if (exp.__type === 'Function_call') {
    const spec = resolve_qualified_name(state, scope, exp.functionName);
    invariant(spec.__type === 'Function');

    const matches = [];
    for (const overload_id of spec.overload_ids) {

      const func = state.types.get(overload_id);
      invariant(func.__type === 'Function');
      if (func.argument_ids.length !== exp.arguments.length) continue;

      const settled_type_params = new Map();
      const args = [];
      let res = {__type: 'Match'};

      for (let i = 0; i < func.argument_ids.length && res.__type === 'Match'; ++i) {
        const arg_spec = exp.arguments[i];
        const arg = analyse_expression(state, arg_spec.value,
            scope, refims);
        const arg_def = state.types.get(func.argument_ids[i]);
        invariant(arg_def.__type === 'Function_argument');

        if (arg_def.is_by_reference !== arg_spec.is_by_reference) {
          throw new Error(`reference arg mismatch for call to "${exp.functionName.join('.')}"`);
        }
        res = try_match_types(state, arg.type, arg_def.type, settled_type_params);
        args.push({
          is_by_reference: arg_spec.is_by_reference,
          value: arg.expression,
          reference: arg.reference,
          type: arg.type,
        });
      }
      if (res.__type !== 'Match') continue;

      matches.push({id: overload_id, settled_type_params, arguments: args});
    }

    if (matches.length === 0) {
      throw new Error(`no match for call to function "${exp.functionName.join('.')}"`);
    }
    if (matches.length > 1) {
      throw new Error(`too many matches for call to overloaded ` +
        `function "${exp.functionName.join('.')}"`);
    }

    const mt = matches[0];
    const func_def = state.types.get(mt.id);
    return {
      // TODO: replace type parameters in the return type
      type: func_def.return_type,
      expression: {
        __type: 'Typed_function_call',
        function_id: mt.id,
        type_parameters: mt.settled_type_params,
        arguments: mt.arguments,
      },
    };
  }

  if (exp.__type === 'Collection_literal') {
    const item_type = resolve_type(state, scope, exp.item_type);
    const items = [];
    for (const value of exp.values) {
      const res = analyse_expression(state, value, scope, refims);
      refims = res.refinements;
      match_types(state, res.type, item_type, EMPTY_MAP);
      items.push(res.expression);
    }
    return {
      type: {
        id: exp.dataType === 'vec' ?
          state.builtin_ids.vec : state.builtin_ids.set,
        parameters: [item_type],
      },
      refinements: refims,
      expression: {
        __type: 'Typed_collection_literal',
        type: exp.dataType === 'vec' ? 'Vector' : 'Set',
        item_type,
        items,
      }
    };
  }

  if (exp.__type === 'Binary_operation') {
    if (exp.operation === '=') {
      const right_op = analyse_expression(state, exp.right_operand,
        scope, refims);
      const {conditional_refinements, refinements} = right_op;
      const left_op = analyse_expression(state, exp.left_operand,
        scope, refinements);

      match_types(state, left_op.type, right_op.type, EMPTY_MAP);
      invariant(left_op.reference != null);

      return {
        type: left_op.type,
        conditional_refinements,
        refinements,
        expression: {
          __type: 'Typed_assignment',
          reference: left_op.reference,
          value: right_op.expression,
        },
      };
    }

    const left_op = analyse_expression(state, exp.left_operand, scope, refims);

    if (exp.operation === '&&') {
      invariant(left_op.type.id == state.builtin_ids.bool);

      const right_refinements = merge_refinements(
          'Intersection',
          left_op.refinements,
          left_op.conditional_refinements);
      const right_op = analyse_expression(state, exp.right_operand,
          scope, right_refinements);
      invariant(right_op.type.id == state.builtin_ids.bool);
      const refinements = merge_refinements(
          'Union',
          left_op.refinements,
          right_op.refinements);
      const conditional_refinements = merge_refinements(
          'Intersection',
          left_op.conditional_refinements,
          right_op.conditional_refinements);

      return {
        type: {id: state.builtin_ids.bool, parameters: []},
        refinements,
        conditional_refinements,
        expression: {
          __type: 'Typed_binary_operation',
          operation: 'And',
          left_operand: left_op.expression,
          right_operand: right_op.expression,
        },
      };
    }

    if (exp.operation === '||') {
      invariant(left_op.type.id == state.builtin_ids.bool);

      const right_op = analyse_expression(state, exp.right_operand,
          scope, left_op.refinements);
      invariant(right_op.type.id == state.builtin_ids.bool);
      const refinements = merge_refinements(
          'Union',
          left_op.refinements,
          right_op.refinements);
      const conditional_refinements = merge_refinements(
          'Union',
          left_op.conditional_refinements,
          right_op.conditional_refinements);

      return {
        type: {id: state.builtin_ids.bool, parameters: []},
        refinements,
        conditional_refinements,
        expression: {
          __type: 'Typed_binary_operation',
          operation: 'Or',
          left_operand: left_op.expression,
          right_operand: right_op.expression,
        },
      };
    }

    const right_op = analyse_expression(state, exp.right_operand,
        scope, left_op.refinements);
    const {refinements} = right_op;

    switch (exp.operation) {
      case '+':
      case '-': {
        if (
          exp.operation === '+' &&
          (left_op.type.id === state.builtin_ids.str || left_op.type.id === state.builtin_ids.char) &&
          (right_op.type.id === state.builtin_ids.str || right_op.type.id === state.builtin_ids.char)
        ) {
          return {
            type: {id: state.builtin_ids.str, parameters: []},
            refinements,
            expression: {
              __type: 'Typed_binary_operation',
              operation: 'Concat',
              left_operand: left_op.expression,
              right_operand: right_op.expression,
            },
          };
        }
        invariant(left_op.type.id === right_op.type.id);
        const spec = state.types.get(left_op.type.id);
        invariant(spec.__type === 'BuiltinType' && spec.is_number);
        return {
          type: left_op.type,
          refinements,
          expression: {
            __type: 'Typed_binary_operation',
            operation: exp.operation === '+' ? 'Sum' : 'Subtract',
            left_operand: left_op.expression,
            right_operand: right_op.expression,
          },
        };
      }

      case '<':
      case '<=':
      case '>':
      case '>=':
      case '==':
      case '!=': {
        const ops = {
          '<': 'Lesser',
          '<=': 'Lesser_or_equal',
          '>': 'Greater',
          '>=': 'Greater_or_equal',
          '==': 'Equal',
          '!=': 'Unequal',
        };
        invariant(left_op.type.id === right_op.type.id);
        invariant(ops[exp.operation] != null);
        return {
          type: {id: state.builtin_ids.bool, parameters: []},
          refinements,
          expression: {
            __type: 'Typed_binary_operation',
            operation: ops[exp.operation],
            left_operand: left_op.expression,
            right_operand: right_op.expression,
          },
        };
      }
    }
    throw new Error(`unknown bin op "${exp.operation}"`);
  }

  if (exp.__type === 'Object_literal') {
    const spec = resolve_qualified_name(state, scope, exp.typeName, refims);
    invariant(spec.__type === 'Type');
    const type = state.types.get(spec.id);
    if (type.__type === 'Enum_variant') {
      const {refinements, fields} = analyse_object_literal_fields(state, type.fields,
          exp.fields, scope, refims);
      return {
        type: {id: type.enum_id, parameters: []},
        refinements,
        expression: {
          __type: 'Typed_enum_literal',
          variant_id: spec.id,
          fields,
        },
      };
    }
    if (type.__type === 'Struct') {
      const {refinements, fields} = analyse_object_literal_fields(state, type.fields,
          exp.fields, scope, refims);
      return {
        type: {id: spec.id, parameters: []},
        refinements,
        expression: {
          __type: 'Typed_struct_literal',
          struct_id: spec.id,
          fields,
        },
      };
    }
    throw new Error(`invalid constructor "${exp.typeName.join('.')}"`);
  }

  if (exp.__type === 'Collection_access') {
    const spec = resolve_qualified_name(state, scope, exp.collectionName, refims);
    const key = analyse_expression(state, exp.key, scope);
    invariant(spec.__type === 'Reference');
    if (spec.type.id === state.builtin_ids.vec) {
      invariant(key.type.id === state.builtin_ids.u32);
      return {
        type: spec.type.parameters[0],
        expression: {
          __type: 'Typed_collection_access',
          operand: {value_id: spec.value_id, path: spec.path},
          key: key.expression,
        },
      };
    }
    if (spec.type.id === state.builtin_ids.str) {
      invariant(key.type.id === state.builtin_ids.u32);
      return {
        type: {id: state.builtin_ids.char, parameters: []},
        expression: {
          __type: 'Typed_collection_access',
          operand: {value_id: spec.value_id, path: spec.path},
          key: key.expression,
        },
      };
    }
    throw new Error(`invalid collection access on "${exp.collectionName.join('.')}"`);
  }
  throw new Error(`unknown "${exp.__type}"`);
}

function analyse_object_literal_fields(
    state, type_fields, exp_fields, scope, refims) {
  const fields = new Map();
  const field_set = new Set(type_fields.keys());
  for (const exp_field of exp_fields) {
    const field_spec = type_fields.get(exp_field.name);
    if (field_spec == null) {
      throw new Error(`unknown field name "${exp_field.name}"`);
    }
    field_set.delete(exp_field.name);

    const field_value = exp_field.value;
    if (field_value.__type === 'Shorthand_field_value') {
      const res = resolve_qualified_name(state, scope, [exp_field.name], refims);
      invariant(res.__type === 'Reference');
      match_types(state, res.type, field_spec.type);
      refims = res.refinements;

      fields.set(exp_field.name, {
        __type: 'Typed_reference',
        value_id: res.value_id,
        path: res.path,
      });
      continue;
    }
    invariant(field_value.__type === 'Expression_field_value');
    const value = analyse_expression(state, field_value.expression, scope, refims);
    match_types(state, value.type, field_spec.type);
    refims = value.refinements;

    fields.set(exp_field.name, value.expression);
  }

  if (field_set.size > 0) {
    throw new Error(`missing fields in object literal: ` +
      `${[...field_set].map(x => `"${x}"`).join(', ')}`);
  }
  return {refinements: refims, fields};
}

function match_types(state, actual_type, expected_type, settled_type_parameters) {
  const res = try_match_types(state, actual_type, expected_type, settled_type_parameters);
  invariant(res.__type === 'Match');
}
