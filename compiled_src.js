"use strict";
// GENERATED, DO NOT EDIT

module.exports.__read_expression = __read_expression;
function __read_expression(state, ) {
}

module.exports.read_primary_expression = read_primary_expression;
function read_primary_expression(state, ) {
  if ((state.token.__type === "String")) {
    let value = state.token.value;
    read_token(state);
    return {value: value, __type: "String_literal", };
  }
  if ((state.token.__type === "Number")) {
    let value = state.token.value;
    read_token(state);
    return {value: value, __type: "Number_literal", };
  }
  if ((state.token.__type === "Character")) {
    let value = state.token.value;
    read_token(state);
    return {value: value, __type: "Character_literal", };
  }
  if (has_keyword(state, "true")) {
    read_token(state);
    return {value: true, __type: "Bool_literal", };
  }
  if (has_keyword(state, "false")) {
    read_token(state);
    return {value: false, __type: "Bool_literal", };
  }
  if (has_operator(state, "(")) {
    read_token(state);
    let expression = global.__read_expression(state);
    if (!(has_operator(state, ")"))) throw new Error("expect() failed");
    read_token(state);
    return expression;
  }
  if (((state.token.__type === "Operator") && has_operator(state, "++"))) {
    let operator = state.token.value;
    read_token(state);
    let target = read_primary_expression(state);
    return {operator: operator, operation: "++", target: target, is_prefix: true, __type: "In_place_assignment", };
  }
  if (((state.token.__type === "Operator") && (has_operator(state, "!") || has_operator(state, "-")))) {
    let operator = state.token.value;
    read_token(state);
    let operand = read_primary_expression(state);
    return {operator: operator, operand: operand, __type: "Unary_operation", };
  }
  if (((state.token.__type === "Keyword") && (has_keyword(state, "set") || has_keyword(state, "vec")))) {
    let dataType = state.token.value;
    read_token(state);
    let item_type = {name: [], parameters: [], __owner: 109};
    if (has_operator(state, "<")) {
      read_token(state);
      item_type = read_type_name(state);
      if (!(has_operator(state, ">"))) throw new Error("expect() failed");
      read_token(state);
    }
    if (!(has_operator(state, "["))) throw new Error("expect() failed");
    read_token(state);
    let values = [];
    while (!has_operator(state, "]")) {
      let expression = global.__read_expression(state);
      (values.push(expression));
      if (has_operator(state, ",")) {
        read_token(state);
      } else {
        if (!(has_operator(state, "]"))) throw new Error("expect() failed");
      }
    }
    read_token(state);
    return {dataType: dataType, item_type: item_type, values: values, __type: "Collection_literal", };
  }
  let qualified_name = [];
  if ((state.token.__type === "Identifier")) {
    qualified_name = read_qualified_name(state);
  }
  if (has_operator(state, "{")) {
    read_token(state);
    let fields = [];
    while ((state.token.__type === "Identifier")) {
      let name = state.token.value;
      read_token(state);
      let value = read_object_field_value(state);
      if (has_operator(state, ",")) {
        read_token(state);
      } else {
        if (!(has_operator(state, "}"))) throw new Error("expect() failed");
      }
      (fields.push({name: name, value: value, }));
    }
    if (!(has_operator(state, "}"))) throw new Error("expect() failed");
    read_token(state);
    return {typeName: qualified_name, fields: fields, __type: "Object_literal", };
  }
  if (!(((qualified_name).length > 0))) throw new Error("expect() failed");
  if (has_operator(state, "[")) {
    read_token(state);
    let key = global.__read_expression(state);
    if (!(has_operator(state, "]"))) throw new Error("expect() failed");
    read_token(state);
    return {collectionName: qualified_name, key: key, __type: "Collection_access", };
  }
  if (has_operator(state, "(")) {
    read_token(state);
    return {functionName: qualified_name, arguments: read_function_arguments(state), __type: "Function_call", };
  }
  return {value: qualified_name, __type: "Qualified_name", };
}

module.exports.read_function_arguments = read_function_arguments;
function read_function_arguments(state, ) {
  let arguments$ = [];
  while (!has_operator(state, ")")) {
    (arguments$.push(read_call_argument(state)));
    if (has_operator(state, ",")) {
      read_token(state);
    } else {
      if (!(has_operator(state, ")"))) throw new Error("expect() failed");
    }
  }
  read_token(state);
  return arguments$;
}

module.exports.read_qualified_name = read_qualified_name;
function read_qualified_name(state, ) {
  if (!((state.token.__type === "Identifier"))) throw new Error("expect() failed");
  let qualified_name = [state.token.value, ];
  read_token(state);
  while (has_operator(state, ".")) {
    read_token(state);
    if (!((state.token.__type === "Identifier"))) throw new Error("expect() failed");
    (qualified_name.push(state.token.value));
    read_token(state);
  }
  return qualified_name;
}

module.exports.read_object_field_value = read_object_field_value;
function read_object_field_value(state, ) {
  if (!has_operator(state, ":")) {
    return {__type: "Shorthand_field_value", };
  }
  read_token(state);
  return {expression: global.__read_expression(state), __type: "Expression_field_value", };
}

module.exports.read_call_argument = read_call_argument;
function read_call_argument(state, ) {
  let is_by_reference = false;
  if (has_operator(state, "&")) {
    read_token(state);
    is_by_reference = true;
  }
  return {value: global.__read_expression(state), is_by_reference: is_by_reference, };
}

module.exports.read_type_name = read_type_name;
function read_type_name(state, ) {
  let name = [];
  if (((state.token.__type === "Keyword") && ((has_keyword(state, "set") || has_keyword(state, "vec")) || has_keyword(state, "dict")))) {
    name = [state.token.value, ];
    read_token(state);
  } else {
    name = read_qualified_name(state);
  }
  let parameters = [];
  if (has_operator(state, "<")) {
    read_token(state);
    while (!has_operator(state, ">")) {
      (parameters.push(read_type_name(state)));
      if (has_operator(state, ",")) {
        read_token(state);
      }
    }
    if (!(has_operator(state, ">"))) throw new Error("expect() failed");
    read_token(state);
  }
  return {name: name, parameters: parameters, };
}

module.exports.has_keyword = has_keyword;
function has_keyword(state, value, ) {
  return ((state.token.__type === "Keyword") && (state.token.value === value));
}

module.exports.has_operator = has_operator;
function has_operator(state, value, ) {
  return ((state.token.__type === "Operator") && (state.token.value === value));
}

module.exports.read_token = read_token;
function read_token(state, ) {
  tokens$read_whitespace(state);
  state.token = tokens$read_next(state);
}

module.exports.tokens$read_next = tokens$read_next;
function tokens$read_next(state, ) {
  if ((state.i === (state.code).length)) {
    return {__type: "End_of_file", };
  }
  if (tokens$is_alpha(access(state.code, state.i))) {
    return tokens$read_identifier(state);
  }
  if (tokens$is_numeric(access(state.code, state.i))) {
    return tokens$read_number(state);
  }
  let OPERATOR_PREFIXES = new Set(["|", "(", ")", "{", "}", "=", ";", ":", ",", ".", "&", "<", ">", "/", "*", "+", "[", "]", "!", "-", ]);
  if ((OPERATOR_PREFIXES.has(access(state.code, state.i)))) {
    return tokens$read_operator(state);
  }
  if ((access(state.code, state.i) === "\"")) {
    return tokens$read_string_literal(state);
  }
  if ((access(state.code, state.i) === "'")) {
    return tokens$read_character_literal(state);
  }
  throw new Error((("unexpected character '" + access(state.code, state.i)) + "'"));
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
  let keywords = new Set(["let", "fn", "ref", "while", "true", "false", "set", "dict", "vec", "if", "else", "is", "isnt", "return", "enum", "struct", "expect", ]);
  let value = ("" + access(state.code, state.i));
  ++state.i;
  while (((state.i < (state.code).length) && tokens$is_alphanumeric(access(state.code, state.i)))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  if ((keywords.has(value))) {
    return {value: value, __type: "Keyword", };
  }
  return {value: value, __type: "Identifier", };
}

module.exports.tokens$read_number = tokens$read_number;
function tokens$read_number(state, ) {
  let value = ("" + access(state.code, state.i));
  ++state.i;
  while (((state.i < (state.code).length) && tokens$is_numeric(access(state.code, state.i)))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  return {value: value, __type: "Number", };
}

module.exports.tokens$is_alphanumeric = tokens$is_alphanumeric;
function tokens$is_alphanumeric(c, ) {
  return (tokens$is_alpha(c) || tokens$is_numeric(c));
}

module.exports.tokens$is_alpha = tokens$is_alpha;
function tokens$is_alpha(c, ) {
  return (((c === "_") || ((c >= "a") && (c <= "z"))) || ((c >= "A") && (c <= "Z")));
}

module.exports.tokens$read_operator = tokens$read_operator;
function tokens$read_operator(state, ) {
  let operators = new Set(["&&", "++", "==", "!=", "||", ">=", "<=", "->", ]);
  let value = ("" + access(state.code, state.i));
  ++state.i;
  if (((state.i < (state.code).length) && (operators.has((value + access(state.code, state.i)))))) {
    value = (value + access(state.code, state.i));
    ++state.i;
  }
  return {value: value, __type: "Operator", };
}

module.exports.tokens$read_string_literal = tokens$read_string_literal;
function tokens$read_string_literal(state, ) {
  ++state.i;
  let value = "";
  while (((state.i < (state.code).length) && (access(state.code, state.i) !== "\""))) {
    if ((access(state.code, state.i) === "\\")) {
      ++state.i;
      value = (value + tokens$get_escaped_char(access(state.code, state.i)));
    } else {
      value = (value + access(state.code, state.i));
    }
    ++state.i;
  }
  if (!((state.i < (state.code).length))) throw new Error("expect() failed");
  let token = {value: value, __type: "String", __owner: 130};
  ++state.i;
  return token;
}

module.exports.tokens$read_character_literal = tokens$read_character_literal;
function tokens$read_character_literal(state, ) {
  ++state.i;
  if (!((state.i < (state.code).length))) throw new Error("expect() failed");
  let value = " ";
  if ((access(state.code, state.i) === "\\")) {
    ++state.i;
    if (!((state.i < (state.code).length))) throw new Error("expect() failed");
    value = tokens$get_escaped_char(access(state.code, state.i));
  } else {
    value = access(state.code, state.i);
  }
  ++state.i;
  if (!(((state.i < (state.code).length) && (access(state.code, state.i) === "'")))) throw new Error("expect() failed");
  ++state.i;
  return {value: value, __type: "Character", };
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
  if (!((((code === "\\") || (code === "'")) || (code === "\"")))) throw new Error("expect() failed");
  return code;
}

function access(collection, key) {
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

