// Shared type definitions and small key helpers.

export type Square = readonly [number, number];

export interface TimedStep {
  readonly square: Square;
  readonly tick: number;
}

export type Strategy = "direct" | "wait on route" | "alternate route" | "delayed start";

export interface Leg {
  readonly label: string;
  readonly from: Square;
  readonly to: Square;
  readonly steps: ReadonlyArray<TimedStep>;
  readonly strategy: Strategy;
  readonly dwell: number;
  readonly locked: ReadonlyArray<Square>;
  readonly optimal: number;
}

export interface RobotPlan {
  readonly robot: string;
  readonly order: string;
  readonly legs: ReadonlyArray<Leg>;
  readonly startTick: number;
  readonly completionTick: number;
}

export interface Order {
  readonly id: string;
  readonly robot: string;
  readonly station: string;
  readonly drop?: string;
  readonly release?: number;
  readonly priority?: number;
}

// ---- key helpers ----

export function squareKey(s: Square): string {
  return `${s[0]},${s[1]}`;
}

export function spaceTimeKey(s: Square, t: number): string {
  return `${s[0]},${s[1]}@${t}`;
}

export function moveKey(from: Square, to: Square, t: number): string {
  return `${from[0]},${from[1]}>${to[0]},${to[1]}@${t}`;
}

export function sameSquare(a: Square, b: Square): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function sq(r: number, c: number): Square {
  return [r, c] as const as Square;
}