import { Square, squareKey, spaceTimeKey, moveKey, sameSquare } from "./types";

interface Occ {
  robot: string;
  reason: string;
}
interface Parked {
  robot: string;
  from: number;
}

interface ZoneTransKey { }

export class Bookings {
  private spaceTime = new Map<string, Occ>(); // spaceTimeKey -> occ
  private moves = new Map<string, string>(); // moveKey -> robot
  private zoneTick = new Map<string, Occ>(); // zone + "@" + tick -> occ
  private zoneTrans = new Map<string, string>(); // `${from}>${to}@${tick}` -> robot
  private parked = new Map<string, Parked>(); // squareKey -> parked

  private zoneTickKey(zone: string, t: number): string {
    return `${zone}@${t}`;
  }

  // ---- read ----
  occupant(s: Square, t: number): Occ | undefined {
    const k = spaceTimeKey(s, t);
    const occ = this.spaceTime.get(k);
    if (occ) return occ;
    const pk = this.parked.get(squareKey(s));
    if (pk && t >= pk.from) return { robot: pk.robot, reason: "parked" };
    return undefined;
  }

  squareFree(s: Square, t: number, robot: string): boolean {
    const occ = this.occupant(s, t);
    return !occ || occ.robot === robot;
  }

  squareWindowFree(s: Square, t0: number, t1: number, robot: string): boolean {
    for (let t = t0; t <= t1; t++) {
      if (!this.squareFree(s, t, robot)) return false;
    }
    return true;
  }

  swapFree(src: Square, dst: Square, t: number, robot: string): boolean {
    // reverse movement dst->src arriving t
    const rk = moveKey(dst, src, t);
    const other = this.moves.get(rk);
    return !other || other === robot;
  }

  zoneFree(zone: string, t: number, robot: string): boolean {
    const rec = this.zoneTick.get(this.zoneTickKey(zone, t));
    return !rec || rec.robot === robot;
  }

  zoneWindowFree(zone: string, t0: number, t1: number, robot: string): boolean {
    for (let t = t0; t <= t1; t++) {
      if (!this.zoneFree(zone, t, robot)) return false;
    }
    return true;
  }

  zoneSwapFree(fromZone: string, toZone: string, t: number, robot: string): boolean {
    const key = `${toZone}>${fromZone}@${t}`;
    const other = this.zoneTrans.get(key);
    return !other || other === robot;
  }

  // ---- write ----
  reserveSquare(s: Square, t: number, robot: string, reason: string): void {
    this.spaceTime.set(spaceTimeKey(s, t), { robot, reason });
  }

  reserveSquareWindow(s: Square, t0: number, t1: number, robot: string, reason: string): void {
    for (let t = t0; t <= t1; t++) this.reserveSquare(s, t, robot, reason);
  }

  reserveMove(from: Square, to: Square, t: number, robot: string): void {
    this.moves.set(moveKey(from, to, t), robot);
  }

  reserveZone(zone: string, t: number, robot: string, reason: string): void {
    this.zoneTick.set(this.zoneTickKey(zone, t), { robot, reason });
  }

  reserveZoneWindow(zone: string, t0: number, t1: number, robot: string, reason: string): void {
    for (let t = t0; t <= t1; t++) this.reserveZone(zone, t, robot, reason);
  }

  reserveZoneTransition(fromZone: string, toZone: string, t: number, robot: string): void {
    this.zoneTrans.set(`${fromZone}>${toZone}@${t}`, robot);
  }

  park(s: Square, robot: string, from: number): void {
    this.parked.set(squareKey(s), { robot, from });
  }

  unpark(s: Square, robot?: string): void {
    const pk = this.parked.get(squareKey(s));
    if (pk && (!robot || pk.robot === robot)) this.parked.delete(squareKey(s));
  }

  // accessors for checker maybe
  allParked(): Map<string, Parked> { return this.parked; }
  allSpaceTime(): Map<string, Occ> { return this.spaceTime; }
  allMoves(): Map<string, string> { return this.moves; }
  allZoneTick(): Map<string, Occ> { return this.zoneTick; }
  allZoneTrans(): Map<string, string> { return this.zoneTrans; }
}