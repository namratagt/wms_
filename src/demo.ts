import { createWarehouse } from "./warehouse";
import { Bookings } from "./booking";
import { Planner, checkConflicts } from "./planner";
import { Square, squareKey } from "./types";

function main() {
  const wh = createWarehouse();
  console.log(wh.render());
  console.log("Legend: # shelf  . aisle  S station  D drop  H home");
  const orders = [
    { id: "order1", robot: "robot one", station: "station one", priority: 1 },
    { id: "order2", robot: "robot two", station: "station five", priority: 2 },
    { id: "order3", robot: "robot three", station: "station two", priority: 3 },
  ];
  const planner = new Planner(wh, { pickDuration: 4, dropDuration: 2 });
  const plans = planner.planAll(orders as any);
  for (const p of plans) {
    console.log(`\nPLAN ${p.robot} (${p.order}) start=${p.startTick} complete=${p.completionTick}`);
    for (const leg of p.legs) {
      const first = leg.steps[0];
      const last = leg.steps[leg.steps.length - 1];
      console.log(`  LEG ${leg.label} strategy=${leg.strategy} depart=${first.tick} arrive=${last.tick} optimal=${leg.optimal} actual=${last.tick - first.tick} dwell=${leg.dwell}`);
      console.log(`    from ${leg.from} (${squareKey(leg.from)}) to ${leg.to} (${squareKey(leg.to)})`);
      console.log(`    route: ${leg.steps.map(s => `${s.square[0]},${s.square[1]}@${s.tick}`).join(" ")}`);
      if (leg.locked && leg.locked.length) console.log(`    locked aisle: ${leg.locked.map(s => `${s[0]},${s[1]}`).join(" ")}`);
    }
  }
  const maxTick = Math.max(...plans.map(p => p.completionTick));
  const ticks = Math.min(maxTick, 60);
  // positions
  const positions: Record<string, Square | undefined> = {};
  console.log("\nTick positions:");
  // header
  process.stdout.write("tick".padEnd(6));
  for (const p of plans) process.stdout.write(p.robot.padEnd(24));
  console.log();
  for (let t = 0; t <= ticks; t++) {
    process.stdout.write(String(t).padEnd(6));
    for (const p of plans) {
      const sq = timelinePos(p, t);
      const str = sq ? `${sq[0]},${sq[1]}` : "-";
      process.stdout.write(str.padEnd(24));
    }
    console.log();
  }
  const conflicts = checkConflicts(plans, wh, { pickDuration: 4, dropDuration: 2, turnCost: 1 });
  if (!conflicts || conflicts.length === 0) console.log("\nNo conflicts.");
  else {
    console.log("\nConflicts:");
    for (const c of conflicts) console.log(`  tick ${c.tick} [${c.kind}] ${c.detail}`);
  }
}

function timelinePos(p: any, t: number): Square | undefined {
  // use steps; forward fill
  const steps = p.legs.flatMap((l: any) => l.steps);
  // sort by tick
  steps.sort((a: any, b: any) => a.tick - b.tick);
  let pos: Square | undefined;
  for (const s of steps) {
    if (s.tick <= t) pos = s.square; else break;
  }
  if (!pos) pos = steps.length ? steps[0].square : undefined;
  if (t > p.completionTick) return undefined;
  return pos;
}

main();
