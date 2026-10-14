const { createWarehouse } = require("./out/warehouse");
const { Planner, checkConflicts, timeline } = require("./out/planner");
const { WarehouseClient } = require("./whClient");
const liveFloor = require("./liveFloor");
const { posAt } = (()=>{
  function posAt(plan, t) {
    const steps=[]; for(const l of plan.legs) for(const s of l.steps) steps.push(s);
    steps.sort((a,b)=>a.tick-b.tick);
    if (steps.length===0) return plan.legs.length? (plan.legs[0].from): [0,0];
    let home = steps[0].square;
    if (t < plan.startTick) {
      // before start, home approx first step
      return [steps[0].square[0], steps[0].square[1]];
    }
    let last = steps[0].square;
    for (const s of steps) { if (s.tick <= t) last = s.square; else break; }
    if (t > plan.completionTick) {
      const ls = plan.legs[plan.legs.length-1].steps;
      return ls && ls.length ? ls[ls.length-1].square : last;
    }
    return last;
  }
  return { posAt };
})();

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ---- args ----
const args = {};
for (let i=2;i<process.argv.length;i++){
  const a=process.argv[i];
  if (a.startsWith("--")) {
    const key=a.slice(2);
    const next=process.argv[i+1];
    if (next && !next.startsWith("--")) { args[key]=next; i++; }
    else args[key]=true;
  }
}
const base = args.base || "http://localhost:8000";
const token = args.token || "team-token-123";
const secondsPerTick = parseFloat(args.secondsPerTick || args.spt || "2");
const speed = parseFloat(args.speed || "1");
const dashPort = (args.dashboardPort || args.port || "9000");
const dashboardOn = dashPort !== "off";

const robots = ["robot one","robot two","robot three"];
const robotColors = { "robot one":"#1f2937", "robot two":"#d946ef", "robot three":"#14b8a6" };
const serviceIds = { "robot one":"R1", "robot two":"R2", "robot three":"R3" };

function homeSq(w, name){ return w.getRest(name.endsWith(" home")?name:name+" home"); }

const plannerOpts = {
  pickDuration: Math.max(1, Math.round(8 / secondsPerTick)),
  dropDuration: Math.max(1, Math.round(4 / secondsPerTick)),
  returnToRest: true,
  turnCost: 1,
  horizon: 400,
  maxDelay: 80,
};

let warehouse = createWarehouse();
let client = new WarehouseClient(base, token);

let snapshot = {
  tick: 0,
  runState: "waiting",
  elapsed: 0,
  issued: 0,
  delivered: 0,
  throughput: 0,
  conflicts: 0,
  locks: [],
  robots: robots.map(r=>({
    id: r,
    serviceId: serviceIds[r],
    color: robotColors[r],
    square: homeSq(warehouse, r),
    footprint: warehouse.footprint(homeSq(warehouse,r), 0),
    remainingRoute: [],
    state: "idle",
    order: null,
    leg: null,
    strategy: null,
    finish: 0,
  })),
};

function allAssignments(orders) {
  const res = [];
  function rec(rest, used, cur) {
    if (rest.length === 0) { res.push(cur.slice()); return; }
    const [o,...r] = rest;
    for (const robot of robots) {
      if (!used.has(robot)) {
        used.add(robot); cur.push(robot);
        rec(r, used, cur);
        cur.pop(); used.delete(robot);
      }
    }
  }
  rec(orders, new Set(), []);
  return res;
}

function isServiceTickPlan(plan, t) {
  for (const leg of plan.legs) {
    if (!leg.dwell) continue;
    const arrival = leg.steps[leg.steps.length-1].tick;
    if (t >= arrival && t < arrival + leg.dwell) return leg;
  }
  return null;
}

async function runRound(chosen, serviceOrdersMap) {
  // park robots initially
  const wh = createWarehouse();
  // park all
  const bookings = null;
  // create planner per assignment evaluation separately
  // Enumerate
  const assignments = allAssignments(chosen);
  let best = null;
  for (const asg of assignments) {
    const w = createWarehouse();
    const pl = new Planner(w, plannerOpts);
    // park robots
    for (const r of robots) pl.bookings.park(homeSq(w,r), r, 0);
    const mapped = chosen.map((o,i)=>({ id: o.id, robot: asg[i], station: o.station, drop: "drop zone", priority: o.priority==="urgent"?0:(chosen.indexOf(o)+1), release: 0 }));
    try {
      const plans = pl.planAll(mapped);
      const conflicts = checkConflicts(plans, w, { pickDuration: plannerOpts.pickDuration, dropDuration: plannerOpts.dropDuration, turnCost:1 });
      if (conflicts.length > 0) continue;
      const makespan = Math.max(...plans.map(p=>p.completionTick));
      if (!best || makespan < best.makespan) best = { assignment: asg, plans, makespan, planner: pl, wh: w };
    } catch(e) {
      // infeasible
    }
  }
  if (!best) { console.log("No feasible assignment for round"); return; }
  const plans = best.plans;
  const makespan = best.makespan;
  const confCount = checkConflicts(plans, best.wh, { pickDuration: plannerOpts.pickDuration, dropDuration: plannerOpts.dropDuration, turnCost:1 }).length;
  const planByRobot = {};
  for (const p of plans) planByRobot[p.robot] = p;

  // service order map
  const orderById = {};
  for (const o of chosen) orderById[o.id] = o;

  const fired = new Set();
  const headings = {};
  for (const r of robots) headings[r] = 3; // default east

  for (let tick=0; tick<=makespan; tick++) {
    await sleep(secondsPerTick*1000/speed);
    // build robots snapshot
    const robotSnaps = robots.map(r=>{
      const plan = planByRobot[r];
      let pos, state, leg=null, strategy=null, finish=0, order=null, remaining=[];
      if (!plan) {
        pos = homeSq(warehouse, r);
        state = "idle";
      } else {
        pos = posAt(plan, tick);
        finish = plan.completionTick;
        order = plan.order;
        const svcLeg = isServiceTickPlan(plan, tick);
        if (tick < plan.startTick || tick > plan.completionTick) state = "idle";
        else if (svcLeg) { state="servicing"; leg=svcLeg.label; strategy=svcLeg.strategy; }
        else {
          const prev = (tick>0)? posAt(plan, tick-1) : pos;
          if (prev && prev[0]===pos[0] && prev[1]===pos[1]) state="holding";
          else state="moving";
          // determine current leg (between services)
          for (const l of plan.legs) {
            const a=l.steps[l.steps.length-1].tick;
            if (tick >= l.steps[0].tick && tick <= Math.max(a, a+(l.dwell||0))) { leg=l.label; strategy=l.strategy; break; }
          }
        }
        for (let i=tick;i<=plan.completionTick;i++) remaining.push(posAt(plan,i));
        // heading
        if (tick>0) {
          const prev = posAt(plan, tick-1);
          if (pos[0] < prev[0]) headings[r]=0;
          else if (pos[0] > prev[0]) headings[r]=1;
          else if (pos[1] < prev[1]) headings[r]=2;
          else if (pos[1] > prev[1]) headings[r]=3;
        }
      }
      return {
        id: r,
        serviceId: serviceIds[r],
        color: robotColors[r],
        square: [pos[0], pos[1]],
        footprint: best.wh.footprint([pos[0],pos[1]], headings[r]).map(s=>[s[0],s[1]]),
        remainingRoute: remaining.map(p=>[p[0],p[1]]),
        state,
        order,
        leg,
        strategy,
        finish,
      };
    });
    // locks active
    const activeLocks = [];
    for (const plan of plans) {
      for (const l of plan.legs) {
        if (!l.dwell) continue;
        const arrival = l.steps[l.steps.length-1].tick;
        if (tick >= arrival && tick < arrival + (l.dwell||0)) {
          activeLocks.push({ robot: plan.robot, squares: l.locked.map(s=>[s[0],s[1]]) });
        }
      }
    }
    snapshot = {
      tick,
      makespan,
      runState: snapshot.runState || "running",
      elapsed: (snapshot.elapsed||0) + secondsPerTick/speed, // approximate
      issued: snapshot.issued,
      delivered: snapshot.delivered,
      throughput: snapshot.throughput,
      conflicts: confCount,
      locks: activeLocks,
      robots: robotSnaps,
    };
    // fire events
    for (const plan of plans) {
      const pickLeg = plan.legs[0];
      if (pickLeg && pickLeg.dwell) {
        const arrival = pickLeg.steps[pickLeg.steps.length-1].tick;
        const key = plan.robot+"|pick|"+pickLeg.label;
        if (tick === arrival + pickLeg.dwell && !fired.has(key)) {
          fired.add(key);
          const o = orderById[plan.order];
          (async()=>{
            try { await client.reportPicked(plan.order, serviceIds[plan.robot].toLowerCase()==='r1'?plan.robot:plan.robot, o? o.cube : undefined); }
            catch(e){ console.log("reportPicked rejected:", e.message || e); }
          })();
        }
      }
      const dropLeg = plan.legs.length>1 ? plan.legs[1] : null;
      if (dropLeg && dropLeg.dwell) {
        const arrival = dropLeg.steps[dropLeg.steps.length-1].tick;
        const key = plan.robot+"|deliver|"+dropLeg.label;
        if (tick === arrival + dropLeg.dwell && !fired.has(key)) {
          fired.add(key);
          (async()=>{
            try { await client.reportDelivered(plan.order, plan.robot); }
            catch(e){ console.log("reportDelivered rejected:", e.message || e); }
          })();
        }
      }
    }
    // every 4 ticks refresh
    if (tick % 4 === 0) {
      try {
        const summary = await client.getRunSummary();
        const orders = await client.getOrders();
        snapshot.runState = summary.state;
        snapshot.elapsed = summary.elapsedSeconds;
        snapshot.issued = summary.issued;
        snapshot.delivered = summary.delivered;
        snapshot.throughput = summary.throughput;
        // telemetry
        const poses = robotSnaps.map(r=>({
          id: serviceIds[r.id],
          x: r.square[1]*10 + 5,
          y: (warehouse.rows - 1 - r.square[0])*10 + 5,
          heading: headings[r.id],
        }));
        client.sendTelemetry(poses);
      } catch(e) {
        // ignore
      }
    }
  }
}

async function main() {
  // state fn
  if (dashboardOn) {
    await liveFloor.start(parseInt(dashPort,10), warehouse, ()=>snapshot, async (body)=>{
      const res = await fetch(base+"/inject", { method:"POST", headers:{ "team-token": token, "Content-Type":"application/json" }, body: JSON.stringify({ station: body.station, priority: body.priority }) });
      return res.json();
    }, async ()=> client.getOrders());
  }

  // trap SIGINT
  process.on("SIGINT", async ()=>{
    console.log("\nFinal scorecard:");
    try { console.log(JSON.stringify(await client.getRunSummary(), null, 2)); } catch{}
    process.exit(0);
  });

  let noticeShown=false;
  while (true) {
    let summary, orders;
    try {
      summary = await client.getRunSummary();
      orders = await client.getOrders();
    } catch(e) {
      if (!noticeShown) { console.log("Service unreachable, retrying..."); noticeShown=true; }
      await sleep(2000);
      continue;
    }
    noticeShown=false;
    if (summary.state === "waiting") {
      try { await fetch(base+"/start", { method:"POST", headers:{ "team-token": token } }); console.log("auto-started run"); } catch{}
      await sleep(1000);
      continue;
    }
    if (summary.state === "finished") {
      snapshot.runState = "finished";
      await sleep(2000);
      continue;
    }
    const pending = (orders.orders||[]).filter(o=>o.status==="pending");
    pending.sort((a,b)=> (a.priority==="urgent"?0:1)-(b.priority==="urgent"?0:1) || a.issuedAt-b.issuedAt);
    const chosen = pending.slice(0,3);
    if (chosen.length === 0) {
      await sleep(1000);
      continue;
    }
    console.log("Round: "+chosen.map(o=>o.id+" "+o.station+" "+o.priority).join(", "));
    snapshot.runState = "running";
    await runRound(chosen, {});
    try {
      const sc = await client.getRunSummary();
      console.log(`Progress: issued ${sc.issued} delivered ${sc.delivered} throughput ${sc.throughput.toFixed(2)} req/min`);
    } catch{}
    await sleep(500);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });