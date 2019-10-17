'use strict';

const invariant = require('./invariant');

module.exports = write_function;
function write_function(state, func) {
  const {write} = state;
  const spec = state.types.get(func.id);
  invariant(spec.__type === 'Function');

  write(`module.exports.${spec.pseudo_name} = ${spec.pseudo_name};\n`);
  write(`function ${spec.pseudo_name}(`);

  const env = {argument_ids: spec.argument_ids, function_id: func.id};

  for (const arg_id of spec.argument_ids) {
    const arg = state.types.get(arg_id);
    write(`${arg.name}, `);
  }
  write(`) {\n`);
  for (const statement of func.statements) {
    write('  ');
    write_statement(state, statement, '  ', env);
    write('\n');
  }
  if (spec.return_type == null) {
    const ref_arg_ids = get_primitive_ref_arg_ids(state, env.argument_ids);
    if (ref_arg_ids.length > 0) {
      write(`  return [`);
      for (const arg_id of ref_arg_ids) {
        write_reference(state, {value_id: arg_id, path: []});
        write(', ');
      }
      write('];\n');
    }
  }

  write(`}\n\n`);
}

function get_primitive_ref_arg_ids(state, argument_ids) {
  return argument_ids.filter(arg_id => {
    const arg = state.types.get(arg_id);
    if (!arg.is_by_reference) return false;
    const type_spec = state.types.get(arg.type.id);
    return type_spec.__type === 'BuiltinType';
  });
}

function write_statement(state, statement, indent, env) {
  const {write} = state;

  if (statement.__type === 'Typed_variable_declaration') {
    const spec = state.types.get(statement.id);
    invariant(spec.__type === 'Variable');
    write(`let ${spec.name} = `);
    write_expression(state, statement.initial_value, {
      ...env,
      variable_id: statement.id,
    });
    write(';');
    return;
  }
  if (statement.__type === 'Typed_expression') {
    write_expression(state, statement.value, env);
    write(';');
    return;
  }
  if (statement.__type === 'Typed_while_loop') {
    write(`while (`);
    write_expression(state, statement.condition, env);
    write(') ');
    write_statement(state, statement.body, indent, env);
    return;
  }
  if (statement.__type === 'Typed_if') {
    write(`if (`);
    write_expression(state, statement.condition, env);
    write(') ');
    write_statement(state, statement.consequent, indent, env);
    if (statement.alternate) {
      write(' else ');
      write_statement(state, statement.alternate, indent, env);
    }
    return;
  }
  if (statement.__type === 'Typed_block') {
    write('{\n');
    for (const subStatement of statement.statements) {
      write(indent + '  ');
      write_statement(state, subStatement, indent + '  ', env);
      write('\n');
    }
    write(`${indent}}`);
    return;
  }
  if (statement.__type === 'Typed_return') {
    const ref_arg_ids = get_primitive_ref_arg_ids(state, env.argument_ids);
    write('return');
    if (ref_arg_ids.length === 0) {
      if (statement.value == null) write(';');
      write(' ');
      write_expression(state, statement.value, env);
      write(';');
      return;
    }
    write(' [');
    for (const arg_id of ref_arg_ids) {
      write_reference(state, {value_id: arg_id, path: []});
      write(', ');
    }
    if (statement.value != null) {
      write_expression(state, statement.value, env);
    }
    write('];');
    return;
  }
  if (statement.__type === 'Typed_expect') {
    write('if (!(');
    write_expression(state, statement.value, env);
    write(')) throw new Error("expect() failed");');
    return;
  }
  throw new Error(`unknown statement type ${statement.__type}`);
}

function write_expression(state, expression, env) {
  const {write} = state;

  if (expression.__type === 'Typed_function_call') {
    const {function_id} = expression;
    const spec = state.types.get(function_id);
    invariant(spec.__type === 'Function');
    const {pseudo_name} = spec;

    if (function_id === state.builtin_ids.has) {
      write('(');
      write_expression(state, expression.arguments[0].value, env);
      write('.has(');
      write_expression(state, expression.arguments[1].value, env);
      write('))');
      return;
    }
    if (
      function_id === state.builtin_ids.size_of ||
      function_id === state.builtin_ids.size_of_2
    ) {
      write('(');
      write_expression(state, expression.arguments[0].value, env);
      write(').length');
      return;
    }
    // if (function_id === state.builtin_ids.push) {
      // console.error(pseudo_name);
    //   write('(');
    //   write_expression(state, expression.arguments[0].value, env);
    //   write('.push(');
    //   write_expression(state, expression.arguments[1].value, env);
    //   write('))');
    //   return;
    // }
    if (function_id === state.builtin_ids.__substring) {
      write('(');
      write_expression(state, expression.arguments[0].value, env);
      write('.substring(');
      write_expression(state, expression.arguments[1].value, env);
      write(', ');
      write_expression(state, expression.arguments[2].value, env);
      write('))');
      return;
    }

    // const ref_arg_ids = get_primitive_ref_arg_ids(state, spec.argument_ids);
    const ref_arg_ids = expression.arguments.filter(arg => {
      if (!arg.is_by_reference) return false;
      const type_spec = state.types.get(arg.type.id);
      return type_spec.__type === 'BuiltinType';
    }).map(arg => arg.reference.value_id);

    if (ref_arg_ids.length > 0) {
      write('(() => { const $r = ');
    }

    if (function_id === state.builtin_ids.__read_file) {
      write("(require('fs').readFileSync)(");
    } else if (function_id === state.builtin_ids.__die) {
      write("throw new Error(");
    } else if (pseudo_name === '__read_expression') {
      write("global.__read_expression(");
    } else if (function_id === state.builtin_ids.println) {
      write('console.log(');
    } else {
      write(`${pseudo_name}(`);
    }
    let is_first = true;
    for (const argument of expression.arguments) {
      if (!is_first) write(', ');
      is_first = false;
      if (!argument.is_by_reference) {
        write_expression(state, argument.value, env);
      } else {
        const ref = argument.reference;
        const value = state.types.get(ref.value_id);
        const is_by_ref =
          value.__type === 'Function_argument' && value.is_by_reference;

        const type_spec = state.types.get(argument.type.id);

        if (is_by_ref || type_spec.__type === 'BuiltinType') {
          write_reference(state, argument.reference, env);
        } else {
          write('(');
          write_reference(state, ref, env);
          write(`.__owner != ${ref.value_id} && (`)
          write_reference(state, ref, env);
          write(' = {...');
          write_reference(state, ref, env);
          write(`, __owner: ${ref.value_id}}`);
          write('), ');
          write_expression(state, argument.value, env);
          write(')');
        }
      }
    }
    if (function_id === state.builtin_ids.__read_file) {
      write("'utf8'")
    }
    write(')');

    if (ref_arg_ids.length > 0) {
      write('; ');
      let index = 0;
      for (const arg_id of ref_arg_ids) {
        write_reference(state, {value_id: arg_id, path: []});
        write(` = $r[${index++}]; `);
      }
      if (spec.return_type != null) {
        write(`return $r[${index}];`);
      }
      write('})()');
    }

    return;
  }
  if (expression.__type === 'Typed_string_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'Typed_number_literal') {
    write(expression.value.toString());
    return;
  }
  if (expression.__type === 'Typed_bool_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (
    expression.__type === 'Typed_enum_literal' ||
    expression.__type === 'Typed_struct_literal'
  ) {
    write('{');
    for (const [name, value] of expression.fields.entries()) {
      write(name);
      write(': ');
      write_expression(state, value, env);
      write(', ');
    }
    if (expression.__type === 'Typed_enum_literal') {
      // enum_id
      const spec = state.types.get(expression.variant_id);
      invariant(spec.__type === 'Enum_variant');
      write(`__type: ${JSON.stringify(spec.pseudo_name)}, `);
    }
    if (env.variable_id != null) {
      write(`__owner: ${env.variable_id}`);
    }
    write('}');
    return;
  }
  if (expression.__type === 'Typed_binary_operation') {
    write('(');
    write_expression(state, expression.left_operand, env);
    const op_map = {
      'And': '&&',
      'Or': '||',
      'Equal': '===',
      'Unequal': '!==',
      'Lesser': '<',
      'Greater': '>',
      'Lesser_or_equal': '<=',
      'Greater_or_equal': '>=',
      'Concat': '+',
    };
    const op_string = op_map[expression.operation];
    invariant(op_string != null);
    write(` ${op_string} `);

    write_expression(state, expression.right_operand, env);
    write(')');
    return;
  }
  if (expression.__type === 'Typed_reference') {
    write_reference(state, expression);
    return;
  }
  if (expression.__type === 'Typed_assignment') {
    const {reference: ref} = expression;
    const value = state.types.get(ref.value_id);

    const is_by_ref =
      value.__type === 'Function_argument' && value.is_by_reference;

    if (is_by_ref && ref.path.length === 0) {
      const type_spec = state.types.get(value.type.id);
      if (type_spec.__type !== 'BuiltinType') {
        write(`Object.assign(`);
        write_reference(state, expression.reference);
        write(', ');
        write_expression(state, expression.value, env);
        write(')');
        return;
      }
    }

    let close_paren = false;

    if (!is_by_ref && ref.path.length > 0) {
      write('(');
      close_paren = true;

      for (let i = 0; i < ref.path.length; ++i) {
        const path = ref.path.slice(0, i);
        const part_ref = {value_id: ref.value_id, path};
        write_reference(state, part_ref);
        write(`.__owner !== ${ref.value_id} && (`);
        write_reference(state, part_ref);
        write(' = {...');
        write_reference(state, part_ref);
        write(`, __owner: ${ref.value_id}}), `);
      }
    }

    if (is_by_ref && ref.path.length > 1) {
      write('(');
      close_paren = true;

      for (let i = 1; i < ref.path.length; ++i) {
        const path = ref.path.slice(0, i);
        const part_ref = {value_id: ref.value_id, path};
        const parent_ref = {value_id: ref.value_id, path: []};
        write_reference(state, part_ref);
        write(`.__owner !== `);
        write_reference(state, parent_ref);
        write('.__owner && (')
        write_reference(state, part_ref);
        write(' = {...');
        write_reference(state, part_ref);
        write(`, __owner: `);
        write_reference(state, parent_ref);
        write(`.__owner}), `);
      }
    }

    write_reference(state, expression.reference);
    write(' = ');
    write_expression(state, expression.value, env);
    if (close_paren) write(')');
    return;
  }
  if (expression.__type === 'Typed_collection_literal') {
    write(expression.type === 'Vector' ? '[' : 'new Set([');
    for (const item of expression.items) {
      write_expression(state, item, env);
      write(', ');
    }
    write(expression.type === 'Vector' ? ']' : '])');
    return;
  }
  if (expression.__type === 'Typed_character_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'Typed_collection_access') {
    write(`access(`);
    write_reference(state, expression.operand);
    write(`, `);
    write_expression(state, expression.key, env);
    write(')');
    return;
  }
  if (expression.__type === 'Typed_in_place_assignment') {
    if (expression.is_prefix) {
      write(expression.operator);
    }
    write_expression(state, expression.operand, env);
    if (!expression.is_prefix) {
      write(expression.operator);
    }
    return;
  }
  if (expression.__type === 'Typed_identity_test') {
    if (expression.is_negative) {
      write('!');
    }
    write(`(`);
    write_expression(state, expression.operand, env);
    write('.__type === ');

    const spec = state.types.get(expression.variant_id);
    invariant(spec.__type === 'Enum_variant');
    write(JSON.stringify(spec.pseudo_name));

    write(')');
    return;
  }
  if (expression.__type === 'Typed_unary_operation') {
    write(expression.operator);
    write_expression(state, expression.operand, env);
    return;
  }
  throw new Error(`unknown expression type "${expression.__type}"`);
}

function write_reference(state, ref) {
  const {write} = state;

  const value = state.types.get(ref.value_id);
  invariant(value.name != null);
  write(value.name);
  for (const entry of ref.path) {
    write('.');
    write(entry.name);
  }
}
