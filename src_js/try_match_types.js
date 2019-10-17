'use strict';

module.exports = try_match_types;
function try_match_types(state, actual_type, expected_type, settled_type_parameters) {
  if (actual_type.id !== expected_type.id) {
    const type_def = state.types.get(expected_type.id);
    if (type_def.__type !== 'Function_type_parameter') {
      return {__type: 'Mismatch'};
    }

    const settled_type = settled_type_parameters.get(expected_type.id);
    if (settled_type == null) {
      settled_type_parameters.set(expected_type.id, actual_type);
      return {__type: 'Match'};
    }
    expected_type = settled_type;
    if (actual_type.id !== expected_type.id) {
      return {__type: 'Mismatch'};
    }
  }

  if (actual_type.parameters.length !== expected_type.parameters.length) {
    return {__type: 'Mismatch'};
  }

  for (let i = 0; i < actual_type.parameters.length; ++i) {
    const res = try_match_types(state, actual_type.parameters[i],
        expected_type.parameters[i], settled_type_parameters);
    if (res.__type !== 'Match') return res;
  }
  return {__type: 'Match'};
}
