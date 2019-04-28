// GENERATED, DO NOT EDIT

module.exports.read_qualified_name = __read_qualified_name;
function __read_qualified_name(state, ) {
  __invariant(clone(__has_identifier(clone(state), )), );
  let qualifiedName = [state.token.value, ];
  __read_token(state, );
  while (__has_operator(clone(state), clone("."), )) {
    __read_token(state, );
    __invariant(clone(__has_identifier(clone(state), )), );
    (qualifiedName.push(state.token.value));
    __read_token(state, );
  }
  return qualifiedName;
}

module.exports.read_call_argument = __read_call_argument;
function __read_call_argument(state, __read_expression, ) {
  if (__has_operator(clone(state), clone("&"), )) {
    __read_token(state, );
    __invariant(clone(__has_identifier(state, )), );
    let name = state.token.value;
    __read_token(state, );
    return {name: name, __type: "Reference"};
  }
  return {value: __read_expression(state, ), __type: "Expression"};
}

module.exports.has_keyword = __has_keyword;
function __has_keyword(state, value, ) {
  return (identity_test(state.token, "Keyword") && (state.token.value === value));
}

module.exports.has_operator = __has_operator;
function __has_operator(state, value, ) {
  return (identity_test(state.token, "Operator") && (state.token.value === value));
}

module.exports.has_identifier = __has_identifier;
function __has_identifier(state, ) {
  return identity_test(state.token, "Identifier");
}

module.exports.read_token = __read_token;
function __read_token(state, ) {
  __read_whitespace(state, );
  (state.token = state.nextToken);
  (state.nextToken = __read_next_token(state, ));
}

module.exports.read_next_token = __read_next_token;
function __read_next_token(state, ) {
  if ((state.i === state.code.length)) {
    return {__type: "End_of_file"};
  }
  if (__is_alpha(clone(access(state.code, state.i)), )) {
    return __read_identifier(state, );
  }
  let OPERATOR_PREFIXES = new Set(["|", "(", ")", "{", "}", "=", ";", ":", ",", ".", "&", "<", ">", "/", "*", "+", "[", "]", "!", "-", ]);
  if ((OPERATOR_PREFIXES.has(access(state.code, state.i)))) {
    return __read_operator(state, );
  }
  if ((access(state.code, state.i) === "\"")) {
    return __read_string_literal(state, );
  }
  if ((access(state.code, state.i) === "'")) {
    return __read_character_literal(state, );
  }
  throw new Error(clone((("unexpected character '" + access(state.code, state.i)) + "'")), );
}

module.exports.read_whitespace = __read_whitespace;
function __read_whitespace(state, ) {
  let whitespace = new Set([" ", "\n", ]);
  while (((state.i < state.code.length) && (whitespace.has(access(state.code, state.i))))) {
    ++state.i;
  }
}

module.exports.read_identifier = __read_identifier;
function __read_identifier(state, ) {
  let KEYWORKS = new Set(["let", "fn", "ref", "while", "true", "false", "set", "dict", "vec", "if", "else", "is", "isnt", "return", ]);
  let value = access(state.code, state.i);
  ++state.i;
  while (((state.i < state.code.length) && __is_alphanumeric(clone(access(state.code, state.i)), ))) {
    (value = (value + access(state.code, state.i)));
    ++state.i;
  }
  if ((KEYWORKS.has(value))) {
    return {value: value, __type: "Keyword"};
  }
  return {value: value, __type: "Identifier"};
}

module.exports.is_alphanumeric = __is_alphanumeric;
function __is_alphanumeric(c, ) {
  return (__is_alpha(clone(c), ) || ((c >= "0") && (c <= "9")));
}

module.exports.is_alpha = __is_alpha;
function __is_alpha(c, ) {
  return (((c === "_") || ((c >= "a") && (c <= "z"))) || ((c >= "A") && (c <= "Z")));
}

module.exports.read_operator = __read_operator;
function __read_operator(state, ) {
  let OPERATORS = new Set(["&&", "++", "==", "!=", "||", ">=", "<=", ]);
  let value = access(state.code, state.i);
  ++state.i;
  if ((OPERATORS.has((value + access(state.code, state.i))))) {
    (value = (value + access(state.code, state.i)));
    ++state.i;
  }
  return {value: value, __type: "Operator"};
}

module.exports.read_string_literal = __read_string_literal;
function __read_string_literal(state, ) {
  ++state.i;
  let value = "";
  while (((state.i < state.code.length) && (access(state.code, state.i) !== "\""))) {
    if ((access(state.code, state.i) === "\\")) {
      ++state.i;
      (value = (value + __get_escaped_char(clone(access(state.code, state.i)), )));
    } else {
      (value = (value + access(state.code, state.i)));
    }
    ++state.i;
  }
  __invariant(clone((state.i < state.code.length)), );
  let token = {value: value, __type: "String_literal"};
  ++state.i;
  return token;
}

module.exports.read_character_literal = __read_character_literal;
function __read_character_literal(state, ) {
  ++state.i;
  __invariant(clone((state.i < state.code.length)), );
  let value = "";
  if ((access(state.code, state.i) === "\\")) {
    ++state.i;
    __invariant(clone((state.i < state.code.length)), );
    (value = __get_escaped_char(clone(access(state.code, state.i)), ));
  } else {
    (value = access(state.code, state.i));
  }
  ++state.i;
  __invariant(clone(((state.i < state.code.length) && (access(state.code, state.i) === "'"))), );
  ++state.i;
  return {value: value, __type: "Character_literal"};
}

module.exports.get_escaped_char = __get_escaped_char;
function __get_escaped_char(code, ) {
  if ((code === "n")) {
    return "\n";
  }
  if ((((code === "\\") || (code === "'")) || (code === "\""))) {
    return code;
  }
  __invariant(clone(false), );
}

module.exports.invariant = __invariant;
function __invariant(cond, ) {
  if (!cond) throw new Error(clone("invariant failed"), );
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
