'use strict';

module.exports = resolve_name;
function resolve_name(scope, name) {
  let spec = scope.names && scope.names.get(name);
  while (spec == null && scope.parent != null) {
    scope = scope.parent;
    spec = scope.names && scope.names.get(name);
  }
  return spec;
}
