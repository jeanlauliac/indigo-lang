// GENERATED, DO NOT EDIT

module.exports.read_primary_expression = __read_primary_expression;
function __read_primary_expression(state, __read_expression, ) {
  if (identity_test(state.token, "String_literal")) {
    let value = state.token.value;
    __read_token(state, );
    return {value: value, __type: "String_literal"};
  }
  if (identity_test(state.token, "Character_literal")) {
    let value = state.token.value;
    __read_token(state, );
    return {value: value, __type: "Character_literal"};
  }
  if (__has_keyword(clone(state), clone("true"), )) {
    __read_token(state, );
    return {value: true, __type: "Bool_literal"};
  }
  if (__has_keyword(clone(state), clone("false"), )) {
    __read_token(state, );
    return {value: false, __type: "Bool_literal"};
  }
  if (__has_operator(clone(state), clone("++"), )) {
    let operator = state.token.value;
    __read_token(state, );
    let target = __read_primary_expression(state, clone(__read_expression), );
    return {operator: operator, target: target, is_prefix: true, __type: "In_place_assignment"};
  }
  if (__has_operator(clone(state), clone("!"), )) {
    let operator = state.token.value;
    __read_token(state, );
    let operand = __read_primary_expression(state, clone(__read_expression), );
    return {operator: operator, operand: operand, __type: "Unary_operation"};
  }
  if ((__has_keyword(clone(state), clone("set"), ) || __has_keyword(clone(state), clone("vec"), ))) {
    let dataType = state.token.value;
    __read_token(state, );
    __invariant(clone(__has_operator(clone(state), clone("["), )), );
    __read_token(state, );
    let values = [];
    while (!__has_operator(clone(state), clone("]"), )) {
      let expression = __read_expression(state, );
      (values.push(expression));
      if (__has_operator(clone(state), clone(","), )) {
        __read_token(state, );
      } else {
        __invariant(clone(__has_operator(clone(state), clone("]"), )), );
      }
    }
    __read_token(state, );
    return {dataType: dataType, values: values, __type: "Collection_literal"};
  }
  let qualified_name = {__type: "None"};
  if (__has_identifier(clone(state), )) {
    (qualified_name = __read_qualified_name(state, ));
  }
  if (__has_operator(clone(state), clone("{"), )) {
    __read_token(state, );
    let fields = [];
    while (__has_identifier(clone(state), )) {
      let name = state.token.value;
      __read_token(state, );
      let is_shorthand = !__has_operator(clone(state), clone(":"), );
      let value = {__type: "None"};
      if (!is_shorthand) {
        __read_token(state, );
        (value = __read_expression(state, ));
      }
      if (__has_operator(clone(state), clone(","), )) {
        __read_token(state, );
      } else {
        __invariant(clone(__has_operator(clone(state), clone("}"), )), );
      }
      (fields.push({name: name, value: value, is_shorthand: is_shorthand, }));
    }
    __invariant(clone(__has_operator(clone(state), clone("}"), )), );
    __read_token(state, );
    return {typeName: qualified_name, fields: fields, __type: "Object_literal"};
  }
  __invariant(clone(!identity_test(qualified_name, "None")), );
  if (__has_operator(clone(state), clone("["), )) {
    __read_token(state, );
    let key = __read_expression(state, );
    __invariant(clone(__has_operator(clone(state), clone("]"), )), );
    __read_token(state, );
    return {collectionName: qualified_name, key: key, __type: "Collection_access"};
  }
  if (__has_operator(clone(state), clone("("), )) {
    __read_token(state, );
    let arguments = [];
    while (!__has_operator(clone(state), clone(")"), )) {
      (arguments.push(__read_call_argument(state, clone(__read_expression), )));
      if (__has_operator(clone(state), clone(","), )) {
        __read_token(state, );
      } else {
        __invariant(clone(__has_operator(clone(state), clone(")"), )), );
      }
    }
    __read_token(state, );
    return {functionName: qualified_name, arguments: arguments, __type: "Function_call"};
  }
  return {value: qualified_name, __type: "Qualified_name"};
}

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
  let KEYWORDS = new Set(["let", "fn", "ref", "while", "true", "false", "set", "dict", "vec", "if", "else", "is", "isnt", "return", "enum", "struct", ]);
  let value = access(state.code, state.i);
  ++state.i;
  while (((state.i < state.code.length) && __is_alphanumeric(clone(access(state.code, state.i)), ))) {
    (value = (value + access(state.code, state.i)));
    ++state.i;
  }
  if ((KEYWORDS.has(value))) {
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
  __invariant(clone((((code === "\\") || (code === "'")) || (code === "\""))), );
  return code;
}

module.exports.invariant = __invariant;
function __invariant(cond, ) {
  if (!cond) throw new Error(clone("invariant failed"), );
}

function clone(v) {
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
