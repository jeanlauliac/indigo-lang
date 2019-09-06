#!/usr/bin/env node

global.__read_expression = readExpression;

const utils = require('./compiled_src');
const fs = require('fs');
const path = require('path');
const {has_keyword, has_operator, get_escaped_char,
  invariant, read_token, read_qualified_name, read_type_name} = utils;

const write = process.stdout.write.bind(process.stdout);

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

  build_module_types(state, index_module_scope, index_decls);
  for (const {scope, declarations} of submodules) {
    build_module_types(state, scope, declarations);
  }

  // ****** pass 3: analyse functions

  analyse_module(state, index_module_scope, index_decls, '');
  for (const {name, declarations, scope} of submodules) {
    analyse_module(state, scope, declarations, `${name}__`);
  }

  // ****** write output

  write('// GENERATED, DO NOT EDIT\n\n');

  for (const func of state.functions) {
    write_function(state, func);
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
  if (call_main) write('__main();\n');
}

function write_function(state, func) {
  write(`module.exports.${func.pseudo_name} = __${func.pseudo_name};\n`);
  write(`function __${func.pseudo_name}(`);
  const spec = state.types.get(func.id);
  invariant(spec.__type === 'Function');

  for (const arg_id of spec.argument_ids) {
    const arg = state.types.get(arg_id);
    write(`${arg.name}, `);
  }
  write(`) {\n`);
  for (const statement of func.statements) {
    write('  ');
    write_statement(state, statement, '  ');
    write('\n');
  }
  write(`}\n\n`);
}

const builtin_types = [
  {__type: 'BuiltinType', name: 'bool'},
  {__type: 'BuiltinType', parameter_count: 1, name: 'vec'},
  {__type: 'BuiltinType', parameter_count: 0, name: 'set'},
  {__type: 'BuiltinType', name: 'str'},
  {__type: 'BuiltinType', name: 'char'},
  {__type: 'BuiltinType', name: 'i32', is_number: true, is_signed: true},
  {__type: 'BuiltinType', name: 'u32', is_number: true},
];

const builtin_functions = [
  {name: '__size', arguments: [{type: get_base_type('str')}],
    return_type: get_base_type('u32')},
  {name: '__die', arguments: [{type: get_base_type('str')}]},
  {name: '__has', arguments: [{type: get_base_type('set')},
      {type: get_base_type('char')}], return_type: get_base_type('bool')},
  {name: '__has_str', arguments: [{type: get_base_type('set')},
      {type: get_base_type('str')}], return_type: get_base_type('bool')},
  {name: '__size_vec', type_parameter_names: ['Value'],
      arguments: [{
        type: {name: ['vec'], parameters: [get_base_type('Value')]}}],
      return_type: get_base_type('u32')},
  {name: '__push', type_parameter_names: ['Value'],
      arguments: [{
        type: {name: ['vec'], parameters: [get_base_type('Value')]}},
      {type: get_base_type('Value')}]},
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
          is_by_reference: arg.is_by_reference});
    }
    let return_type;
    if (def.return_type != null) {
      return_type = resolve_type(state, type_scope, def.return_type);
    }

    state.types.set(id, {__type: 'Function', argument_ids,
        type_parameter_ids, return_type});
    root_names.set(def.name, {__type: 'Function', id});
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

    state.functions.push({
      id,
      pseudo_name: name_prefix + decl.name,
      statements,
    });
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
function build_module_types(state, scope, declarations) {
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
        state.types.set(variant_id, {__type: 'Enum_variant', fields, enum_id: id});
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
      state.types.set(id, {__type: 'Function', argument_ids, return_type})
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
          condition: statement.condition,
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
        condition: statement.condition,
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
        type: init_value.type, pseudo_name: statement.name});
    return {
      refinements: init_value.refinements,
      statement: {
        __type: 'Typed_variable_declaration',
        id,
        initial_value: statement.initialValue,
      },
    };
  }

  if (statement.__type === 'Expression') {
    const value = analyse_expression(state, statement.value, scope, refims);
    return {
      refinements: value.refinements,
      statement: {__type: 'Typed_expression', value: statement.value},
    };
  }

  if (statement.__type === 'Return') {
    const value = analyse_expression(state, statement.value, scope, refims);
    // FIXME: check correct return type

    return {
      refinements: value.refinements,
      statement: {__type: 'Typed_return', value: statement.value},
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
      statement: {
        __type: 'Typed_while_loop',
        condition: statement.condition,
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

const EMPTY_MAP = new Map();

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
        __type: 'Typed_u32_literal',
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
        __type: 'Typed_qualified_name',
        reference,
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
      const arg = analyse_expression(state, exp.arguments[i].value,
          scope, refims);
      const arg_def = state.types.get(func.argument_ids[i]);
      invariant(arg_def.__type === 'Function_argument');

      match_types(state, arg.type, arg_def.type, settled_type_params);
      arguments.push(arg.expression);
    }

    const func_def = state.types.get(spec.id);
    return {
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
    if (exp.dataType === 'set') {
      return {
        type: {id: state.builtin_ids.set, parameters: []},
        expression: {
          __type: 'Typed_set_literal',
          values: exp.values,
        },
      };
    }
    if (exp.dataType === 'vec') {
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
          id: state.builtin_ids.vec,
          parameters: [item_type],
        },
        refinements: refims,
        expression: {
          __type: 'Typed_vector_literal',
          item_type,
          items,
        }
      };
    }
    invariant(false);
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
          __type: 'Typed_binary_logic_operation',
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
          __type: 'Typed_binary_logic_operation',
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
              __type: 'Typed_concatenation',
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
            __type: 'Typed_binary_numeric_operation',
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
        invariant(left_op.type.id === right_op.type.id);
        return {
          type: {id: state.builtin_ids.bool, parameters: []},
          refinements,
          expression: {
            __type: 'Typed_comparison_operation',
            operation: exp.operation,
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
          enum_id: type.enum_id,
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
          __type: 'Typed_vector_access',
          operand_id: spec.value_id,
          key: key.expression,
        },
      };
    }
    if (spec.type.id === state.builtin_ids.str) {
      invariant(key.type.id === state.builtin_ids.u32);
      return {
        type: {id: state.builtin_ids.char, parameters: []},
        expression: {
          __type: 'Typed_string_character_access',
          operand_id: spec.value_id,
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


function write_statement(state, statement, indent) {
  if (statement.__type === 'Typed_variable_declaration') {
    const spec = state.types.get(statement.id);
    write(`let ${spec.pseudo_name} = `);
    writeExpression(statement.initial_value);
    write(';');
    return;
  }
  if (statement.__type === 'Typed_expression') {
    writeExpression(statement.value);
    write(';');
    return;
  }
  if (statement.__type === 'Typed_while_loop') {
    write(`while (`);
    writeExpression(statement.condition);
    write(') ');
    write_statement(state, statement.body, indent);
    return;
  }
  if (statement.__type === 'Typed_if') {
    write(`if (`);
    writeExpression(statement.condition);
    write(') ');
    write_statement(state, statement.consequent, indent);
    if (statement.alternate) {
      write(' else ');
      write_statement(state, statement.alternate, indent);
    }
    return;
  }
  if (statement.__type === 'Typed_block') {
    write('{\n');
    for (const subStatement of statement.statements) {
      write(indent + '  ');
      write_statement(state, subStatement, indent + '  ');
      write('\n');
    }
    write(`${indent}}`);
    return;
  }
  if (statement.__type === 'Typed_return') {
    write('return ');
    writeExpression(statement.value);
    write(';');
    return;
  }
  throw new Error(`unknown statement type ${statement.__type}`);
}

function writeExpression(expression) {
  if (expression.__type === 'Function_call') {
    if (expression.functionName[0].startsWith('__has')) {
      write('(');
      writeExpression(expression.arguments[0].value);
      write('.has(');
      writeExpression(expression.arguments[1].value);
      write('))');
      return;
    }
    if (expression.functionName[0].startsWith('__size')) {
      write('(');
      writeExpression(expression.arguments[0].value);
      write(').length');
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
    } else if (expression.functionName[0] === '__read_expression') {
      write("global.__read_expression(");
    } else if (expression.functionName[0] === 'println') {
      write('console.log(');
    } else {
      write(`__${expression.functionName.join('__')}(`);
    }
    for (const argument of expression.arguments) {
      if (!argument.is_by_reference) {
        write('clone(');
        writeExpression(argument.value);
        write(')');
      } else {
        writeExpression(argument.value);
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
  if (expression.__type === 'Number_literal') {
    write(expression.value);
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
      if (field.value.__type === 'Shorthand_field_value') {
        writeExpression({__type: 'Qualified_name', value: [field.name]});
      } else {
        writeExpression(field.value.expression);
      }
      write(', ');
    }
    if (expression.typeName.length > 0) {
      write(`__type: ${JSON.stringify(expression.typeName.join('.'))}`);
    }
    write('}');
    return;
  }
  if (expression.__type === 'Binary_operation') {
    write('(');
    writeExpression(expression.left_operand);
    let {operation} = expression;
    if (operation === '==') operation = '===';
    if (operation === '!=') operation = '!==';
    write(` ${operation} `);
    writeExpression(expression.right_operand);
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
  const left_operand = readLogicalOrExpression(state);
  if (!has_operator(state, '=')) return left_operand;
  read_token(state);
  const right_operand = readAssignmentExpression(state);
  return {__type: 'Binary_operation', operation: '=', left_operand, right_operand};
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
    let left_operand = expressionReader(state);
    while (state.token.__type === 'Operator' && operators.has(state.token.value)) {
      const operation = state.token.value;
      read_token(state);
      const right_operand = expressionReader(state);
      left_operand = {__type: 'Binary_operation', operation, left_operand, right_operand};
    }
    return left_operand;
  }
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
