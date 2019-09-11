// GENERATED, DO NOT EDIT

module.exports.__read_expression = __read_expression;
function __read_expression(state, ) {
}

module.exports.read_primary_expression = read_primary_expression;
function read_primary_expression(state, ) {
  if (identity_test(state.token, "String")) {
    let value = state.token.value;
    read_token(state, );
    return {value: value, __type: "String_literal"};
  }
  if (identity_test(state.token, "Number")) {
    let value = state.token.value;
    read_token(state, );
    return {value: value, __type: "Number_literal"};
  }
  if (identity_test(state.token, "Character")) {
    let value = state.token.value;
    read_token(state, );
    return {value: value, __type: "Character_literal"};
  }
  if (has_keyword(clone(state), clone("true"), )) {
    read_token(state, );
    return {value: true, __type: "Bool_literal"};
  }
  if (has_keyword(clone(state), clone("false"), )) {
    read_token(state, );
    return {value: false, __type: "Bool_literal"};
  }
  if (has_operator(clone(state), clone("("), )) {
    read_token(state, );
    let expression = global.__read_expression(state, );
    invariant(clone(has_operator(clone(state), clone(")"), )), );
    read_token(state, );
    return expression;
  }
  if ((identity_test(state.token, "Operator") && has_operator(clone(state), clone("++"), ))) {
    let operator = state.token.value;
    read_token(state, );
    let target = read_primary_expression(state, );
    return {operator: operator, operation: "++", target: target, is_prefix: true, __type: "In_place_assignment"};
  }
  if ((identity_test(state.token, "Operator") && (has_operator(clone(state), clone("!"), ) || has_operator(clone(state), clone("-"), )))) {
    let operator = state.token.value;
    read_token(state, );
    let operand = read_primary_expression(state, );
    return {operator: operator, operand: operand, __type: "Unary_operation"};
  }
  if ((identity_test(state.token, "Keyword") && (has_keyword(clone(state), clone("set"), ) || has_keyword(clone(state), clone("vec"), )))) {
    let dataType = state.token.value;
    read_token(state, );
    let item_type = {name: [], parameters: [], };
    if (has_operator(clone(state), clone("<"), )) {
      read_token(state, );
      item_type = read_type_name(state, );
      invariant(clone(has_operator(clone(state), clone(">"), )), );
      read_token(state, );
    }
    invariant(clone(has_operator(clone(state), clone("["), )), );
    read_token(state, );
    let values = [];
    while (!has_operator(clone(state), clone("]"), )) {
      let expression = global.__read_expression(state, );
      (values.push(expression));
      if (has_operator(clone(state), clone(","), )) {
        read_token(state, );
      } else {
        invariant(clone(has_operator(clone(state), clone("]"), )), );
      }
    }
    read_token(state, );
    return {dataType: dataType, item_type: item_type, values: values, __type: "Collection_literal"};
  }
  let qualified_name = [];
  if (identity_test(state.token, "Identifier")) {
    qualified_name = read_qualified_name(state, );
  }
  if (has_operator(clone(state), clone("{"), )) {
    read_token(state, );
    let fields = [];
    while (identity_test(state.token, "Identifier")) {
      let name = state.token.value;
      read_token(state, );
      let value = read_object_field_value(state, );
      if (has_operator(clone(state), clone(","), )) {
        read_token(state, );
      } else {
        invariant(clone(has_operator(clone(state), clone("}"), )), );
      }
      (fields.push({name: name, value: value, }));
    }
    invariant(clone(has_operator(clone(state), clone("}"), )), );
    read_token(state, );
    return {typeName: qualified_name, fields: fields, __type: "Object_literal"};
  }
  invariant(clone(((qualified_name).length > 0)), );
  if (has_operator(clone(state), clone("["), )) {
    read_token(state, );
    let key = global.__read_expression(state, );
    invariant(clone(has_operator(clone(state), clone("]"), )), );
    read_token(state, );
    return {collectionName: qualified_name, key: key, __type: "Collection_access"};
  }
  if (has_operator(clone(state), clone("("), )) {
    read_token(state, );
    let arguments = [];
    while (!has_operator(clone(state), clone(")"), )) {
      (arguments.push(read_call_argument(state, )));
      if (has_operator(clone(state), clone(","), )) {
        read_token(state, );
      } else {
        invariant(clone(has_operator(clone(state), clone(")"), )), );
      }
    }
    read_token(state, );
    return {functionName: qualified_name, arguments: arguments, __type: "Function_call"};
  }
  return {value: qualified_name, __type: "Qualified_name"};
}

module.exports.read_qualified_name = read_qualified_name;
function read_qualified_name(state, ) {
  invariant(clone(identity_test(state.token, "Identifier")), );
  let qualifiedName = [];
  if (identity_test(state.token, "Identifier")) {
    qualifiedName = [state.token.value, ];
  }
  read_token(state, );
  while (has_operator(clone(state), clone("."), )) {
    read_token(state, );
    invariant(clone(identity_test(state.token, "Identifier")), );
    if (identity_test(state.token, "Identifier")) {
      (qualifiedName.push(state.token.value));
    }
    read_token(state, );
  }
  return qualifiedName;
}

module.exports.read_object_field_value = read_object_field_value;
function read_object_field_value(state, ) {
  if (!has_operator(clone(state), clone(":"), )) {
    return {__type: "Shorthand_field_value"};
  }
  read_token(state, );
  return {expression: global.__read_expression(state, ), __type: "Expression_field_value"};
}

module.exports.read_call_argument = read_call_argument;
function read_call_argument(state, ) {
  let is_by_reference = false;
  if (has_operator(clone(state), clone("&"), )) {
    read_token(state, );
    is_by_reference = true;
  }
  return {value: global.__read_expression(state, ), is_by_reference: is_by_reference, };
}

module.exports.read_type_name = read_type_name;
function read_type_name(state, ) {
  let name = [];
  if ((identity_test(state.token, "Keyword") && ((has_keyword(clone(state), clone("set"), ) || has_keyword(clone(state), clone("vec"), )) || has_keyword(clone(state), clone("dict"), )))) {
    name = [state.token.value, ];
    read_token(state, );
  } else {
    name = read_qualified_name(state, );
  }
  let parameters = [];
  if (has_operator(clone(state), clone("<"), )) {
    read_token(state, );
    while (!has_operator(clone(state), clone(">"), )) {
      (parameters.push(read_type_name(state, )));
      if (has_operator(clone(state), clone(","), )) {
        read_token(state, );
      }
    }
    invariant(clone(has_operator(clone(state), clone(">"), )), );
    read_token(state, );
  }
  return {name: name, parameters: parameters, };
}

module.exports.has_keyword = has_keyword;
function has_keyword(state, value, ) {
  return (identity_test(state.token, "Keyword") && (state.token.value === value));
}

module.exports.has_operator = has_operator;
function has_operator(state, value, ) {
  return (identity_test(state.token, "Operator") && (state.token.value === value));
}

module.exports.read_token = read_token;
function read_token(state, ) {
  tokens$read_whitespace(state, );
  state.token = tokens$read_next(state, );
}

module.exports.invariant = invariant;
function invariant(cond, ) {
  if (!cond) throw new Error(clone("invariant failed"), );
}

module.exports.tokens$read_next = tokens$read_next;
function tokens$read_next(state, ) {
  if ((state.i === (state.code).length)) {
    return {__type: "End_of_file"};
  }
  if (tokens$is_alpha(clone(access(state.code, state.i)), )) {
    return tokens$read_identifier(state, );
  }
  if (tokens$is_numeric(clone(access(state.code, state.i)), )) {
    return tokens$read_number(state, );
  }
  let OPERATOR_PREFIXES = new Set(["|", "(", ")", "{", "}", "=", ";", ":", ",", ".", "&", "<", ">", "/", "*", "+", "[", "]", "!", "-", ]);
  if ((OPERATOR_PREFIXES.has(access(state.code, state.i)))) {
    return tokens$read_operator(state, );
  }
  if ((access(state.code, state.i) === "\"")) {
    return tokens$read_string_literal(state, );
  }
  if ((access(state.code, state.i) === "'")) {
    return tokens$read_character_literal(state, );
  }
  throw new Error(clone((("unexpected character '" + access(state.code, state.i)) + "'")), );
}

module.exports.tokens$read_whitespace = tokens$read_whitespace;
function tokens$read_whitespace(state, ) {
  let whitespace = new Set([" ", "\n", ]);
  while (((state.i < (state.code).length) && (whitespace.has(access(state.code, state.i))))) {
    ++state.i;
  }
}

module.exports.tokens$read_identifier = tokens$read_identifier;
function tokens$read_identifier(state, ) {
  let keywords = new Set(["let", "fn", "ref", "while", "true", "false", "set", "dict", "vec", "if", "else", "is", "isnt", "return", "enum", "struct", ]);
  let value = ("" + access(state.code, state.i));
  ++state.i;
  while (((state.i < (state.code).length) && tokens$is_alphanumeric(clone(access(state.code, state.i)), ))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  if ((keywords.has(value))) {
    return {value: value, __type: "Keyword"};
  }
  return {value: value, __type: "Identifier"};
}

module.exports.tokens$read_number = tokens$read_number;
function tokens$read_number(state, ) {
  let value = ("" + access(state.code, state.i));
  ++state.i;
  while (((state.i < (state.code).length) && tokens$is_numeric(clone(access(state.code, state.i)), ))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  return {value: value, __type: "Number"};
}

module.exports.tokens$is_alphanumeric = tokens$is_alphanumeric;
function tokens$is_alphanumeric(c, ) {
  return (tokens$is_alpha(clone(c), ) || tokens$is_numeric(clone(c), ));
}

module.exports.tokens$is_alpha = tokens$is_alpha;
function tokens$is_alpha(c, ) {
  return (((c === "_") || ((c >= "a") && (c <= "z"))) || ((c >= "A") && (c <= "Z")));
}

module.exports.tokens$read_operator = tokens$read_operator;
function tokens$read_operator(state, ) {
  let operators = new Set(["&&", "++", "==", "!=", "||", ">=", "<=", ]);
  let value = ("" + access(state.code, state.i));
  ++state.i;
  if (((state.i < (state.code).length) && (operators.has((value + access(state.code, state.i)))))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  return {value: value, __type: "Operator"};
}

module.exports.tokens$read_string_literal = tokens$read_string_literal;
function tokens$read_string_literal(state, ) {
  ++state.i;
  let value = "";
  while (((state.i < (state.code).length) && (access(state.code, state.i) !== "\""))) {
    if ((access(state.code, state.i) === "\\")) {
      ++state.i;
      value = (value + tokens$get_escaped_char(clone(access(state.code, state.i)), ));
    } else {
      value = (value + access(state.code, state.i));
    }
    ++state.i;
  }
  invariant(clone((state.i < (state.code).length)), );
  let token = {value: value, __type: "String"};
  ++state.i;
  return token;
}

module.exports.tokens$read_character_literal = tokens$read_character_literal;
function tokens$read_character_literal(state, ) {
  ++state.i;
  invariant(clone((state.i < (state.code).length)), );
  let value = " ";
  if ((access(state.code, state.i) === "\\")) {
    ++state.i;
    invariant(clone((state.i < (state.code).length)), );
    value = tokens$get_escaped_char(clone(access(state.code, state.i)), );
  } else {
    value = access(state.code, state.i);
  }
  ++state.i;
  invariant(clone(((state.i < (state.code).length) && (access(state.code, state.i) === "'"))), );
  ++state.i;
  return {value: value, __type: "Character"};
}

module.exports.tokens$is_numeric = tokens$is_numeric;
function tokens$is_numeric(c, ) {
  return ((c >= "0") && (c <= "9"));
}

module.exports.tokens$get_escaped_char = tokens$get_escaped_char;
function tokens$get_escaped_char(code, ) {
  if ((code === "n")) {
    return "\n";
  }
  invariant(clone((((code === "\\") || (code === "'")) || (code === "\""))), );
  return code;
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
