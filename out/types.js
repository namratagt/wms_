"use strict";
// Shared type definitions and small key helpers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.squareKey = squareKey;
exports.spaceTimeKey = spaceTimeKey;
exports.moveKey = moveKey;
exports.sameSquare = sameSquare;
exports.sq = sq;
// ---- key helpers ----
function squareKey(s) {
    return `${s[0]},${s[1]}`;
}
function spaceTimeKey(s, t) {
    return `${s[0]},${s[1]}@${t}`;
}
function moveKey(from, to, t) {
    return `${from[0]},${from[1]}>${to[0]},${to[1]}@${t}`;
}
function sameSquare(a, b) {
    return a[0] === b[0] && a[1] === b[1];
}
function sq(r, c) {
    return [r, c];
}
