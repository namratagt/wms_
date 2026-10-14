"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Planner = void 0;
exports.checkConflicts = checkConflicts;
exports.timeline = timeline;
const booking_1 = require("./booking");
const pathfinding_1 = require("./pathfinding");
const types_1 = require("./types");
function compressSqList(sqs) {
    const out = [];
    for (const s of sqs) {
        const k = (0, types_1.squareKey)(s);
        if (out.length === 0 || out[out.length - 1] !== k)
            out.push(k);
    }
    return out;
}
class Planner {
    constructor(wh, options = {}) {
        this.wh = wh;
        this.bookings = new booking_1.Bookings();
        this.opts = {
            pickDuration: options.pickDuration ?? 3,
            dropDuration: options.dropDuration ?? 2,
            returnToRest: options.returnToRest ?? true,
            turnCost: options.turnCost ?? 1,
            horizon: options.horizon ?? 400,
            maxDelay: options.maxDelay ?? 80,
        };
    }
    planAll(orders) {
        const sorted = [...orders].sort((a, b) => {
            const pa = a.priority ?? 0;
            const pb = b.priority ?? 0;
            if (pa !== pb)
                return pa - pb;
            const ra = a.release ?? 0;
            const rb = b.release ?? 0;
            if (ra !== rb)
                return ra - rb;
            return a.id < b.id ? -1 : 1;
        });
        const plans = [];
        for (const o of sorted) {
            plans.push(this.planOrder(o));
        }
        return plans;
    }
    planOrder(order) {
        const robot = order.robot;
        const restName = robot.endsWith(" home") ? robot : robot + " home";
        const restSq = this.wh.getRest(restName);
        // unpark rest
        this.bookings.unpark(restSq, robot);
        const stationName = order.station;
        const dropName = order.drop ?? "drop zone";
        const startTick = order.release ?? 0;
        const dwellPick = this.opts.pickDuration;
        const dwellDrop = this.opts.dropDuration;
        // leg descriptors
        const stationSq = this.wh.getStation(stationName);
        const dropSq = (dropName === "drop zone") ? this.wh.getStation(dropName) // drop zone anchor? treat as station-ish
            : this.wh.getStation(dropName);
        // drop zone is a landmark area; getRest? use getStation maybe name "drop zone"
        // Ensure anchor for drop zone via getStation (it's in landmarks) - station lookup by name works if landmark registered; but getStation checks anchors map includes all landmark names
        // Actually anchors map built from landmark areas, so getStation("drop zone") works.
        let cursorSq = [restSq[0], restSq[1]];
        let cursorTime = startTick;
        const legs = [];
        // Leg 1: rest -> pickup, lock
        const leg1 = this.planLeg(robot, `${robot} -> ${stationName}`, cursorSq, stationSq, cursorTime, dwellPick, true);
        legs.push(leg1);
        cursorSq = [stationSq[0], stationSq[1]];
        cursorTime = leg1.steps[leg1.steps.length - 1].tick + dwellPick;
        // Leg 2: pickup -> drop, lock (drop has dwell)
        const leg2 = this.planLeg(robot, `${stationName} -> ${dropName}`, cursorSq, dropSq, cursorTime, dwellDrop, true);
        legs.push(leg2);
        cursorSq = [dropSq[0], dropSq[1]];
        cursorTime = leg2.steps[leg2.steps.length - 1].tick + dwellDrop;
        // Leg 3: drop -> rest (optional)
        if (this.opts.returnToRest) {
            const leg3 = this.planLeg(robot, `${dropName} -> rest`, cursorSq, restSq, cursorTime, 0, false);
            legs.push(leg3);
            cursorSq = [restSq[0], restSq[1]];
            cursorTime = leg3.steps[leg3.steps.length - 1].tick;
        }
        // park final
        this.bookings.park(cursorSq, robot, cursorTime);
        const completionTick = cursorTime;
        const firstTick = legs[0].steps[0].tick;
        const plan = {
            robot,
            order: order.id,
            legs,
            startTick: firstTick,
            completionTick,
        };
        return plan;
    }
    getStationSafe(name) {
        if (name === "drop zone") {
            // drop zone is landmark; getStation works
        }
        return this.wh.getStation(name);
    }
    planLeg(robot, label, start, goal, earliestStart, dwell, lock) {
        const tc = this.opts.turnCost;
        const wh = this.wh;
        const bookings = this.bookings;
        // 1. ideal shortest path
        const ideal = (0, pathfinding_1.shortestPath)(wh, start, goal, tc);
        if (!ideal)
            throw new Error(`No path for leg ${label}`);
        const corridor = new Set(ideal.map(s => (0, types_1.squareKey)(s)));
        const optimalArrival = earliestStart + (ideal.length - 1);
        // 2. blocked squares
        let lockSquares = [];
        if (dwell > 0) {
            if (lock)
                lockSquares = wh.lock(goal);
            else
                lockSquares = [[goal[0], goal[1]]];
        }
        else {
            lockSquares = [];
        }
        // 3. hold count
        const hold = dwell > 0 ? dwell + (0, pathfinding_1.exitCost)(wh, goal, tc) : 0;
        // 4. attempt A (corridor restricted)
        const resultA = (0, pathfinding_1.spaceTimeSearch)({
            robot, start, goal, startTick: earliestStart, hold, bookings,
            corridor, turnCost: tc, horizon: this.opts.horizon, wh,
        });
        const arrivalA = resultA ? resultA[resultA.length - 1].tick : Infinity;
        // 5. attempt B (unrestricted) only if A missing or arrives later than optimal
        let resultB = undefined;
        if (!resultA || arrivalA > optimalArrival) {
            resultB = (0, pathfinding_1.spaceTimeSearch)({
                robot, start, goal, startTick: earliestStart, hold, bookings,
                corridor: null, turnCost: tc, horizon: this.opts.horizon, wh,
            });
        }
        const arrivalB = resultB ? resultB[resultB.length - 1].tick : Infinity;
        // 6. keep earlier, ties favor corridor (A)
        let chosen = undefined;
        let chosenIsB = false;
        if (resultA && resultB) {
            if (arrivalB < arrivalA) {
                chosen = resultB;
                chosenIsB = true;
            }
            else
                chosen = resultA;
        }
        else if (resultA) {
            chosen = resultA;
        }
        else if (resultB) {
            chosen = resultB;
            chosenIsB = true;
        }
        // 7. delayed start
        let delayed = false;
        if (!chosen) {
            const originZone = wh.zoneOf(start);
            for (let d = 1; d <= this.opts.maxDelay; d++) {
                // origin zone must stay free through earliestStart+d
                if (!bookings.zoneWindowFree(originZone, earliestStart, earliestStart + d, robot)) {
                    // give up early
                    break;
                }
                const delayedStart = earliestStart + d;
                // try corridor first, then unrestricted
                let r = (0, pathfinding_1.spaceTimeSearch)({
                    robot, start, goal, startTick: delayedStart, hold, bookings,
                    corridor, turnCost: tc, horizon: this.opts.horizon, wh,
                });
                if (!r) {
                    r = (0, pathfinding_1.spaceTimeSearch)({
                        robot, start, goal, startTick: delayedStart, hold, bookings,
                        corridor: null, turnCost: tc, horizon: this.opts.horizon, wh,
                    });
                }
                if (r) {
                    chosen = r;
                    delayed = true;
                    break;
                }
            }
        }
        if (!chosen)
            throw new Error(`Leg could not be scheduled: ${label}`);
        const steps = chosen.map(s => ({ square: [s.square[0], s.square[1]], tick: s.tick }));
        // classify
        const strategy = classifyStrategy(steps, ideal, earliestStart, optimalArrival, this.wh);
        // commit
        commitLeg(robot, steps, earliestStart, dwell, lockSquares, hold, wh, bookings);
        const leg = {
            label,
            from: [start[0], start[1]],
            to: [goal[0], goal[1]],
            steps,
            strategy,
            dwell,
            locked: lockSquares.map(s => [s[0], s[1]]),
            optimal: ideal.length - 1,
        };
        return leg;
    }
}
exports.Planner = Planner;
function classifyStrategy(chosen, ideal, earliestStart, optimalArrival, wh) {
    const idealCompressed = compressSqList(ideal);
    const chosenSqs = chosen.map(s => s.square);
    const chosenCompressed = compressSqList(chosenSqs);
    if (chosenCompressed.join("|") !== idealCompressed.join("|"))
        return "alternate route";
    const firstDepart = chosen[0].tick;
    if (firstDepart > earliestStart)
        return "delayed start";
    const arrival = chosen[chosen.length - 1].tick;
    if (arrival === optimalArrival)
        return "direct";
    return "wait on route";
}
function commitLeg(robot, steps, earliestStart, dwell, lockSquares, hold, wh, bookings) {
    const firstTick = steps[0].tick;
    const arrival = steps[steps.length - 1].tick;
    // hold before departure: origin held
    const origin = steps[0].square; // first square origin
    if (firstTick > earliestStart) {
        const originZone = wh.zoneOf(origin);
        for (let t = earliestStart; t < firstTick; t++) {
            bookings.reserveSquare(origin, t, robot, "waiting");
            bookings.reserveZone(originZone, t, robot, "waiting");
        }
    }
    // every step
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const sq = s.square;
        const zone = wh.zoneOf(sq);
        bookings.reserveSquare(sq, s.tick, robot, "transit");
        bookings.reserveZone(zone, s.tick, robot, "transit");
        if (i > 0) {
            const prev = steps[i - 1].square;
            const prevZone = wh.zoneOf(prev);
            bookings.reserveMove(prev, sq, s.tick, robot);
            if (prevZone !== zone) {
                bookings.reserveZoneTransition(prevZone, zone, s.tick, robot);
            }
        }
    }
    if (dwell > 0) {
        // lock squares across arrival..arrival+dwell
        for (const ls of lockSquares) {
            bookings.reserveSquareWindow(ls, arrival, arrival + dwell, robot, "lane-locked");
        }
        const destZone = wh.zoneOf(steps[steps.length - 1].square);
        bookings.reserveZoneWindow(destZone, arrival, arrival + hold, robot, "lane-locked");
    }
}
function checkConflicts(plans, wh, opts) {
    const conflicts = [];
    // timeline positions per robot
    const robotIds = plans.map(p => p.robot);
    const positions = {};
    const completions = {};
    for (const p of plans) {
        const m = new Map();
        // flatten steps
        const allSteps = [];
        for (const leg of p.legs)
            for (const s of leg.steps)
                allSteps.push(s);
        allSteps.sort((a, b) => a.tick - b.tick);
        let cur = allSteps.length ? allSteps[0].square : undefined;
        const completion = p.completionTick;
        completions[p.robot] = completion;
        // init current to first step; if parked before start? steps[0] should be rest at start
        for (let t = 0; t <= completion; t++) {
            // update current if step at t
            const st = allSteps.find(s => s.tick === t);
            if (st)
                cur = st.square;
            if (cur)
                m.set(t, [cur[0], cur[1]]);
        }
        positions[p.robot] = m;
    }
    const maxTick = Math.max(0, ...Object.values(completions));
    // lock windows
    const locks = [];
    for (const p of plans) {
        for (const leg of p.legs) {
            if (leg.locked && leg.locked.length > 0 && leg.dwell > 0) {
                const arrival = leg.steps[leg.steps.length - 1].tick;
                locks.push({
                    robot: p.robot,
                    squares: new Set(leg.locked.map(s => (0, types_1.squareKey)(s))),
                    t0: arrival,
                    t1: arrival + leg.dwell,
                });
            }
        }
    }
    // cell & segment conflicts per tick
    for (let t = 0; t <= maxTick; t++) {
        for (let i = 0; i < robotIds.length; i++) {
            for (let j = i + 1; j < robotIds.length; j++) {
                const a = robotIds[i], b = robotIds[j];
                const pa = positions[a].get(t);
                const pb = positions[b].get(t);
                if (!pa || !pb)
                    continue;
                if ((0, types_1.sameSquare)(pa, pb)) {
                    conflicts.push({ tick: t, kind: "cell", detail: `${a} and ${b} on same square ${pa[0]},${pa[1]}` });
                }
                if (wh.zoneOf(pa) === wh.zoneOf(pb)) {
                    conflicts.push({ tick: t, kind: "segment", detail: `${a} and ${b} in same zone ${wh.zoneOf(pa)} at ${pa[0]},${pa[1]}/${pb[0]},${pb[1]}` });
                }
            }
        }
        // lane-lock conflicts
        for (const r of robotIds) {
            const p = positions[r].get(t);
            if (!p)
                continue;
            for (const lock of locks) {
                if (lock.robot === r)
                    continue;
                if (t >= lock.t0 && t <= lock.t1 && lock.squares.has((0, types_1.squareKey)(p))) {
                    conflicts.push({ tick: t, kind: "lane-lock", detail: `${r} enters locked square ${p[0]},${p[1]} (locked by ${lock.robot})` });
                }
            }
        }
    }
    // swap conflicts
    for (let t = 0; t < maxTick; t++) {
        for (let i = 0; i < robotIds.length; i++) {
            for (let j = i + 1; j < robotIds.length; j++) {
                const a = robotIds[i], b = robotIds[j];
                const pa0 = positions[a].get(t), pa1 = positions[a].get(t + 1);
                const pb0 = positions[b].get(t), pb1 = positions[b].get(t + 1);
                if (!pa0 || !pa1 || !pb0 || !pb1)
                    continue;
                if ((0, types_1.sameSquare)(pa0, pb1) && (0, types_1.sameSquare)(pb0, pa1) && !(0, types_1.sameSquare)(pa0, pa1)) {
                    conflicts.push({ tick: t, kind: "swap", detail: `${a} and ${b} swap squares` });
                }
                // pass conflict (zone exchange)
                const za0 = wh.zoneOf(pa0), za1 = wh.zoneOf(pa1);
                const zb0 = wh.zoneOf(pb0), zb1 = wh.zoneOf(pb1);
                if (za0 === zb1 && zb0 === za1 && za0 !== za1) {
                    conflicts.push({ tick: t, kind: "pass", detail: `${a} and ${b} pass across zone boundary ${za0}/${zb0}` });
                }
            }
        }
    }
    return conflicts;
}
// timeline helper exported maybe
function timeline(p) {
    const m = new Map();
    const allSteps = [];
    for (const leg of p.legs)
        for (const s of leg.steps)
            allSteps.push(s);
    allSteps.sort((a, b) => a.tick - b.tick);
    let cur;
    for (const s of allSteps) {
        cur = s.square;
        m.set(s.tick, [cur[0], cur[1]]);
    }
    // forward fill
    if (allSteps.length) {
        const min = allSteps[0].tick;
        const max = p.completionTick;
        cur = allSteps[0].square;
        for (let t = min; t <= max; t++) {
            const st = allSteps.find(s => s.tick === t);
            if (st)
                cur = st.square;
            if (!m.has(t) && cur)
                m.set(t, [cur[0], cur[1]]);
        }
    }
    return m;
}
