#!/usr/bin/env node

global.__read_expression = readExpression;

const utils = require('./compiled_src');
const fs = require('fs');
const path = require('path');
const {has_keyword, has_operator,
  invariant, read_token, read_qualified_name, read_type_name} = utils;

const write = process.stdout.write.bind(process.stdout);
const EMPTY_MAP = new Map();

function main() {
  let code;
  let call_main = false;
  let filesystem = new Map();
  if (process.argv[2] === '-i') {
    fileTree = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const key of Object.keys(fileTree)) {
      const code = fileTree[key];
      filesystem.set(key, readModule(code));
    }
    call_main = true;
  } else {
    const all_files = fs.readdirSync('./src');
    for (const file_name of all_files) {
      const code = fs.readFileSync(`./src/${file_name}`, 'utf8');
      filesystem.set(file_name, readModule(code));
    }
  }

  const state = create_fresh_state();

  // ****** pass 1: build type names

  const INDEX_MODULE_NAME = 'index.clv';
  const index_module_ast = filesystem.get(INDEX_MODULE_NAME);
  const {type_names: index_module_names, assigned_declarations: index_decls} =
      build_module_type_names(state, index_module_ast);

  const index_module_id = get_unique_id(state);
  state.types.set(index_module_id, {__type: 'Module', names: index_module_names});

  const root_names = state.types.get(state.root_module_id).names;
  const root_scope = {parent: null, names: root_names};
  const index_module_scope = {parent: root_scope, names: index_module_names};

  const submodules = [];

  for (const [file_name, module_ast] of filesystem) {
    if (file_name === INDEX_MODULE_NAME) continue;
    if (path.extname(file_name) !== '.clv') continue;
    const {type_names, assigned_declarations} =
        build_module_type_names(state, module_ast);

    const module_id = get_unique_id(state);
    state.types.set(module_id, {__type: 'Module', names: type_names});
    const module_name = path.basename(file_name, '.clv');
    if (index_module_names.has(module_name)) {
      throw new Error(`duplicate name "${module_name}"`);
    }
    index_module_names.set(module_name, {
      __type: 'Module_name',
      id: module_id,
    });

    const module_scope = {parent: index_module_scope, names: type_names};
    submodules.push({name: module_name,
        scope: module_scope, declarations: assigned_declarations});
  }

  // ****** pass 2: build type entities

  build_module_types(state, index_module_scope, index_decls, '');
  for (const {name, scope, declarations} of submodules) {
    build_module_types(state, scope, declarations, `${name}\$`);
  }

  // ****** pass 3: analyse functions

  analyse_module(state, index_module_scope, index_decls);
  for (const {name, declarations, scope} of submodules) {
    analyse_module(state, scope, declarations);
  }

  // ****** write output

  write('// GENERATED, DO NOT EDIT\n\n');

  for (const func of state.functions) {
    write_function(state, func);
  }

  write(`function access(collection, key) {
  if (typeof collection === 'string') {
    if (key < 0 || key >= collection.length) throw new Error('out of bounds');
    return collection[key];
  }
  if (collection instanceof Set) return collection.has(key);
  throw new Error('invalid collection');
}

`);
  if (call_main) write('main();\n');
}

function write_function(state, func) {
  const spec = state.types.get(func.id);
  invariant(spec.__type === 'Function');

  write(`module.exports.${spec.pseudo_name} = ${spec.pseudo_name};\n`);
  write(`function ${spec.pseudo_name}(`);

  const env = {argument_ids: spec.argument_ids};

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

const builtin_types = [
  {__type: 'BuiltinType', name: 'bool'},
  {__type: 'BuiltinType', parameter_count: 1, name: 'vec'},
  {__type: 'BuiltinType', parameter_count: 1, name: 'set'},
  {__type: 'BuiltinType', name: 'str'},
  {__type: 'BuiltinType', name: 'char'},
  {__type: 'BuiltinType', name: 'i32', is_number: true, is_signed: true},
  {__type: 'BuiltinType', name: 'u32', is_number: true},
];

const builtin_functions = [
  {name: '__size', arguments: [{type: get_base_type('str')}],
    return_type: get_base_type('u32')},
  {name: '__die', arguments: [{type: get_base_type('str')}]},
  {name: '__has', type_parameter_names: ['Value'],
    arguments: [{type: {name: ['set'], parameters: [get_base_type('Value')]}},
      {type: get_base_type('Value')}], return_type: get_base_type('bool')},
  {name: '__size_vec', type_parameter_names: ['Value'],
      arguments: [{
        type: {name: ['vec'], parameters: [get_base_type('Value')]}}],
      return_type: get_base_type('u32')},
  {
    name: 'push',
    type_parameter_names: ['Value'],
    arguments: [
      {
        is_by_reference: true,
        type: {
          name: ['vec'],
          parameters: [get_base_type('Value')],
        },
      },
      {type: get_base_type('Value')},
    ],
  },
  {name: 'println', arguments: [{type: get_base_type('str')}]},
];

function create_fresh_state() {
  const root_names = new Map();
  const state = {
    next_id: 2,
    types: new Map([[1, {__type: 'Module', names: root_names}]]),
    functions: [],
    builtin_ids: {},
    root_module_id: 1,
  };

  for (const type of builtin_types) {
    const id = get_unique_id(state);
    state.types.set(id, type);
    root_names.set(type.name,
        {__type: 'Type', id, parameter_count: type.parameter_count});
    state.builtin_ids[type.name] = id;
  }

  const root_scope = {parent: null, names: root_names};
  for (const def of builtin_functions) {
    const id = get_unique_id(state);

    const type_scope = {parent: root_scope, names: new Map()};
    const type_parameter_ids = [];
    if (def.type_parameter_names != null) {
      for (const name of def.type_parameter_names) {
        const param_id = get_unique_id(state);
        type_parameter_ids.push(param_id);
        state.types.set(param_id, {__type: 'Function_type_parameter',
            name, function_id: id});
        type_scope.names.set(name, {__type: 'Type',
            id: param_id, parameter_count: 0});
      }
    }

    const argument_ids = [];
    for (const arg of def.arguments) {
      const arg_id = get_unique_id(state);
      argument_ids.push(arg_id);
      state.types.set(arg_id, {__type: 'Function_argument',
          type: resolve_type(state, type_scope, arg.type),
          is_by_reference: arg.is_by_reference || false});
    }
    let return_type;
    if (def.return_type != null) {
      return_type = resolve_type(state, type_scope, def.return_type);
    }

    state.types.set(id, {__type: 'Function', argument_ids,
        type_parameter_ids, return_type, pseudo_name: def.name});
    root_names.set(def.name, {__type: 'Function', id});
    state.builtin_ids[def.name] = id;
  }

  return state;
}

function get_base_type(name) {
  return {name: [name], parameters: []};
}

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

/**
 * We build a map of all the top-level names that represent types (struct,
 * enums...) and assign a unique ID to each one. This will allow us to resolve
 * types within types (ex. struct fields) as the next step. Having unique IDs
 * means we can later resolve types in any order, even recursive ones.
 */
function build_module_type_names(state, module) {
  const type_names = new Map();
  const assigned_declarations = [];

  for (const decl of module.declarations) {
    if (decl.__type === 'Enum') {
      if (type_names.has(decl.name)) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const id = get_unique_id(state);
      const variant_ids = new Map();
      type_names.set(decl.name, {__type: 'Type', id, variant_ids});

      for (const [variant_index, variant] of decl.variants.entries()) {
        if (type_names.has(variant.name)) {
          throw new Error(`duplicate name "${variant.name}"`);
        }
        const vid = get_unique_id(state);
        type_names.set(variant.name, {__type: 'Type', id: vid});
        variant_ids.set(variant_index, vid);
      }

      assigned_declarations.push({id, variant_ids, declaration: decl});
      continue;
    }

    if (decl.__type === 'Struct' || decl.__type === 'Function') {
      if (type_names.has(decl.name)) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const id = get_unique_id(state);
      type_names.set(decl.name, {
        __type: decl.__type === 'Struct' ? 'Type' : 'Function', id});
      assigned_declarations.push({id, declaration: decl});
      continue;
    }

    invariant(false);
  }
  return {type_names, assigned_declarations};
}

/**
 * For each type (struct, enum...) declaration, resolve all the fields types.
 * For each function, resolve the argument and return types. A resolved type is
 * represented by an ID, which can then be used to look up its properties in the
 * state's type map.
 */
function build_module_types(state, scope, declarations, name_prefix) {
  for (const {id, variant_ids, declaration: decl} of declarations) {

    if (decl.__type === 'Enum') {

      if (resolve_name(scope.parent, decl.name) != null) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const variants = [];

      for (const [variant_index, variant] of decl.variants.entries()) {
        const fields = new Map();
        for (const [field_index, field] of variant.fields.entries()) {
          if (fields.has(field.name)) {
            throw new Error(`duplicate field name "${field.name}" in ` +
              `enum variant "${variant.name}"`);
          }
          fields.set(field.name, {
            type: resolve_type(state, scope, field.type),
          });
        }
        const variant_id = variant_ids.get(variant_index);
        state.types.set(variant_id, {
          __type: 'Enum_variant',
          fields,
          enum_id: id,
          pseudo_name: variant.name,
        });
        variants.push(variant_id);
      }

      state.types.set(id, {__type: 'Enum', variants});
      continue;
    }

    if (decl.__type === 'Struct') {
      if (resolve_name(scope.parent, decl.name) != null) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const fields = new Map();
      for (const [field_index, field] of decl.fields.entries()) {
        if (fields.has(field.name)) {
          throw new Error(`duplicate field name "${field.name}" in ` +
            `struct "${decl.name}"`);
        }
        fields.set(field.name, {
          type: resolve_type(state, scope, field.type),
        });
      }
      state.types.set(id, {__type: 'Struct', fields});
      continue;
    }

    if (decl.__type === 'Function') {
      if (resolve_name(scope.parent, decl.name) != null) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const argument_ids = [];
      for (const arg of decl.arguments) {
        const arg_id = get_unique_id(state);
        argument_ids.push(arg_id);
        state.types.set(arg_id, {__type: 'Function_argument',
            name: arg.name,
            type: resolve_type(state, scope, arg.type),
            is_by_reference: arg.is_by_reference});
      }
      let return_type;
      if (decl.return_type != null) {
        return_type = resolve_type(state, scope, decl.return_type);
      }
      state.types.set(id, {
        __type: 'Function',
        argument_ids,
        return_type,
        pseudo_name: name_prefix + decl.name,
      });
      continue;
    }

    invariant(false);
  }
}

function get_unique_id(state) {
  return state.next_id++;
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
    state.types.set(id, {__type: 'Variable',
        type: init_value.type, name: statement.name});
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
    const func = state.types.get(spec.id);
    invariant(func.__type === 'Function');
    invariant(func.argument_ids.length === exp.arguments.length);

    const settled_type_params = new Map();
    const arguments = [];

    for (let i = 0; i < func.argument_ids.length; ++i) {
      const arg_spec = exp.arguments[i];
      const arg = analyse_expression(state, arg_spec.value,
          scope, refims);
      const arg_def = state.types.get(func.argument_ids[i]);
      invariant(arg_def.__type === 'Function_argument');

      if (arg_def.is_by_reference !== arg_spec.is_by_reference) {
        throw new Error(`reference arg mismatch for call to "${exp.functionName.join('.')}"`);
      }
      match_types(state, arg.type, arg_def.type, settled_type_params);
      arguments.push({
        is_by_reference: arg_spec.is_by_reference,
        value: arg.expression
      });
    }

    const func_def = state.types.get(spec.id);
    return {
      // TODO: replace type parameters in the return type
      type: func_def.return_type,
      expression: {
        __type: 'Typed_function_call',
        function_id: spec.id,
        type_parameters: settled_type_params,
        arguments,
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
  if (actual_type.id !== expected_type.id) {
    const type_def = state.types.get(expected_type.id);
    invariant(type_def.__type === 'Function_type_parameter');

    const settled_type = settled_type_parameters.get(expected_type.id);
    if (settled_type == null) {
      settled_type_parameters.set(expected_type.id, actual_type);
      return;
    }
    expected_type = settled_type;
    invariant(actual_type.id === expected_type.id);
  }

  invariant(actual_type.parameters.length === expected_type.parameters.length);
  for (let i = 0; i < actual_type.parameters.length; ++i) {
    match_types(state, actual_type.parameters[i],
        expected_type.parameters[i], settled_type_parameters);
  }
}

function merge_refinements(method, refims, right_refims) {
  invariant(method === 'Intersection' || method === 'Union');

  if (refims == null) {
    refims = new Map();
  }
  if (right_refims == null) {
    right_refims = new Map();
  }

  const result = new Map();
  for (const [value_id, entry] of refims.entries()) {
    const right_entry = right_refims.get(value_id);
    if (right_entry == null) {
      if (method === 'Intersection') result.set(value_id, entry);
      continue;
    }
    result.set(value_id, merge_refinement_entry(method, entry, right_entry));
  }
  if (method === 'Union') return result;
  for (const [value_id, right_entry] of right_refims.entries()) {
    if (result.has(value_id)) continue;
    result.set(value_id, right_entry);
  }
  return result;
}

function merge_refinement_entry(method, entry, right_entry) {
  invariant(method === 'Intersection' || method === 'Union');
  invariant(entry.__type != null);
  invariant(right_entry.__type != null);

  if (entry.__type === 'Struct_refinement') {
    invariant(right_entry.__type === 'Struct_refinement');
    return {
      __type: 'Struct_refinement',
      fields: merge_refinement_fields(method, entry.field, right_entry.fields),
    };
  }

  invariant(entry.__type === 'Enum_refinement');
  invariant(right_entry.__type === 'Enum_refinement');

  let fields_by_variant_id = new Map();

  for (const [id, fields] of entry.fields_by_variant_id.entries()) {
    const right_fields = right_entry.fields_by_variant_id.get(id);
    if (right_fields == null) {
      if (method === 'Union') fields_by_variant_id.set(id, fields);
      continue;
    }
    fields_by_variant_id.set(id,
        merge_refinement_fields(method, fields, right_field));
  }

  if (method === 'Intersection')
    return {__type: 'Enum_refinement', fields_by_variant_id};

  for (const [id, right_fields] of right_entry.fields_by_variant_id.entries()) {
    if (entry.fields_by_variant_id.has(id)) continue;
    fields_by_variant_id.set(id, right_fields);
  }
  return {__type: 'Enum_refinement', fields_by_variant_id};
}

function merge_refinement_fields(method, fields, right_fields) {
  invariant(method === 'Intersection' || method === 'Union');

  const fields = new Map();
  for (const [name, field] of fields.entries()) {
    const right_field = right_fields.get(name);
    if (right_field == null) {
      fields.set(name, field);
      continue;
    }
    const new_field = merge_refinement_entry(method, field, right_field);
    if (new_field != null)
      fields.set(value_id, new_field);
  }
  for (const [name, right_field] of right_fields.entries()) {
    if (fields.has(name)) continue;
    fields.set(name, right_field);
  }

  return fields;
}

function resolve_type(state, scope, type) {
  const spec = resolve_qualified_name(state, scope, type.name);

  invariant(spec.__type === 'Type');
  const {id, parameter_count = 0} = spec;

  if (type.parameters.length !== parameter_count) {
    throw new Error(`expected ${parameter_count} type parameter(s) ` +
      `for "${type.name.join('.')}"`);
  }

  const parameters = [];
  for (const param of type.parameters) {
    parameters.push(resolve_type(state, scope, param));
  }
  return {id, parameters};
}

function resolve_qualified_name(state, scope, name, refims) {
  invariant(name.length >= 1);

  let ref = resolve_name(scope, name[0]);
  if (ref == null) throw new Error(`unknown name "${name[0]}"`);

  let i = 1;
  while (ref.__type === 'Module_name' && i < name.length) {
    const md = state.types.get(ref.id);
    invariant(md.__type === 'Module');
    ref = md.names.get(name[i]);
    if (ref == null) {
      throw new Error(`unknown name "${name[i]}" in path "${name.join('.')}"`);
    }
    ++i;
  }
  if (ref.__type !== 'Value_reference') {
    invariant(i === name.length);
    return ref;
  }

  invariant(ref.__type === 'Value_reference');
  const value_id = ref.id;
  const path = [];
  let {type} = ref;
  let refim = refims && refims.get(value_id);
  for (; i < name.length; ++i) {
    const type_spec = state.types.get(type.id);
    const field_name = name[i];

    if (type_spec.__type === 'Struct') {
      const field_spec = type_spec.fields.get(field_name);
      if (field_spec == null) throw new Error(`cannot find field "${field_name}"`);
      ({type} = field_spec);
      if (refim != null) {
        invariant(refim.__type === 'Struct_refinement');
        refim = refim.fields.get(field_name);
      }
      path.push({__type: 'Struct_field_access', name: field_name});
      continue;
    }

    if (type_spec.__type === 'Enum' && refim != null) {
      invariant(refim.__type === 'Enum_refinement');
      invariant(refim.fields_by_variant_id.size === 1);
      const variant_id = refim.fields_by_variant_id.keys().next().value;
      const variant_spec = state.types.get(variant_id);
      invariant(variant_spec.__type === 'Enum_variant');

      const field_spec = variant_spec.fields.get(field_name);
      if (field_spec == null) throw new Error(`cannot find field "${field_name}"`);
      ({type} = field_spec);
      refim = refim.fields_by_variant_id.get(variant_id);
      path.push({__type: 'Enum_field_access', variant_id, name: field_name});
      continue;
    }

    throw new Error(`invalid access of "${name[i]}" on type ` +
        `"${type_spec.__type}" ("${name.join('.')}")`);
  }
  return {__type: 'Reference', value_id, path, type};
}

function resolve_name(scope, name) {
  let spec = scope.names && scope.names.get(name);
  while (spec == null && scope.parent != null) {
    scope = scope.parent;
    spec = scope.names && scope.names.get(name);
  }
  return spec;
}


function write_statement(state, statement, indent, env) {
  if (statement.__type === 'Typed_variable_declaration') {
    const spec = state.types.get(statement.id);
    invariant(spec.__type === 'Variable');
    write(`let ${spec.name} = `);
    write_expression(state, statement.initial_value);
    write(';');
    return;
  }
  if (statement.__type === 'Typed_expression') {
    write_expression(state, statement.value);
    write(';');
    return;
  }
  if (statement.__type === 'Typed_while_loop') {
    write(`while (`);
    write_expression(state, statement.condition);
    write(') ');
    write_statement(state, statement.body, indent, env);
    return;
  }
  if (statement.__type === 'Typed_if') {
    write(`if (`);
    write_expression(state, statement.condition);
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
      write_expression(state, statement.value);
      write(';');
      return;
    }
    write(' [');
    for (const arg_id of ref_arg_ids) {
      write_reference(state, {value_id: arg_id, path: []});
      write(', ');
    }
    if (statement.value != null) {
      write_expression(state, statement.value);
    }
    write('];');
    return;
  }
  throw new Error(`unknown statement type ${statement.__type}`);
}

function write_expression(state, expression) {
  if (expression.__type === 'Typed_function_call') {
    const {function_id} = expression;
    const spec = state.types.get(function_id);
    invariant(spec.__type === 'Function');
    const {pseudo_name} = spec;

    if (pseudo_name.startsWith('__has')) {
      write('(');
      write_expression(state, expression.arguments[0].value);
      write('.has(');
      write_expression(state, expression.arguments[1].value);
      write('))');
      return;
    }
    if (pseudo_name.startsWith('__size')) {
      write('(');
      write_expression(state, expression.arguments[0].value);
      write(').length');
      return;
    }
    if (function_id === state.builtin_ids.push) {
      write('(');
      write_expression(state, expression.arguments[0].value);
      write('.push(');
      write_expression(state, expression.arguments[1].value);
      write('))');
      return;
    }
    if (function_id === state.builtin_ids.__substring) {
      write('(');
      write_expression(state, expression.arguments[0].value);
      write('.substring(');
      write_expression(state, expression.arguments[1].value);
      write(', ');
      write_expression(state, expression.arguments[2].value);
      write('))');
      return;
    }

    const ref_arg_ids = get_primitive_ref_arg_ids(state, spec.argument_ids);

    if (ref_arg_ids.length > 0) {
      write('(() => { const $r = ');
    }

    if (function_id === state.builtin_ids.__read_file) {
      write("(require('fs').readFileSync)(");
    } else if (pseudo_name === '__write') {
      write("process.stdout.write(");
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
        write_expression(state, argument.value);
      } else {
        write_expression(state, argument.value);
      }
    }
    if (pseudo_name === '__read_file') {
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
      write_expression(state, value);
      write(', ');
    }
    if (expression.__type === 'Typed_enum_literal') {
      // enum_id
      const spec = state.types.get(expression.variant_id);
      invariant(spec.__type === 'Enum_variant');
      write(`__type: ${JSON.stringify(spec.pseudo_name)}`);
    }
    write('}');
    return;
  }
  if (expression.__type === 'Typed_binary_operation') {
    write('(');
    write_expression(state, expression.left_operand);
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

    write_expression(state, expression.right_operand);
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
        write_expression(state, expression.value);
        write(')');
        return;
      }
    }

    const needs_copy = !is_by_ref && ref.path.length > 0;
    if (needs_copy) {
      write('(');
      for (let i = 0; i < ref.path.length; ++i) {
        const path = ref.path.slice(0, i);
        write_reference(state, {value_id: ref.value_id, path});
        write(' = {...');
        write_reference(state, {value_id: ref.value_id, path});
        write('}, ');
      }
    }

    write_reference(state, expression.reference);
    write(' = ');
    write_expression(state, expression.value);
    if (needs_copy) write(')');
    return;
  }
  if (expression.__type === 'Typed_collection_literal') {
    write(expression.type === 'Vector' ? '[' : 'new Set([');
    for (const item of expression.items) {
      write_expression(state, item);
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
    write_expression(state, expression.key);
    write(')');
    return;
  }
  if (expression.__type === 'Typed_in_place_assignment') {
    if (expression.is_prefix) {
      write(expression.operator);
    }
    write_expression(state, expression.operand);
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
    write_expression(state, expression.operand);
    write('.__type === ');

    const spec = state.types.get(expression.variant_id);
    invariant(spec.__type === 'Enum_variant');
    write(JSON.stringify(spec.pseudo_name));

    write(')');
    return;
  }
  if (expression.__type === 'Typed_unary_operation') {
    write(expression.operator);
    write_expression(state, expression.operand);
    return;
  }
  throw new Error(`unknown expression type "${expression.__type}"`);
}

function write_reference(state, ref) {
  const value = state.types.get(ref.value_id);
  invariant(value.name != null);
  write(value.name);
  for (const entry of ref.path) {
    write('.');
    write(entry.name);
  }
}

/**
 * ======== Parsing ========================================================
 */

function readModule(code) {
  const state = {code, i: 0, token: null};
  read_token(state);

  const declarations = [];
  while (state.token.__type !== 'End_of_file') {
    declarations.push(readModuleDeclaration(state));
  }
  return {declarations};
}

function readModuleDeclaration(state) {
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

  const arguments = [];
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
    arguments.push({name: arg_name, type, is_by_reference});
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
  return {__type: 'Value',
    value: {__type: 'Function', name, statements, arguments, return_type}};
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
  const left_operand = readLeftAssociativeOperator(state, 0);
  if (!has_operator(state, '=')) return left_operand;
  read_token(state);
  const right_operand = readAssignmentExpression(state);
  return {__type: 'Binary_operation', operation: '=', left_operand, right_operand};
}

const operators_by_level = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
].map(x => new Set(x));

function readLeftAssociativeOperator(state, level) {
  if (level == operators_by_level.length) {
    return readIdentityExpression(state);
  }
  let left_operand = readLeftAssociativeOperator(state, level + 1);
  const operators = operators_by_level[level];
  while (state.token.__type === 'Operator' && operators.has(state.token.value)) {
    const operation = state.token.value;
    read_token(state);
    const right_operand = readLeftAssociativeOperator(state, level + 1);
    left_operand = {__type: 'Binary_operation', operation, left_operand, right_operand};
  }
  return left_operand;
}

function readIdentityExpression(state) {
  const operand = utils.read_primary_expression(state);
  if (
    !has_keyword(state, 'isnt') &&
    !has_keyword(state, 'is')
  ) return operand;
  const is_negative = state.token.value === 'isnt';
  read_token(state);
  const variant = read_qualified_name(state);
  return {__type: 'Identity_test', is_negative, operand, variant};
}

function has_identifier(state) {
  return state.token.__type === 'Identifier';
}

main();
