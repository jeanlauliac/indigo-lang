'use strict';

module.exports = invariant;
function invariant(cond) {
  if (!cond) throw new Error("invariant failed");
}
