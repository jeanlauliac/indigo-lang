'use strict';

const invariant = require('./invariant');

module.exports = merge_refinements;
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

  const new_fields = new Map();
  for (const [name, field] of fields.entries()) {
    const right_field = right_fields.get(name);
    if (right_field == null) {
      new_fields.set(name, field);
      continue;
    }
    const new_field = merge_refinement_entry(method, field, right_field);
    if (new_field != null)
      new_fields.set(value_id, new_field);
  }
  for (const [name, right_field] of right_fields.entries()) {
    if (fields.has(name)) continue;
    new_fields.set(name, right_field);
  }

  return new_fields;
}
