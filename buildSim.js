const fs = require("fs");
const path = require("path");
const { createWarehouse } = require("./out/warehouse");
const { Planner, checkConflicts } = require("./out/planner");
const { squareKey } = require("./out/types");

const COLORS = ["#38bdf8", "#f472b6", "#34d399"];

function timelinePos(plan, t) {
  const steps = [];
  for (const leg of plan.legs) for (const s of leg.steps) steps.push(s);
  steps.sort((a, b) => a.tick - b.tick);
  let last = steps.length ? steps[0].square : null;
  for (const s of steps) {
    if (s.tick <= t) last = s.square;
    else break;
  }
  if (t < (plan.startTick || 0)) {
    const ls = plan.legs[0].steps;
    return ls && ls.length ? ls[0].square : last;
  }
  if (t > plan.completionTick) {
    const ls = plan.legs[plan.legs.length - 1].steps;
    return ls && ls.length ? ls[ls.length - 1].square : last;
  }
  return last;
}

function isServiceTick(plan, t) {
  for (let i = 0; i < plan.legs.length; i++) {
    const leg = plan.legs[i];
    if (!leg.dwell) continue;
    const arrival = leg.steps[leg.steps.length - 1].tick;
    if (t >= arrival && t < arrival + leg.dwell) return i;
  }
  return -1;
}

function buildModel(pickDuration, dropDuration) {
  const wh = createWarehouse();
  const orders = [
    { id: "order1", robot: "robot one", station: "station one", priority: 1 },
    { id: "order2", robot: "robot two", station: "station five", priority: 2 },
    { id: "order3", robot: "robot three", station: "station two", priority: 3 },
  ];
  const planner = new Planner(wh, { pickDuration, dropDuration });
  const plans = planner.planAll(orders);

  const grid = [];
  for (let r = 0; r < wh.rows; r++) {
    const row = [];
    for (let c = 0; c < wh.cols; c++) {
      const s = [r, c];
      row.push({ walkable: wh.isWalkable(s), area: wh.areaOf(s) || null });
    }
    grid.push(row);
  }

  const homes = {};
  for (const p of plans)
    homes[p.robot] = wh.getRest(
      p.robot.endsWith(" home") ? p.robot : p.robot + " home",
    );

  const locks = [];
  for (const p of plans) {
    for (const leg of p.legs) {
      if (leg.locked && leg.locked.length && leg.dwell > 0) {
        const arrival = leg.steps[leg.steps.length - 1].tick;
        locks.push({
          robot: p.robot,
          from: arrival,
          to: arrival + leg.dwell,
          squares: leg.locked.map((s) => [s[0], s[1]]),
        });
      }
    }
  }

  const makespan = Math.max(...plans.map((p) => p.completionTick));
  const conflicts = checkConflicts(plans, wh, {
    pickDuration,
    dropDuration,
    turnCost: 1,
  }).map((c) => `tick ${c.tick} [${c.kind}] ${c.detail}`);

  const robots = plans.map((p, idx) => {
    const home = homes[p.robot];
    const path = [];
    const footprints = [];
    const activity = [];
    let lastHeading = 0;
    for (let t = 0; t <= makespan; t++) {
      let pos;
      if (t < p.startTick) pos = home;
      else if (t > p.completionTick) {
        const ls = p.legs[p.legs.length - 1].steps;
        pos = ls[ls.length - 1].square;
      } else {
        pos = timelinePos(p, t) || home;
      }
      if (path.length > 0) {
        const prev = path[path.length - 1];
        if (pos[0] < prev[0]) lastHeading = 0;
        else if (pos[0] > prev[0]) lastHeading = 1;
        else if (pos[1] < prev[1]) lastHeading = 2;
        else if (pos[1] > prev[1]) lastHeading = 3;
      }
      path.push([pos[0], pos[1]]);
      footprints.push(
        wh.footprint([pos[0], pos[1]], lastHeading).map((s) => [s[0], s[1]]),
      );
      let act = "idle";
      if (t > p.completionTick) act = "done";
      else if (t < p.startTick) act = "idle";
      else {
        const si = isServiceTick(p, t);
        if (si >= 0) act = "servicing";
        else {
          const prevPos = t > 0 ? path[path.length - 2] : null;
          if (prevPos && prevPos[0] === pos[0] && prevPos[1] === pos[1])
            act = "holding";
          else act = "moving";
        }
      }
      activity.push(act);
    }
    const legSummary = p.legs.map((leg) => ({
      label: leg.label,
      strategy: leg.strategy,
      from: [leg.from[0], leg.from[1]],
      to: [leg.to[0], leg.to[1]],
      startTick: leg.steps[0].tick,
      arrivalTick: leg.steps[leg.steps.length - 1].tick,
      dwell: leg.dwell,
      optimal: leg.optimal,
    }));
    return {
      id: p.robot,
      order: p.order,
      color: COLORS[idx % COLORS.length],
      path,
      footprints,
      legs: legSummary,
      activity,
      completion: p.completionTick,
    };
  });

  return {
    rows: wh.rows,
    cols: wh.cols,
    grid,
    robots,
    locks,
    makespan,
    conflicts,
    options: { pickDuration, dropDuration, turnCost: 1 },
  };
}

function htmlPage(model) {
  const json = JSON.stringify(model);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WMS Sim</title>
<style>
:root{color-scheme:dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#090f1a;color:#e5edf7}
*{box-sizing:border-box}body{margin:0}#wrap{display:flex;min-height:100vh}
#canvasWrap{flex:1;min-width:0;background:radial-gradient(ellipse at center,#142033 0%,#090f1a 75%);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
canvas{max-width:100%;height:auto;background:#0b1220;border:1px solid #26364c;border-radius:12px;box-shadow:0 20px 70px #0008}
#panel{width:340px;flex:0 0 340px;padding:22px;overflow:auto;background:#101827;border-left:1px solid #26364c}
h2{font-size:20px;margin:0 0 16px;letter-spacing:.02em}.toolbar{display:flex;gap:6px;margin-bottom:20px}
button{border:1px solid #34465f;background:#1b2a3e;color:#e5edf7;padding:8px 10px;border-radius:7px;cursor:pointer;font-weight:600}
button:hover{background:#273b55}button.primary{background:#0e7490;border-color:#0891b2}button.primary:hover{background:#0891b2}
.timeline,.speedControl{display:block;color:#a9b9cc;font-size:12px;margin:16px 0}
.timeline strong,.speedControl strong{float:right;color:#e5edf7;font-variant-numeric:tabular-nums}
input[type=range]{display:block;width:100%;accent-color:#38bdf8;margin-top:10px}
.sectionTitle{margin:22px 0 10px;color:#8295ad;font-size:11px;text-transform:uppercase;letter-spacing:.12em}
.robotCard{margin:9px 0;padding:12px;border:1px solid #293a50;border-left:3px solid var(--robot-color);border-radius:9px;background:linear-gradient(120deg,#182438,#121c2b)}
.cardHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.robotName{font-weight:700}.badge{padding:3px 7px;border-radius:20px;background:#25364c;color:#c8d7e8;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.robotDetails{color:#9fb0c4;font-size:12px;line-height:1.7}.robotDetails strong{color:#e5edf7;font-weight:600}
.progress{height:4px;background:#26364a;border-radius:4px;margin-top:9px;overflow:hidden}.progress span{display:block;height:100%;background:var(--robot-color);border-radius:4px}
#verify{margin-top:16px;padding:10px;border:1px solid #293a50;border-radius:8px;color:#86efac;font-size:12px}
@media(max-width:760px){#wrap{height:auto;min-height:100vh;flex-direction:column}#canvasWrap{min-height:55vh;padding:12px}#panel{width:100%;flex:auto;border-left:0;border-top:1px solid #26364c}}
</style>
</head><body><div id="wrap"><div id="canvasWrap"><canvas id="c"></canvas></div><div id="panel">
<h2>Warehouse simulation</h2>
<div class="toolbar"><button id="play" class="primary">▶ Play</button><button id="stepBack" aria-label="Previous tick">◀</button><button id="stepFwd" aria-label="Next tick">▶</button><button id="reset">Reset</button></div>
<label class="timeline">Simulation time <strong><span id="tickLabel">0</span> / <span id="maxLabel">0</span> ticks</strong><input id="scrub" type="range" min="0" max="0" value="0"></label>
<label class="speedControl">Playback speed <strong><span id="speedLabel">24</span> ticks/sec</strong><input id="speed" type="range" min="1" max="40" value="24"></label>
<div class="sectionTitle">Robot fleet</div><div id="robots"></div><div id="verify"></div>
</div></div>
<script>
const M = ${json};
const canvas=document.getElementById('c');
const S=20, PAD=2;
canvas.width = M.cols*S; canvas.height = M.rows*S;
const ctx=canvas.getContext('2d');
let tick=0, playing=false, last=0, speed=24, tickProgress=0;
const maxTick=M.makespan;
document.getElementById('scrub').max=maxTick;
document.getElementById('maxLabel').textContent=maxTick;
function colorForArea(a){ if(!a) return '#333'; if(a.startsWith('station')) return '#22c55e'; if(a==='drop zone') return '#3b82f6'; if(a.endsWith('home')) return '#a855f7'; return '#4ade80'; }
function isLocked(sq,t){ for(const L of M.locks){ if(t>=L.from && t<=L.to && L.squares.some(s=>s[0]===sq[0]&&s[1]===sq[1])) return true; } return false; }
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<M.rows;r++) for(let c=0;c<M.cols;c++){
    const cell=M.grid[r][c];
    ctx.fillStyle = cell.walkable ? (cell.area?colorForArea(cell.area):'#2a3a2a') : '#7f1d1d';
    ctx.fillRect(c*S+PAD, r*S+PAD, S-PAD*2, S-PAD*2);
    if(isLocked([r,c],tick)){ ctx.fillStyle='rgba(245,158,11,0.35)'; ctx.fillRect(c*S+PAD,r*S+PAD,S-PAD*2,S-PAD*2); }
  }
  // rulers every 5
  ctx.strokeStyle='#555'; ctx.lineWidth=1;
  for(let i=0;i<=M.rows;i+=5){ ctx.beginPath(); ctx.moveTo(0,i*S); ctx.lineTo(canvas.width,i*S); ctx.stroke(); }
  for(let i=0;i<=M.cols;i+=5){ ctx.beginPath(); ctx.moveTo(i*S,0); ctx.lineTo(i*S,canvas.height); ctx.stroke(); }
  // robots
  for(const rob of M.robots){
    const pos=rob.path[tick];
    const next=rob.path[Math.min(tick+1,maxTick)];
    const progress=playing && tick<maxTick ? tickProgress : 0;
    const row=pos[0]+(next[0]-pos[0])*progress;
    const col=pos[1]+(next[1]-pos[1])*progress;
    const fp=rob.footprints[tick];
    // remaining route faint
    ctx.strokeStyle=rob.color; ctx.globalAlpha=0.2; ctx.beginPath();
    let started=false;
    for(let i=tick;i<rob.path.length;i++){ const p=rob.path[i]; if(!started){ctx.moveTo(p[1]*S+S/2,p[0]*S+S/2);started=true;} else ctx.lineTo(p[1]*S+S/2,p[0]*S+S/2); }
    ctx.stroke(); ctx.globalAlpha=1;
    // footprint
    for(const f of fp){
      const x=f[1]*S+PAD*2, y=f[0]*S+PAD*2, w=S-PAD*4, h=S-PAD*4;
      ctx.fillStyle=rob.color; ctx.globalAlpha=0.14;
      ctx.beginPath(); ctx.roundRect(x,y,w,h,4); ctx.fill();
      ctx.strokeStyle=rob.color; ctx.globalAlpha=0.5; ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(x,y,w,h,4); ctx.stroke(); ctx.globalAlpha=1;
    }
    // Heading follows the next planned move; when stopped, use the last move.
    let dRow=next[0]-pos[0], dCol=next[1]-pos[1];
    if(dRow===0 && dCol===0 && tick>0){ dRow=pos[0]-rob.path[tick-1][0]; dCol=pos[1]-rob.path[tick-1][1]; }
    const angle=Math.atan2(dRow,dCol);
    const x=col*S+S/2, y=row*S+S/2;
    ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
    ctx.shadowColor=rob.color; ctx.shadowBlur=10;
    ctx.fillStyle='#08111d'; ctx.beginPath(); ctx.roundRect(-8,-7,16,14,5); ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle='#26384e'; ctx.beginPath(); ctx.roundRect(-6,-6,12,12,4); ctx.fill();
    ctx.fillStyle=rob.color; ctx.beginPath(); ctx.roundRect(0,-4,5,8,2); ctx.fill();
    ctx.fillStyle='#dcecff'; ctx.beginPath(); ctx.arc(-2,0,1.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#08111d';
    ctx.beginPath(); ctx.roundRect(-5,-9,4,2,1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(2,-9,4,2,1); ctx.fill();
    ctx.restore();
    if(rob.activity[tick]==='servicing'){
      ctx.shadowColor=rob.color; ctx.shadowBlur=12; ctx.fillStyle=rob.color;
      ctx.globalAlpha=.18; ctx.beginPath(); ctx.arc(x,y,S*.65,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; ctx.globalAlpha=1;
    }
    ctx.font='bold 9px sans-serif'; ctx.textAlign='center';
    const label=rob.id.replace('robot ','R');
    const labelWidth=ctx.measureText(label).width+8;
    ctx.fillStyle='#08111de8'; ctx.beginPath(); ctx.roundRect(x-labelWidth/2,y+8,labelWidth,12,5); ctx.fill();
    ctx.fillStyle=rob.color; ctx.fillText(label,x,y+17); ctx.textAlign='left';
  }
  // labels
  document.getElementById('tickLabel').textContent=tick;
}
function updatePanel(){
  const div=document.getElementById('robots'); div.innerHTML='';
  for(const rob of M.robots){
    const card=document.createElement('div'); card.className='robotCard';
    const act=rob.activity[tick];
    let curLeg=null;
    for(const leg of rob.legs){ if(tick>=leg.startTick && tick<=leg.arrivalTick+leg.dwell) curLeg=leg; }
    const progress=Math.min(100,Math.round(tick/Math.max(1,rob.completion)*100));
    card.style.setProperty('--robot-color',rob.color);
    card.innerHTML='<div class="cardHead"><span class="robotName">'+rob.id+'</span><span class="badge">'+act+'</span></div>'+
      '<div class="robotDetails"><strong>Position</strong> '+rob.path[tick][0]+', '+rob.path[tick][1]+'<br>'+
      '<strong>Task</strong> '+(curLeg?curLeg.label:'Waiting for start')+
      (curLeg?' · '+curLeg.strategy:'')+'<br><strong>Complete</strong> tick '+rob.completion+'</div>'+
      '<div class="progress"><span style="width:'+progress+'%"></span></div>';
    div.appendChild(card);
  }
  const v=document.getElementById('verify');
  v.innerHTML = M.conflicts.length? '<span style="color:#f87171">Conflicts: '+M.conflicts.length+'</span><ul>'+M.conflicts.map(c=>'<li>'+c+'</li>').join('')+'</ul>' : '<span style="color:#4ade80">&#10003; No conflicts</span>';
}
function syncPlayButton(){ const button=document.getElementById('play'); button.textContent=playing?'❚❚ Pause':'▶ Play'; }
function step(n){ tick=Math.max(0,Math.min(maxTick,tick+n)); tickProgress=0; document.getElementById('scrub').value=tick; draw(); updatePanel(); }
document.getElementById('play').onclick=()=>{ if(tick>=maxTick) step(-maxTick); playing=!playing; syncPlayButton(); };
document.getElementById('stepBack').onclick=()=>step(-1);
document.getElementById('stepFwd').onclick=()=>step(1);
document.getElementById('reset').onclick=()=>{tick=0;tickProgress=0;document.getElementById('scrub').value=0;playing=false;syncPlayButton();draw();updatePanel();};
document.getElementById('scrub').oninput=(e)=>{tick=parseInt(e.target.value);tickProgress=0;draw();updatePanel();};
function loop(ts){
  if(!last) last=ts;
  const dt=ts-last; last=ts;
  if(playing){
    tickProgress+=dt*speed/1000;
    while(tickProgress>=1 && tick<maxTick){ tick++; tickProgress-=1; document.getElementById('scrub').value=tick; updatePanel(); }
    if(tick>=maxTick){ tickProgress=0; playing=false; syncPlayButton(); }
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
document.getElementById('speed').oninput=(e)=>{speed=parseInt(e.target.value);document.getElementById('speedLabel').textContent=speed;};
draw(); updatePanel();
</script></body></html>`;
}

if (require.main === module) {
  const model = buildModel(4, 2);
  const html = htmlPage(model);
  fs.writeFileSync(path.join(__dirname, "sim.html"), html);
  console.log(
    "Wrote sim.html. makespan=" +
      model.makespan +
      " conflicts=" +
      model.conflicts.length,
  );
}
module.exports = { buildModel, htmlPage };
