"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bookings = void 0;
const types_1 = require("./types");
class Bookings {
    constructor() {
        this.spaceTime = new Map(); // spaceTimeKey -> occ
        this.moves = new Map(); // moveKey -> robot
        this.zoneTick = new Map(); // zone + "@" + tick -> occ
        this.zoneTrans = new Map(); // `${from}>${to}@${tick}` -> robot
        this.parked = new Map(); // squareKey -> parked
    }
    zoneTickKey(zone, t) {
        return `${zone}@${t}`;
    }
    // ---- read ----
    occupant(s, t) {
        const k = (0, types_1.spaceTimeKey)(s, t);
        const occ = this.spaceTime.get(k);
        if (occ)
            return occ;
        const pk = this.parked.get((0, types_1.squareKey)(s));
        if (pk && t >= pk.from)
            return { robot: pk.robot, reason: "parked" };
        return undefined;
    }
    squareFree(s, t, robot) {
        const occ = this.occupant(s, t);
        return !occ || occ.robot === robot;
    }
    squareWindowFree(s, t0, t1, robot) {
        for (let t = t0; t <= t1; t++) {
            if (!this.squareFree(s, t, robot))
                return false;
        }
        return true;
    }
    swapFree(src, dst, t, robot) {
        // reverse movement dst->src arriving t
        const rk = (0, types_1.moveKey)(dst, src, t);
        const other = this.moves.get(rk);
        return !other || other === robot;
    }
    zoneFree(zone, t, robot) {
        const rec = this.zoneTick.get(this.zoneTickKey(zone, t));
        return !rec || rec.robot === robot;
    }
    zoneWindowFree(zone, t0, t1, robot) {
        for (let t = t0; t <= t1; t++) {
            if (!this.zoneFree(zone, t, robot))
                return false;
        }
        return true;
    }
    zoneSwapFree(fromZone, toZone, t, robot) {
        const key = `${toZone}>${fromZone}@${t}`;
        const other = this.zoneTrans.get(key);
        return !other || other === robot;
    }
    // ---- write ----
    reserveSquare(s, t, robot, reason) {
        this.spaceTime.set((0, types_1.spaceTimeKey)(s, t), { robot, reason });
    }
    reserveSquareWindow(s, t0, t1, robot, reason) {
        for (let t = t0; t <= t1; t++)
            this.reserveSquare(s, t, robot, reason);
    }
    reserveMove(from, to, t, robot) {
        this.moves.set((0, types_1.moveKey)(from, to, t), robot);
    }
    reserveZone(zone, t, robot, reason) {
        this.zoneTick.set(this.zoneTickKey(zone, t), { robot, reason });
    }
    reserveZoneWindow(zone, t0, t1, robot, reason) {
        for (let t = t0; t <= t1; t++)
            this.reserveZone(zone, t, robot, reason);
    }
    reserveZoneTransition(fromZone, toZone, t, robot) {
        this.zoneTrans.set(`${fromZone}>${toZone}@${t}`, robot);
    }
    park(s, robot, from) {
        this.parked.set((0, types_1.squareKey)(s), { robot, from });
    }
    unpark(s, robot) {
        const pk = this.parked.get((0, types_1.squareKey)(s));
        if (pk && (!robot || pk.robot === robot))
            this.parked.delete((0, types_1.squareKey)(s));
    }
    // accessors for checker maybe
    allParked() { return this.parked; }
    allSpaceTime() { return this.spaceTime; }
    allMoves() { return this.moves; }
    allZoneTick() { return this.zoneTick; }
    allZoneTrans() { return this.zoneTrans; }
}
exports.Bookings = Bookings;
