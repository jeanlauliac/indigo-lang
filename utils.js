#!/usr/bin/env node

module.exports.main = function __main() {
  let code = (require('fs').readFileSync)(clone("./clover_comp.clv"), );
  let state = {code: code, phase: "module", token: {__type: "None"}, next_token: {__type: "None"}, };
  __read_token(state, );
  __read_token(state, );
  let module = __read_module(state, );
  process.stdout.write(clone("#!/usr/bin/env node\\n\\n"), );
}

module.exports.read_module = function __read_module(state, ) {
  let module = {functions: [], };
  while (!identity_test(state.token, "End_of_file")) {
    __read_module_declaration(state, module, );
  }
  return module;
}

module.exports.has_keyword = function __has_keyword(state, value, ) {
  return (identity_test(state.token, "Keyword") && (state.token.value === value));
}

module.exports.has_operator = function __has_operator(state, value, ) {
  return (identity_test(state.token, "Operator") && (state.token.value === value));
}

module.exports.read_token = function __read_token(state, ) {
  let whitespace = new Set([" ", "\n", ]);
  while (((state.i < state.code.length) && access(whitespace, access(state.code, state.i)))) {
    ++state.i;
  }
  let token = {__type: "None"};
  if ((state.i === state.code.length)) {
    (token = {__type: "End_of_file"});
  } else if (true) {
    (token = {value: access(state.code, state.i), __type: "Identifier"});
    ++state.i;
  } else {
    (token = {__type: "Invalid"});
  }
  (state.token = state.next_token);
  (state.next_token = token);
}

function clone(v) {
  if (v == null) return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.map(a => clone(a));
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
