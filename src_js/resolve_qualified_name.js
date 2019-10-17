'use strict';

const invariant = require('./invariant');
const resolve_name = require('./resolve_name');

module.exports = resolve_qualified_name;
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
