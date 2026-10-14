"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENTINEL = exports.HEADING_OFFSETS = void 0;
exports.moveStateKey = moveStateKey;
exports.genSuccessors = genSuccessors;
exports.shortestPath = shortestPath;
exports.exitCost = exitCost;
exports.spaceTimeSearch = spaceTimeSearch;
const types_1 = require("./types");
// heading offsets: 0 north, 1 south, 2 west, 3 east
exports.HEADING_OFFSETS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];
exports.SENTINEL = -1;
function moveStateKey(ms) {
    return `${(0, types_1.squareKey)(ms.square)}|${ms.heading}|${ms.turn}`;
}
function genSuccessors(ms, wh, turnCost) {
    const out = [];
    if (ms.turn > 0) {
        // mid-rotation: only stay, reduce counter
        out.push({ square: [ms.square[0], ms.square[1]], heading: ms.heading, turn: ms.turn - 1 });
        return out;
    }
    // wait (same square, same heading, zero turn)
    out.push({ square: [ms.square[0], ms.square[1]], heading: ms.heading, turn: 0 });
    for (let d = 0; d < 4; d++) {
        const off = exports.HEADING_OFFSETS[d];
        const ns = [ms.square[0] + off[0], ms.square[1] + off[1]];
        if (!wh.isWalkable(ns))
            continue;
        if (ms.heading === exports.SENTINEL || ms.heading === d || turnCost <= 0) {
            // drive
            out.push({ square: ns, heading: d, turn: 0 });
        }
        else {
            // begin turn: stay, adopt new heading, turnCost-1
            out.push({ square: [ms.square[0], ms.square[1]], heading: d, turn: turnCost - 1 });
        }
    }
    return out;
}
// shortest path ignoring other robots. Returns Square per tick.
function shortestPath(wh, start, goal, turnCost) {
    if (!wh.isWalkable(start) || !wh.isWalkable(goal))
        return undefined;
    const startMs = { square: [start[0], start[1]], heading: exports.SENTINEL, turn: 0 };
    const visited = new Set();
    visited.add(moveStateKey(startMs));
    const queue = [{ ms: startMs, path: [[start[0], start[1]]] }];
    while (queue.length > 0) {
        const node = queue.shift();
        const ms = node.ms;
        if ((0, types_1.sameSquare)(ms.square, goal)) {
            return node.path.map(s => [s[0], s[1]]);
        }
        for (const succ of genSuccessors(ms, wh, turnCost)) {
            const k = moveStateKey(succ);
            if (visited.has(k))
                continue;
            visited.add(k);
            queue.push({ ms: { square: [succ.square[0], succ.square[1]], heading: succ.heading, turn: succ.turn }, path: node.path.concat([[succ.square[0], succ.square[1]]]) });
        }
    }
    return undefined;
}
// exit cost: fewest ticks to reach a square in a different zone than start's.
function exitCost(wh, start, turnCost) {
    if (!wh.isWalkable(start))
        return 0;
    const startZone = wh.zoneOf(start);
    const startMs = { square: [start[0], start[1]], heading: exports.SENTINEL, turn: 0 };
    const visited = new Set();
    visited.add(moveStateKey(startMs));
    const queue = [{ ms: startMs, depth: 0 }];
    while (queue.length > 0) {
        const node = queue.shift();
        const ms = node.ms;
        if (node.depth > 0 && wh.zoneOf(ms.square) !== startZone) {
            return node.depth;
        }
        for (const succ of genSuccessors(ms, wh, turnCost)) {
            const k = moveStateKey(succ);
            if (visited.has(k))
                continue;
            visited.add(k);
            const sameSq = (0, types_1.sameSquare)(succ.square, ms.square);
            const add = 1; // each successor costs one tick regardless
            queue.push({ ms: { square: [succ.square[0], succ.square[1]], heading: succ.heading, turn: succ.turn }, depth: node.depth + add });
        }
    }
    return 0;
}
function spaceTimeSearch(req) {
    const wh = req.wh;
    if (!wh.isWalkable(req.start) || !wh.isWalkable(req.goal))
        return undefined;
    if (!req.bookings.squareFree(req.start, req.startTick, req.robot))
        return undefined;
    const startMs = { square: [req.start[0], req.start[1]], heading: exports.SENTINEL, turn: 0 };
    const visited = new Set();
    const sk = moveStateKey(startMs) + "@" + req.startTick;
    visited.add(sk);
    const queue = [{ ms: startMs, tick: req.startTick, steps: [{ square: [req.start[0], req.start[1]], tick: req.startTick }] }];
    while (queue.length > 0) {
        const node = queue.shift();
        const ms = node.ms;
        // goal check
        if ((0, types_1.sameSquare)(ms.square, req.goal) && ms.turn === 0) {
            const gzone = wh.zoneOf(ms.square);
            if (req.bookings.zoneWindowFree(gzone, node.tick, node.tick + req.hold, req.robot)) {
                return node.steps.map(s => ({ square: [s.square[0], s.square[1]], tick: s.tick }));
            }
        }
        if (node.tick >= req.horizon)
            continue;
        const succs = genSuccessors(ms, wh, req.turnCost);
        for (const succ of succs) {
            const newTick = node.tick + 1;
            if (newTick > req.horizon)
                continue;
            const sqS = [succ.square[0], succ.square[1]];
            if (!wh.isWalkable(sqS))
                continue;
            if (req.corridor && !req.corridor.has((0, types_1.squareKey)(sqS)))
                continue;
            if (!req.bookings.squareFree(sqS, newTick, req.robot))
                continue;
            const newZone = wh.zoneOf(sqS);
            if (!req.bookings.zoneFree(newZone, newTick, req.robot))
                continue;
            const oldZone = wh.zoneOf(ms.square);
            // zone boundary crossing: reverse zone transition free
            if (newZone !== oldZone) {
                if (!req.bookings.zoneSwapFree(oldZone, newZone, newTick, req.robot))
                    continue;
            }
            // actual move vs wait
            const moved = !(0, types_1.sameSquare)(sqS, ms.square);
            if (moved) {
                if (!req.bookings.swapFree(ms.square, sqS, newTick, req.robot))
                    continue;
            }
            const sk2 = moveStateKey(succ) + "@" + newTick;
            if (visited.has(sk2))
                continue;
            visited.add(sk2);
            queue.push({
                ms: { square: [succ.square[0], succ.square[1]], heading: succ.heading, turn: succ.turn },
                tick: newTick,
                steps: node.steps.concat([{ square: [sqS[0], sqS[1]], tick: newTick }]),
            });
        }
    }
    return undefined;
}
