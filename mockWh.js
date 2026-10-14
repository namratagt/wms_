const http = require("http");
const url = require("url");

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
const port = parseInt(args.port || "8000", 10);
const duration = parseFloat(args.duration || args.time || "0");
const scenario = (args.scenario || "sample").toLowerCase();
const seed = parseInt(args.seed || "42", 10);
const scale = parseFloat(args.speed || args.scale || "1");
const token = args.token || "team-token-123";
const autoStart = !!(args.autoStart || args.autostart || args.auto);

const STATIONS = ["station one","station two","station three","station four","station five","station six"];
const RING_ONLY = new Set(["station five","station six"]);

let rngState = seed >>> 0;
function rng(){ // mulberry32
  rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeOrder(i, station, priority, cube, issueTime) {
  const PR = priority === "urgent" ? "urgent" : "normal";
  return {
    id: "ORD-" + String(i).padStart(4,"0"),
    issuedAt: issueTime,
    station,
    cube: cube || ("CUBE-" + String(i).padStart(4,"0")),
    destination: "drop zone",
    priority: PR,
    status: "pending",
    robot: null,
    pickedAt: null,
    deliveredAt: null,
    cycleTime: null,
  };
}

function sampleOrders() {
  const specs = [
    [0, "station five", "normal"],
    [0, "station one", "normal"],
    [2, "station two", "normal"],
    [8, "station three", "normal"],
    [9, "station six", "normal"],
  ];
  return specs.map((s,i)=>makeOrder(i+1, s[1], s[2], null, s[0]));
}

function escalatingOrders() {
  const out = [];
  let t = rng()*3;
  let i = 0;
  const maxT = duration>0 ? duration : 7200;
  // arrival gap shrinks 12 -> 3 roughly over run
  while (t < maxT) {
    i++;
    const progress = t / (duration>0?duration:1800);
    const gapMean = 12 - 9*Math.min(1, progress);
    const burst = 1 + (progress > 0.5 && rng() < 0.4 ? 1 : 0);
    for (let b=0;b<burst;b++){
      const station = STATIONS[Math.floor(rng()*STATIONS.length)];
      const urgent = (progress > 0.6 && rng() < 0.25);
      out.push(makeOrder(i*10+b, station, urgent?"urgent":"normal", null, Math.round(t)));
      t += (rng()*0.5) + 0.2;
    }
    t += gapMean* (0.7 + rng()*0.6);
    if (out.length > 2000) break;
  }
  return out;
}

let scenarioName = scenario;
let allOrders = scenarioName === "escalating" ? escalatingOrders() : sampleOrders();

let state = "waiting";
let startedAt = null;
let finished = false;

function elapsedRun() {
  if (!startedAt) return 0;
  const wall = (Date.now() - startedAt) / 1000;
  let run = wall * scale;
  if (duration > 0) {
    if (run >= duration) { run = duration; state = "finished"; }
  }
  return run;
}
function nowTime(){ return state==="waiting" ? 0 : elapsedRun(); }

function issuedOrders() {
  const t = nowTime();
  return allOrders.filter(o => o.issuedAt <= t);
}
function openOrders() {
  return issuedOrders().filter(o => o.status !== "delivered");
}

function issuedCount(){ return issuedOrders().length; }
function deliveredCount(){ return issuedOrders().filter(o=>o.status==="delivered").length; }
function deliveredOrders(){ return issuedOrders().filter(o=>o.status==="delivered"); }

function runSummary() {
  const t = nowTime();
  const elapsed = t;
  const remaining = duration>0 ? Math.max(0, duration - t) : -1;
  const delivered = deliveredCount();
  const throughput = elapsed > 0 ? (delivered / elapsed) * 60 : 0;
  return {
    time: t,
    state,
    elapsedSeconds: elapsed,
    remainingSeconds: remaining,
    issued: issuedCount(),
    delivered,
    throughput,
  };
}

function scorecard() {
  const s = runSummary();
  const delivered = deliveredOrders();
  const cycles = delivered.map(o=>o.cycleTime).filter(x=>x!=null);
  const mean = cycles.length ? cycles.reduce((a,b)=>a+b,0)/cycles.length : 0;
  const worst = cycles.length ? Math.max(...cycles) : 0;
  const ring = delivered.filter(o=>RING_ONLY.has(o.station)).length;
  const ringShare = delivered.length ? ring/delivered.length : 0;
  return Object.assign({}, s, {
    open: openOrders().length,
    unstarted: openOrders().filter(o=>o.status==="pending").length,
    meanCycleTime: mean,
    worstCycleTime: worst,
    ringOnlyShare: ringShare,
  });
}

function tokenOk(req) {
  const h = req.headers["team-token"] || req.headers["x-team-token"] || req.headers["Team-Token"];
  return h === token;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" });
  res.end(JSON.stringify(body));
}

function parseBody(req, cb) {
  let data="";
  let size=0;
  req.on("data", chunk=>{
    size += chunk.length;
    if (size > 1024*1024) { req.destroy(); return; }
    data += chunk;
  });
  req.on("end", ()=>{
    if (!data) return cb(null, {});
    try { cb(null, JSON.parse(data)); } catch(e){ cb(e, {}); }
  });
}

const server = http.createServer((req, res)=>{
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  if (req.method === "OPTIONS") { res.writeHead(204, {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*"}); res.end(); return; }

  if (!tokenOk(req)) { sendJson(res, 401, { error:"unauthorized" }); return; }

  // control helpers
  const isStart = pathname === "/start" || pathname === "/control/start" || pathname === "/run/start";
  const isFinish = pathname === "/finish" || pathname === "/control/finish" || pathname === "/run/finish";
  const isReset = pathname === "/reset" || pathname === "/control/reset";
  const isScore = pathname === "/scorecard" || pathname === "/control/scorecard";
  const isInject = pathname === "/order" || pathname === "/inject" || pathname === "/control/order" || pathname === "/admin/order" || pathname === "/orders/inject";

  if (isStart && req.method === "POST") { state="running"; if(!startedAt) startedAt=Date.now(); sendJson(res,200,{state}); return; }
  if (isFinish && req.method === "POST") { state="finished"; if(!startedAt) startedAt=Date.now(); finished=true; sendJson(res,200,{state}); return; }
  if (isReset && req.method === "POST") {
    allOrders = scenarioName === "escalating" ? escalatingOrders() : sampleOrders();
    state="waiting"; startedAt=null; finished=false;
    sendJson(res,200,{state:"reset"});
    return;
  }
  if (isScore && req.method === "GET") { sendJson(res,200,scorecard()); return; }
  if (isInject && req.method === "POST") {
    parseBody(req, (err,body)=>{
      if(err){ sendJson(res,400,{error:"bad json"}); return; }
      const st = body.station || "station one";
      const pr = body.priority || "normal";
      const cube = body.cube || null;
      const issueTime = nowTime();
      const o = makeOrder(allOrders.length+1, st, pr, cube, issueTime);
      allOrders.push(o);
      sendJson(res,200,{ id:o.id, station:o.station, cube:o.cube, priority:o.priority, issuedAt:o.issuedAt });
    });
    return;
  }

  // documented endpoints
  if (pathname === "/orders" && req.method === "GET") {
    sendJson(res, 200, { time: nowTime(), state, orders: openOrders() });
    return;
  }
  if (pathname === "/run" && req.method === "GET") {
    sendJson(res, 200, runSummary());
    return;
  }
  // picked: /orders/{id}/picked
  const mPicked = pathname.match(/^\/orders\/([^/]+)\/picked$/);
  if (mPicked && req.method === "POST") {
    const id = decodeURIComponent(mPicked[1]);
    const order = issuedOrders().find(o=>o.id===id) || allOrders.find(o=>o.id===id);
    if (!order) { sendJson(res,404,{error:"not found"}); return; }
    parseBody(req,(err,body)=>{
      if(err){ sendJson(res,400,{error:"bad json"}); return; }
      if (order.status === "picked" || order.status === "delivered") { sendJson(res,200,{status:order.status, id:order.id}); return; }
      if (body.cube && order.cube && body.cube !== order.cube) { sendJson(res,409,{error:"conflict", expected:order.cube, received:body.cube}); return; }
      order.status = "picked";
      order.robot = body.robot || null;
      order.pickedAt = nowTime();
      sendJson(res,200,{status:"picked", id:order.id});
    });
    return;
  }
  const mDel = pathname.match(/^\/orders\/([^/]+)\/delivered$/);
  if (mDel && req.method === "POST") {
    const id = decodeURIComponent(mDel[1]);
    const order = issuedOrders().find(o=>o.id===id) || allOrders.find(o=>o.id===id);
    if (!order) { sendJson(res,404,{error:"not found"}); return; }
    parseBody(req,(err,body)=>{
      if(err){ sendJson(res,400,{error:"bad json"}); return; }
      if (order.status !== "picked" && order.status !== "delivered") { sendJson(res,409,{error:"delivered before picked"}); return; }
      if (order.status === "delivered") { sendJson(res,200,{status:"delivered", id:order.id}); return; }
      order.status = "delivered";
      order.deliveredAt = nowTime();
      order.cycleTime = nowTime() - order.issuedAt;
      if (body.robot) order.robot = body.robot;
      sendJson(res,200,{status:"delivered", id:order.id});
    });
    return;
  }
  if (pathname === "/telemetry" && req.method === "POST") {
    parseBody(req,(err,body)=>{ sendJson(res,200,{ok:true}); });
    return;
  }

  sendJson(res, 404, { error:"not found" });
});

server.listen(port, ()=>{
  console.log("Mock WMS listening on http://localhost:"+port);
  console.log("scenario:", scenarioName);
  console.log("duration:", duration===0?"unlimited":duration+"s");
  console.log("token:", token);
  console.log("state:", state);
  console.log("inject example: curl -X POST http://localhost:"+port+"/inject -H 'team-token: "+token+"' -H 'Content-Type: application/json' -d '{\"station\":\"station one\",\"priority\":\"normal\"}'");
  if (autoStart) { state="running"; startedAt=Date.now(); console.log("auto-started"); }
});
process.on("SIGINT", ()=>{ console.log("\nscorecard:"); console.log(JSON.stringify(scorecard(),null,2)); process.exit(0); });