'use strict';

const utils = require('./compiled_src');
global.__utils = utils;

const read_expression = require('./src_js/read_expression');
const read_module = require('./src_js/read_module');
const fs = require('fs');
const path = require('path');
const {has_keyword, has_operator,
  read_token, read_type_name} = utils;
const merge_refinements = require('./src_js/merge_refinements');
const invariant = require('./src_js/invariant');
const analyse_module = require('./src_js/analyse_module');
const resolve_name = require('./src_js/resolve_name');
const resolve_type = require('./src_js/resolve_type');
const write_function = require('./src_js/write_function');

global.__read_expression = read_expression;

const EMPTY_MAP = new Map();

module.exports = build;
function build(filesystem, write, call_main) {

  const state = create_fresh_state();

  // ****** pass 1: build type names

  const INDEX_MODULE_NAME = 'index.idg';
  const index_module_ast = read_module(filesystem.get(INDEX_MODULE_NAME));
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
    const module_ast = read_module(module_code);
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
