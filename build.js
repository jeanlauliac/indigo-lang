'use strict';

global.__read_expression = readExpression;

const utils = require('./compiled_src');
const fs = require('fs');
const path = require('path');
const {has_keyword, has_operator,
  read_token, read_qualified_name, read_type_name} = utils;
const merge_refinements = require('./src_js/merge_refinements');
const invariant = require('./src_js/invariant');
const analyse_expression = require('./src_js/analyse_expression');
const resolve_name = require('./src_js/resolve_name');
const resolve_type = require('./src_js/resolve_type');

const EMPTY_MAP = new Map();

module.exports = build;
function build(filesystem, write, call_main) {

  const state = create_fresh_state();

  // ****** pass 1: build type names

  const INDEX_MODULE_NAME = 'index.idg';
  const index_module_ast = readModule(filesystem.get(INDEX_MODULE_NAME));
  const {type_names: index_module_names, assigned_declarations: index_decls} =
      build_module_type_names(state, index_module_ast);

  const index_module_id = get_unique_id(state);
  state.types.set(index_module_id, {__type: 'Module', names: index_module_names});

  const root_names = state.types.get(state.root_module_id).names;
  const root_scope = {parent: null, names: root_names};
  const index_module_scope = {parent: root_scope, names: index_module_names};

  const submodules = [];

  for (const [file_name, module_code] of filesystem) {
    if (file_name === INDEX_MODULE_NAME) continue;
    const module_ast = readModule(module_code);
    if (path.extname(file_name) !== '.idg') continue;
    const {type_names, assigned_declarations} =
        build_module_type_names(state, module_ast);

    const module_id = get_unique_id(state);
    state.types.set(module_id, {__type: 'Module', names: type_names});
    const module_name = path.basename(file_name, '.idg');
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

  write('"use strict";\n');
  write('// GENERATED, DO NOT EDIT\n\n');

  for (const func of state.functions) {
    write_function({...state, write}, func);
  }

  write(`function access(collection, key) {
  if (typeof collection === 'string') {
    if (key < 0 || key >= collection.length) throw new Error('out of bounds');
    return collection[key];
  }
  if (Array.isArray(collection)) {
    if (key < 0 || key >= collection.length) throw new Error('out of bounds');
    return collection[key];
  }
  if (collection instanceof Set) return collection.has(key);
  throw new Error('invalid collection: ' + require('util').inspect(collection));
}

function $push(vec, item) {
  vec.push(item);
  return [vec];
}

`);
  if (call_main) write('main();\n');
}

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
  {name: 'size_of', arguments: [{type: get_base_type('str')}],
    return_type: get_base_type('u32')},
  {name: 'size_of', type_parameter_names: ['Value'],
      arguments: [{
        type: {name: ['vec'], parameters: [get_base_type('Value')]}}],
      return_type: get_base_type('u32')},


  {name: '__die', arguments: [{type: get_base_type('str')}]},

  {name: 'has', type_parameter_names: ['Value'],
    arguments: [{type: {name: ['set'], parameters: [get_base_type('Value')]}},
      {type: get_base_type('Value')}], return_type: get_base_type('bool')},
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

    if (!root_names.has(def.name)) {
      root_names.set(def.name, {__type: 'Function', overload_ids: []});
    }
    const {overload_ids} = root_names.get(def.name);
    overload_ids.push(id);
    const suffix = overload_ids.length > 1 ? `_${overload_ids.length}` : '';
    state.builtin_ids[def.name + suffix] = id;

    state.types.set(id, {__type: 'Function', argument_ids,
        type_parameter_ids, return_type, pseudo_name: '$' + def.name + suffix});
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

    if (decl.__type === 'Struct') {
      if (type_names.has(decl.name)) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const id = get_unique_id(state);
      type_names.set(decl.name, {__type: 'Type', id});
      assigned_declarations.push({id, declaration: decl});
      continue;
    }

    if (decl.__type === 'Function') {
      let overload_ids = [];
      if (!type_names.has(decl.name)) {
        type_names.set(decl.name, {__type: 'Function', overload_ids});
      } else {
        const spec = type_names.get(decl.name);
        invariant(spec.__type === 'Function');
        ({overload_ids} = spec);
      }

      const id = get_unique_id(state);
      overload_ids.push(id);
      assigned_declarations.push({
        id,
        overload_index: overload_ids.length,
        declaration: decl,
      });
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
  for (const {id, variant_ids, overload_index, declaration: decl} of declarations) {

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
      let suffix = '';
      if (overload_index > 1) suffix = `\$${overload_index}`;
      state.types.set(id, {
        __type: 'Function',
        argument_ids,
        return_type,
        pseudo_name: name_prefix + decl.name + suffix,
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
    statements.push(readStatement(state));
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

  if (has_keyword(state, 'expect')) {
    read_token(state);
    const value = readExpression(state);
    invariant(has_operator(state, ';'));
    read_token(state);
    return {__type: 'Expect', value};
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

function has_identifier(state) {
  return state.token.__type === 'Identifier';
}
