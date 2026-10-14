import { Square, squareKey, sq } from "./types";

export interface Rect {
  r0: number; r1: number; c0: number; c1: number;
}

export class Warehouse {
  readonly rows = 30;
  readonly cols = 30;
  readonly aisleRows = new Set<number>([0, 1, 14, 15, 28, 29]);
  readonly aisleCols = new Set<number>([0, 1, 14, 15, 28, 29]);

  // landmarks: name -> rect
  readonly landmarks: Record<string, Rect> = {
    "robot one home": { r0: 2, r1: 4, c0: 4, c1: 5 },
    "robot two home": { r0: 2, r1: 4, c0: 24, c1: 25 },
    "robot three home": { r0: 25, r1: 27, c0: 20, c1: 21 },
    "station one": { r0: 4, r1: 5, c0: 14, c1: 15 },
    "station two": { r0: 20, r1: 21, c0: 14, c1: 15 },
    "station three": { r0: 14, r1: 15, c0: 4, c1: 5 },
    "station four": { r0: 14, r1: 15, c0: 23, c1: 24 },
    "station five": { r0: 0, r1: 1, c0: 18, c1: 19 },
    "station six": { r0: 9, r1: 10, c0: 0, c1: 1 },
    "drop zone": { r0: 22, r1: 27, c0: 6, c1: 7 },
  };

  // lane-coupled bays (reverse-only): name -> adjacent lane computed
  readonly laneCoupled = ["drop zone"];

  // square -> landmark name
  private squareArea = new Map<string, string>();
  // walkable squares list
  private walkableSet = new Set<string>();

  // zones
  private squareZone = new Map<string, string>();
  private zoneSquareMap = new Map<string, Square[]>();

  // anchors per area
  private anchors = new Map<string, Square>();

  constructor() {
    this.buildSquareArea();
    this.buildZones();
    this.buildAnchors();
    // lane-coupled merge
    for (const bayName of this.laneCoupled) {
      this.mergeLaneCoupled(bayName);
    }
  }

  private buildSquareArea(): void {
    for (const name of Object.keys(this.landmarks)) {
      const r = this.landmarks[name];
      for (let rr = r.r0; rr <= r.r1; rr++) {
        for (let cc = r.c0; cc <= r.c1; cc++) {
          const s: Square = [rr, cc];
          this.squareArea.set(squareKey(s), name);
          this.walkableSet.add(squareKey(s));
        }
      }
    }
    // aisles
    for (let rr = 0; rr < this.rows; rr++) {
      for (let cc = 0; cc < this.cols; cc++) {
        if (this.aisleRows.has(rr) || this.aisleCols.has(cc)) {
          if (rr >= 0 && rr < this.rows && cc >= 0 && cc < this.cols) {
            const s: Square = [rr, cc];
            if (!this.walkableSet.has(squareKey(s))) {
              // aisle square with no landmark -> generic (no area)
            }
            this.walkableSet.add(squareKey(s));
          }
        }
      }
    }
  }

  private rowBands: [number, number][] = [];
  private colBands: [number, number][] = [];

  private buildBands(): void {
    const rows = [...this.aisleRows].sort((a, b) => a - b);
    let start = rows[0];
    let prev = rows[0];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] === prev + 1) {
        prev = rows[i];
      } else {
        this.rowBands.push([start, prev]);
        start = rows[i];
        prev = rows[i];
      }
    }
    this.rowBands.push([start, prev]);

    const cols = [...this.aisleCols].sort((a, b) => a - b);
    let cstart = cols[0];
    let cprev = cols[0];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === cprev + 1) {
        cprev = cols[i];
      } else {
        this.colBands.push([cstart, cprev]);
        cstart = cols[i];
        cprev = cols[i];
      }
    }
    this.colBands.push([cstart, cprev]);
  }

  private bandIndex(bands: [number, number][], v: number): number {
    for (let i = 0; i < bands.length; i++) {
      if (v >= bands[i][0] && v <= bands[i][1]) return i;
    }
    return -1;
  }

  private countBandsEndingBefore(bands: [number, number][], v: number): number {
    let n = 0;
    for (const [a, b] of bands) {
      if (b < v) n++;
    }
    return n;
  }

  private buildZones(): void {
    this.buildBands();
    for (let rr = 0; rr < this.rows; rr++) {
      for (let cc = 0; cc < this.cols; cc++) {
        const s: Square = [rr, cc];
        const key = squareKey(s);
        if (!this.isWalkable(s)) continue;
        const ri = this.bandIndex(this.rowBands, rr);
        const ci = this.bandIndex(this.colBands, cc);
        let zoneName: string;
        let isBay = false;
        if (ri >= 0 && ci >= 0) {
          zoneName = `J${ri},${ci}`;
        } else if (ri >= 0) {
          const k = this.countBandsEndingBefore(this.colBands, cc);
          zoneName = `H${ri},${k}`;
        } else if (ci >= 0) {
          const k = this.countBandsEndingBefore(this.rowBands, rr);
          zoneName = `V${ci},${k}`;
        } else {
          isBay = true;
          const area = this.squareArea.get(key);
          zoneName = area ? area : key;
        }
        if (isBay && !this.zoneSquareMap.has(zoneName)) {
          // ok
        }
        this.squareZone.set(key, zoneName);
        if (!this.zoneSquareMap.has(zoneName)) this.zoneSquareMap.set(zoneName, []);
        this.zoneSquareMap.get(zoneName)!.push([rr, cc]);
      }
    }
  }

  private mergeLaneCoupled(bayName: string): void {
    // find adjacent lane zone: use anchor's neighbor that is on aisle
    const anchor = this.getAnchorByName(bayName);
    if (!anchor) return;
    // find neighbor in zone not bay
    const [r, c] = anchor;
    const neighbors: Square[] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    let adjZone: string | null = null;
    for (const nb of neighbors) {
      if (this.inBounds(nb) && this.isWalkable(nb) && this.isAisle(nb)) {
        adjZone = this.zoneOf(nb);
        break;
      }
    }
    if (!adjZone) return;
    // merge: move all squares of bay zone into adj zone
    const bayZoneName = this.zoneOf(anchor);
    // if already same, skip
    if (bayZoneName === adjZone) return;
    const baySqs = this.zoneSquareMap.get(bayZoneName) || [];
    const adjSqs = this.zoneSquareMap.get(adjZone) || [];
    for (const s of baySqs) {
      this.squareZone.set(squareKey(s), adjZone);
      adjSqs.push(s);
    }
    this.zoneSquareMap.set(adjZone, adjSqs);
    this.zoneSquareMap.delete(bayZoneName);
  }

  private getAnchorByName(name: string): Square | null {
    // compute anchor (closest to through aisle) if not cached
    const areaSqs: Square[] = [];
    for (const [k, v] of this.squareArea.entries()) {
      if (v === name) {
        const [r, c] = k.split(",").map(Number);
        areaSqs.push([r, c]);
      }
    }
    if (areaSqs.length === 0) return null;
    let best: Square = areaSqs[0];
    let bestDist = Infinity;
    for (const s of areaSqs) {
      // distance to nearest aisle square
      const [r, c] = s;
      let d = Infinity;
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          const ss: Square = [rr, cc];
          if (this.isAisle(ss)) {
            const dd = Math.abs(rr - r) + Math.abs(cc - c);
            if (dd < d) d = dd;
          }
        }
      }
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  private buildAnchors(): void {
    const areas = new Set(this.squareArea.values());
    for (const name of areas) {
      const anchor = this.getAnchorByName(name);
      if (anchor) this.anchors.set(name, anchor);
    }
    // also ensure all landmarks have anchors (some may have no squares? no)
  }

  // ---- public api ----

  inBounds(s: Square): boolean {
    return s[0] >= 0 && s[0] < this.rows && s[1] >= 0 && s[1] < this.cols;
  }

  isAisle(s: Square): boolean {
    return this.inBounds(s) && (this.aisleRows.has(s[0]) || this.aisleCols.has(s[1]));
  }

  isIntersection(s: Square): boolean {
    return this.inBounds(s) && this.aisleRows.has(s[0]) && this.aisleCols.has(s[1]);
  }

  isWalkable(s: Square): boolean {
    return this.inBounds(s) && this.walkableSet.has(squareKey(s));
  }

  // allow marking Spurs already added. Allow dynamic? no.

  areaOf(s: Square): string | undefined {
    return this.squareArea.get(squareKey(s));
  }

  isSpur(s: Square): boolean {
    return this.squareArea.has(squareKey(s));
  }

  neighbors(s: Square): Square[] {
    const [r, c] = s;
    const out: Square[] = [];
    const cand: Square[] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const x of cand) {
      if (this.isWalkable(x)) out.push([x[0], x[1]]);
    }
    return out;
  }

  getStation(name: string): Square {
    const a = this.anchors.get(name);
    if (!a) throw new Error(`Unknown station: ${name}`);
    return [a[0], a[1]];
  }

  getRest(name: string): Square {
    // rest point = home anchor; name like "robot one home" or "robot one"? 
    // Accept both "robot one" and "robot one home"
    let key = name;
    if (!this.anchors.has(key)) {
      key = name + " home";
    }
    if (!this.anchors.has(key)) {
      // maybe home name variant
      const candidates = [...this.anchors.keys()].filter(k => k.startsWith(name));
      if (candidates.length) key = candidates[0];
    }
    const a = this.anchors.get(key);
    if (!a) throw new Error(`Unknown rest point: ${name}`);
    return [a[0], a[1]];
  }

  nameOf(s: Square): string | undefined {
    return this.squareArea.get(squareKey(s));
  }

  // name lookup returning named area if any
  areaName(s: Square): string | undefined {
    return this.squareArea.get(squareKey(s));
  }

  zoneOf(s: Square): string {
    return this.squareZone.get(squareKey(s)) || squareKey(s);
  }

  zoneSquares(zone: string): Square[] {
    const arr = this.zoneSquareMap.get(zone);
    if (!arr) return [];
    return arr.map(x => [x[0], x[1]] as Square);
  }

  // backwards compat alias
  getZoneSquares(zone: string): Square[] {
    return this.zoneSquares(zone);
  }

  render(show?: Record<string, Square> | undefined, overlay?: Record<string, string>): string {
    let out = "";
    for (let r = 0; r < this.rows; r++) {
      let line = "";
      for (let c = 0; c < this.cols; c++) {
        const s: Square = [r, c];
        if (overlay && overlay[squareKey(s)]) {
          line += overlay[squareKey(s)];
        } else if (this.areaOf(s)) {
          const a = this.areaOf(s)!;
          if (a.startsWith("station")) line += "S";
          else if (a === "drop zone") line += "D";
          else if (a.endsWith("home")) line += "H";
          else line += "a";
        } else if (this.isWalkable(s)) {
          line += ".";
        } else {
          line += "#";
        }
      }
      out += line + "\n";
    }
    return out;
  }

  footprint(s: Square, heading: number): Square[] {
    const key = squareKey(s);
    const zone = this.zoneOf(s);
    const zs = this.zoneSquares(zone);
    // junction?
    let isJunction = this.isIntersection(s);
    if (isJunction) return [[s[0], s[1]]];
    // bay: if not in any aisle band? determine: if zone squares all same area and not aisle? 
    const onAisle = this.isAisle(s);
    if (!onAisle) {
      // bay row slice
      return zs.filter(x => x[0] === s[0]).map(x => [x[0], x[1]] as Square);
    }
    // lane segment
    // determine band orientation: row band if aisle row, col band if aisle col
    const rowBand = this.rowBands.find(b => s[0] >= b[0] && s[0] <= b[1]);
    const colBand = this.colBands.find(b => s[1] >= b[0] && s[1] <= b[1]);
    if (rowBand && !colBand) {
      // horizontal lane: footprint across rows of band
      return rowBand ? [0,1].map(i => {
        const rr = rowBand[0] + i;
        const cc = s[1];
        return (rr < this.rows ? [rr, cc] : [rowBand[0], cc]) as Square;
      }) : [[s[0], s[1]]];
      // ensure unique valid
    } else if (colBand && !rowBand) {
      return colBand ? [0,1].map(i => {
        const cc = colBand[0] + i;
        const rr = s[0];
        return [rr, cc] as Square;
      }) : [[s[0], s[1]]];
    } else {
      return [[s[0], s[1]]];
    }
  }

  lock(s: Square): Square[] {
    const zone = this.zoneOf(s);
    return this.zoneSquares(zone).map(x => [x[0], x[1]] as Square);
  }
}

// convenience factory
export function createWarehouse(): Warehouse {
  return new Warehouse();
}