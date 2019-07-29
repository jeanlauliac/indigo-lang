#!/usr/bin/env node

global.__read_expression = readExpression;

const utils = require('./utils');
const {has_keyword, has_operator, get_escaped_char,
  invariant, read_token, read_qualified_name} = utils;

const write = process.stdout.write.bind(process.stdout);

function main() {
  const code = require('fs').readFileSync('./utils.clv', 'utf8');
  const state = {code, i: 0, phase: 'module',
      token: null, nextToken: null};
  read_token(state);
  read_token(state);

  const module = readModule(state);
  const namespace = resolveModule(module);

  write('// GENERATED, DO NOT EDIT\n\n');

  for (const decl of module.declarations) {
    if (decl.__type !== 'Function') continue;
    const func = decl;
    write(`module.exports.${func.name} = __${func.name};\n`);
    write(`function __${func.name}(`);
    for (const argument of func.arguments) {
      write(`${argument.name}, `);
    }
    write(`) {\n`);
    for (const statement of func.statements) {
      write('  ');
      writeStatement(statement, '  ');
      write('\n');
    }
    write(`}\n\n`);
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

function resolveModule(module) {
  const state = {next_id: 1, types: new Map(), builtins: {}};

  const global_scope = {parent: null, names: new Map()};

  for (const type of builtin_types) {
    const id = get_unique_id(state);
    state.types.set(id, type);
    global_scope.names.set(type.name,
        {__type: 'Type', id, parameter_count: type.parameter_count});
    state.builtins[type.name] = {id};
  }

  const {type_names, declaration_ids} = build_module_type_names(state, module);
  const module_scope = {parent: global_scope, names: type_names};

  // console.error(require('util').inspect(module_scope, {depth: 10}));
  build_module_types(state, module, declaration_ids, module_scope);

  let refims = new Map();

  // Analyse functions
  for (const [index, decl] of module.declarations.entries()) {
    if (decl.__type !== 'Function') continue;
    const {id} = declaration_ids.get(index);
    const func_type = state.types.get(id);
    const func_scope = {parent: module_scope, names: new Map()};
    for (const arg_id of func_type.argument_ids) {
      const arg = state.types.get(arg_id);
      func_scope.names.set(arg.name,
          {__type: 'Value_reference', type: arg.type, id: arg_id});
    }
    for (const st of decl.statements) {
      const res = analyse_statement(state, st, func_scope, refims);
      refims = res.refinements;
    }
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
  const declaration_ids = new Map();

  for (const [declaration_index, decl] of module.declarations.entries()) {
    if (decl.__type === 'Enum') {
      if (type_names.has(decl.name)) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const id = get_unique_id(state);
      type_names.set(decl.name, {__type: 'Type', id});
      const variant_ids = new Map();
      declaration_ids.set(declaration_index, {id, variant_ids});

      for (const [variant_index, variant] of decl.variants.entries()) {
        if (type_names.has(variant.name)) {
          throw new Error(`duplicate name "${variant.name}"`);
        }
        const vid = get_unique_id(state);
        type_names.set(variant.name, {__type: 'Type', id: vid});
        variant_ids.set(variant_index, vid);
      }
      continue;
    }

    if (decl.__type === 'Struct' || decl.__type === 'Function') {
      if (type_names.has(decl.name)) {
        throw new Error(`duplicate name "${decl.name}"`);
      }

      const id = get_unique_id(state);
      type_names.set(decl.name, {
        __type: decl.__type === 'Struct' ? 'Type' : 'Function', id});
      declaration_ids.set(declaration_index, {id});
      continue;
    }

    invariant(false);
  }
  return {type_names, declaration_ids};
}

/**
 * For each type (struct, enum...) declaration, resolve all the fields types.
 * For each function, resolve the argument and return types. A resolved type is
 * represented by an ID, which can then be used to look up its properties in the
 * state's type map.
 */
function build_module_types(state, module, declaration_ids, scope) {

  for (const [decl_index, decl] of module.declarations.entries()) {

    const {id, variant_ids} = declaration_ids.get(decl_index);
    if (decl.__type === 'Enum') {
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
    invariant(cond.type.id === state.builtins.bool.id);

    const consequent_refims = merge_refinements('Intersection',
        cond.refinements, cond.conditional_refinements);
    const consequent = analyse_statement(state, statement.consequent,
        void_scope, consequent_refims);

    if (statement.alternate == null) {
      return {refinements: merge_refinements('Union',
          refims, consequent.refinements)};
    }

    const alternate = analyse_statement(state, statement.alternate,
        void_scope, cond.refinements);
    return {refinements: merge_refinements('Union',
        consequent.refinements, alternate.refinements)}
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
        type: init_value.type});
    return {refinements: init_value.refinements};
  }

  if (statement.__type === 'Expression') {
    const value = analyse_expression(state, statement.value, scope);
    return {refinements: value.refinements};
  }

  if (statement.__type === 'Return') {
    const value = analyse_expression(state, statement.value, scope);
    // FIXME: check correct return type

    return {refinements: value.refinements};
  }

  if (statement.__type === 'While_loop') {
    const cond = analyse_expression(state, statement.condition, scope);
    invariant(cond.type.id === state.builtins.bool.id);
    const body_refims = merge_refinements('Intersection',
        cond.refinements, cond.conditional_refinements);
    const body_scope = {parent: scope};

    analyse_statement(state, statement.body, body_scope, body_refims);
    return {};
  }

  if (statement.__type === 'Block') {
    const block_scope = {parent: scope, names: new Map()};
    const {statements} = statement;

    for (let i = 0; i < statements.length && i <= 1; ++i) {
      let res = analyse_statement(state, statements[i], block_scope, refims);
      refims = res.refinements;
    }

    return {refinements: refims};
  }

  throw new Error(`unknown statement type "${statement.__type}"`);

}

function analyse_expression(state, exp, scope, refims) {
  if (exp.__type === 'Bool_literal') {
    return {type: state.builtins.bool};
  }

  if (exp.__type === 'Character_literal') {
    return {type: state.builtins.char};
  }

  if (exp.__type === 'In_place_assignment') {
    const operand = analyse_expression(state, exp.target, scope);
    switch (exp.operation) {
      case '++': {
        const type = state.types.get(operand.type.id);
        invariant(type.__type === 'BuiltinType' && type.is_number);
        return operand;
      }
    }
    throw new Error(`unknown op "${exp.operation}"`);
  }

  if (exp.__type === 'String_literal') {
    return {type: state.builtins.str};
  }

  if (exp.__type === 'Unary_operation') {
    const operand = analyse_expression(state, exp.operand, scope);
    if (exp.operator === '-') {
      const type_def = state.types.get(operand.type.id);
      invariant(type_def.__type === 'BuiltinType');
      invariant(type_def.is_number && type_def.is_signed);
      return operand;
    }
    if (exp.operator === '!') {
      invariant(operand.type.id === state.builtins.bool.id);
      return operand;
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
    let target = {variant_ids: [variant_id]};
    for (let i = path.length - 1; i >= 0; --i) {
      const item = path[i];
      invariant(item.__type === 'Field');
      target = {fields: new Map([[item.name, target]])};
    }
    const conditional_refinements = new Map();
    conditional_refinements.set(reference.value_id, target);

    return {type: state.builtins.bool, conditional_refinements, refinements};
  }

  if (exp.__type === 'Qualified_name') {
    const res = resolve_qualified_name(state, scope, exp.value, refims);
    invariant(res.__type === 'Reference');

    return {type: res.type, reference: {
        value_id: res.value_id, path: res.path}};
  }

  if (exp.__type === 'Function_call') {
    const spec = resolve_qualified_name(state, scope, exp.functionName);
    invariant(spec.__type === 'Function');
    const func = state.types.get(spec.id);
    invariant(func.__type === 'Function');
    invariant(func.argument_ids.length === exp.arguments.length);
    for (let i = 0; i < func.argument_ids.length; ++i) {
      const arg = analyse_expression(state, exp.arguments[i].value, scope);
      const arg_def = state.types.get(func.argument_ids[i]);
      invariant(arg_def.__type === 'Function_argument');

      // FIXME: remove!
      if (arg.type == null) continue;

      invariant(arg.type.id === arg_def.type.id);
    }

    const func_def = state.types.get(spec.id);
    return {type: func_def.return_type};
  }

  if (exp.__type === 'Collection_literal') {
    if (exp.dataType === 'set') {
      return {type: state.builtins.set};
    }
    if (exp.dataType === 'vec') {
      return {type: state.builtins.vec};
    }
    invariant(false);
  }

  if (exp.__type === 'Binary_operation') {
    const left_op = analyse_expression(state, exp.left_operand, scope, refims);

    if (exp.operation === '&&') {
      invariant(left_op.type.id == state.builtins.bool.id);

      const right_refinements = merge_refinements(
          'Intersection',
          left_op.refinements,
          left_op.conditional_refinements);
      const right_op = analyse_expression(state, exp.right_operand,
          scope, right_refinements);
      invariant(right_op.type.id == state.builtins.bool.id);
      const refinements = merge_refinements(
          'Union',
          left_op.refinements,
          right_op.refinements);
      const conditional_refinements = merge_refinements(
          'Intersection',
          left_op.conditional_refinements,
          right_op.conditional_refinements);

      return {type: state.builtins.bool, refinements, conditional_refinements};
    }

    if (exp.operation === '||') {
      invariant(left_op.type.id == state.builtins.bool.id);

      const right_op = analyse_expression(state, exp.right_operand,
          scope, left_op.refinements);
      invariant(right_op.type.id == state.builtins.bool.id);
      const refinements = merge_refinements(
          'Union',
          left_op.refinements,
          right_op.refinements);
      const conditional_refinements = merge_refinements(
          'Union',
          left_op.conditional_refinements,
          right_op.conditional_refinements);

      return {type: state.builtins.bool, refinements, conditional_refinements};
    }

    const right_op = analyse_expression(state, exp.right_operand,
        scope, refims);

    switch (exp.operation) {
    case '+':
    case '-': {
      if (
        exp.operation === '+' &&
        (left_op.type.id === state.builtins.str.id || left_op.type.id === state.builtins.char.id) &&
        (right_op.type.id === state.builtins.str.id || right_op.type.id === state.builtins.char.id)
      ) {
        return {type: state.builtins.str};
      }
      invariant(left_op.type.id === right_op.type.id);
      const spec = state.types.get(left_op.type.id);
      invariant(spec.__type === 'BuiltinType' && spec.is_number);
      return {type: left_op.type};
    }

    case '<':
    case '<=':
    case '>':
    case '>=':
    case '==':
    case '!=': {
      invariant(left_op.type.id === right_op.type.id);
      return {type: state.builtins.bool};
    }

    case '=': {
      invariant(left_op.type.id === right_op.type.id);
      invariant(left_op.reference != null);
      return {type: left_op.type, reference: left_op.reference};
    }

    default:
      throw new Error(`unknown bin op "${exp.operation}"`);
    }
  }

  if (exp.__type === 'Object_literal') {
    const spec = resolve_qualified_name(state, scope, exp.typeName, refims);
    invariant(spec.__type === 'Type');
    const type = state.types.get(spec.id);
    if (type.__type === 'Enum_variant') {
      return {type: {id: type.enum_id}};
    }
    if (type.__type === 'Struct') {
      return {type: {id: spec.id}};
    }
    throw new Error(`invalid constructor "${exp.typeName.join('.')}"`);
  }

  if (exp.__type === 'Collection_access') {
    const spec = resolve_qualified_name(state, scope, exp.collectionName, refims);
    const key = analyse_expression(state, exp.key, scope);
    invariant(spec.__type === 'Reference');
    if (spec.type.id === state.builtins.vec.id) {
      invariant(key.type.id === state.builtins.u32.id);
      return {type: spec.type.parameters[0]};
    }
    if (spec.type.id === state.builtins.str.id) {
      invariant(key.type.id === state.builtins.u32.id);
      return {type: state.builtins.char};
    }
    throw new Error(`invalid collection access on "${exp.collectionName.join('.')}"`);
  }
  throw new Error(`unknown "${exp.__type}"`);
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
      result.set(value_id, entry);
      continue;
    }
    result.set(value_id, merge_refinement_entry(method, entry, right_entry));
  }
  for (const [value_id, right_entry] of right_refims.entries()) {
    if (result.has(value_id)) continue;
    result.set(value_id, right_entry);
  }
  return result;
}

function merge_refinement_entry(method, entry, right_entry) {
  invariant(method === 'Intersection' || method === 'Union');

  let variants_ids;

  if (entry.variant_ids != null && right_entry.variant_ids == null) {
    if (method === 'Intersection') ({variant_ids} = entry);
  } else if (entry.variant_ids == null && right_entry.variant_ids != null) {
    if (method === 'Intersection') ({variant_ids} = right_entry);
  } else if (entry.variant_ids != null && right_entry.variant_ids != null) {
    const possible_ids = new Set(entry.variant_ids);
    if (method === 'Union') {
      for (const id of right_entry.variant_ids) {
        possible_ids.add(id);
      }
      variant_ids = Array.from(possible_ids);
    } else {
      variant_ids = [];
      for (const id of right_entry.variant_ids) {
        if (possible_ids.has(id)) {
          variant_ids.push(id);
        }
      }
      invariant(variant_ids.length > 0);
    }
  }

  const fields = new Map();
  for (const [name, field] of entry.fields.entries()) {
    const right_field = right_entry.get(name);
    if (right_field == null) {
      fields.set(name, field);
      continue;
    }
    fields.set(value_id, merge_refinement_entry(method, field, right_field));
  }
  for (const [name, right_field] of right_refims.fields.entries()) {
    if (fields.has(name)) continue;
    fields.set(name, right_field);
  }

  return {variant_ids, fields};
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

  const ref = resolve_name(scope, name[0]);
  if (ref == null) throw new Error(`unknown name "${name}"`);

  if (ref.__type === 'Type' || ref.__type === 'Function') {
    return ref;
  }
  invariant(ref.__type === 'Value_reference');
  const value_id = ref.id;
  const path = [];
  let {type} = ref;
  let refim = refims && refims.get(value_id);
  for (let i = 1; i < name.length; ++i) {
    const type_spec = state.types.get(type.id);
    const field_name = name[i];

    if (type_spec.__type === 'Struct') {
      const field_spec = type_spec.fields.get(field_name);
      if (field_spec == null) throw new Error(`cannot find field "${field_name}"`);
      ({type} = field_spec);
      refim = refim && refim.fields && refim.fields.get(field_name);
      path.push({__type: 'Field', name: field_name});
      continue;
    }

    if (type_spec.__type === 'Enum' && refim && refim.variant_ids != null) {
      invariant(refim.variant_ids.length === 1);
      const variant_spec = state.types.get(refim.variant_ids[0]);
      invariant(variant_spec.__type === 'Enum_variant');

      const field_spec = variant_spec.fields.get(field_name);
      if (field_spec == null) throw new Error(`cannot find field "${field_name}"`);
      ({type} = field_spec);
      refim = refim && refim.fields && refim.fields.get(field_name);
      path.push({__type: 'Field', name: field_name});
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


function writeStatement(statement, indent) {
  if (statement.__type === 'Variable_declaration') {
    write(`let ${statement.name} = `);
    writeExpression(statement.initialValue);
    write(';');
    return;
  }
  if (statement.__type === 'Expression') {
    writeExpression(statement.value);
    write(';');
    return;
  }
  if (statement.__type === 'While_loop') {
    write(`while (`);
    writeExpression(statement.condition);
    write(') ');
    writeStatement(statement.body, indent);
    return;
  }
  if (statement.__type === 'If') {
    write(`if (`);
    writeExpression(statement.condition);
    write(') ');
    writeStatement(statement.consequent, indent);
    if (statement.alternate) {
      write(' else ');
      writeStatement(statement.alternate, indent);
    }
    return;
  }
  if (statement.__type === 'Block') {
    write('{\n');
    for (const subStatement of statement.statements) {
      write(indent + '  ');
      writeStatement(subStatement, indent + '  ');
      write('\n');
    }
    write(`${indent}}`);
    return;
  }
  if (statement.__type === 'Return') {
    write('return ');
    writeExpression(statement.value);
    write(';');
    return;
  }
  write(`UNKNOWN_STATEMENT_${statement.__type};`);
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
    if (expression.functionName[0] === '__zero') {
      write('0');
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
    } else {
      write(`__${expression.functionName.join('.')}(`);
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
  if (expression.__type === 'Bool_literal') {
    write(JSON.stringify(expression.value));
    return;
  }
  if (expression.__type === 'Object_literal') {
    write('{');
    for (const field of expression.fields) {
      write(field.name);
      write(': ');
      if (field.is_shorthand) {
        writeExpression({__type: 'Qualified_name', value: [field.name]});
      } else {
        writeExpression(field.value);
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

function readModule(state) {
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

function read_type_name(state) {
  let name;
  if (has_keyword(state, 'set') || has_keyword(state, 'vec')
      || has_keyword(state, 'dict')) {
    name = [state.token.value];
    read_token(state);
  } else {
    name = read_qualified_name(state);
  }
  const parameters = [];
  if (has_operator(state, '<')) {
    read_token(state);
    while (!has_operator(state, '>')) {
      parameters.push(read_type_name(state));
      if (has_operator(state, ',')) {
        read_token(state);
      }
    }
    invariant(has_operator(state, '>'));
    read_token(state);
  }
  return {name, parameters};
}

function has_identifier(state) {
  return state.token.__type === 'Identifier';
}

main();
