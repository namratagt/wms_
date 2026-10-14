const http = require("http");
const { squareKey } = require("./out/types");

function start(port, warehouse, stateFn, placeOrderFn, fetchOrdersFn) {
  const server = http.createServer(async (req, res) => {
    const parsed = require("url").parse(req.url, true);
    const pathname = parsed.pathname || "/";
    if (req.method === "OPTIONS") { res.writeHead(204, {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*"}); res.end(); return; }

    if (pathname === "/arena") {
      // static arena model
      const grid = [];
      for (let r=0;r<warehouse.rows;r++){ const row=[]; for(let c=0;c<warehouse.cols;c++){ const s=[r,c]; row.push({ walkable: warehouse.isWalkable(s), area: warehouse.areaOf(s)||null }); } grid.push(row); }
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({ rows: warehouse.rows, cols: warehouse.cols, grid }));
      return;
    }
    if (pathname === "/state") {
      const snap = (typeof stateFn === "function") ? stateFn() : {};
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify(snap));
      return;
    }
    if (pathname === "/warehouse-orders") {
      try {
        const data = await fetchOrdersFn();
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify(data));
      } catch(e) {
        res.writeHead(500, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
    if (pathname === "/order" && req.method === "POST") {
      let data=""; req.on("data", d=>data+=d); req.on("end", async ()=>{
        let body={}; try{ body=JSON.parse(data||"{}"); }catch{}
        try { const r = await placeOrderFn(body); res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify(r)); }
        catch(e){ res.writeHead(500, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:String(e)})); }
      });
      return;
    }
    // root
    res.writeHead(200, {"Content-Type":"text/html"});
    res.end(htmlPage());
  });

  const tryListen = (p) => new Promise((resolve,reject)=>{
    server.listen(p, ()=>resolve(p));
    server.on("error", (e)=>{
      if (e && e.code === "EADDRINUSE") {
        // fallback handled outside? We just reject
      }
      reject(e);
    });
  });
  return tryListen(port).then(p=>{ console.log("Dashboard on http://localhost:"+p); return server; }).catch(e=>{
    if (e.code === "EADDRINUSE") {
      console.log("Port in use, dashboard not started."); return null;
    }
    throw e;
  });
}

function htmlPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live Floor</title>
<style>body{margin:0;font-family:sans-serif;background:#111;color:#eee}#wrap{display:flex;height:100vh}#canvasWrap{flex:1;background:#0b0b0b;display:flex;align-items:center;justify-content:center}canvas{background:#0b0b0b}#panel{width:360px;padding:12px;overflow:auto;border-left:1px solid #333}button{margin:2px}input,select{width:100%}.card{margin:8px 0;padding:8px;border:1px solid #333;border-radius:6px}</style>
</head><body><div id="wrap"><div id="canvasWrap"><canvas id="c"></canvas></div><div id="panel">
<h2>Live floor</h2>
<div id="stats"></div>
<div id="robots"></div>
<h3>Order</h3>
<select id="station"><option>station one</option><option>station two</option><option>station three</option><option>station four</option><option>station five</option><option>station six</option></select>
<select id="priority"><option value="normal">normal</option><option value="urgent">urgent</option></select>
<button id="place">Place Order</button>
<button id="fetch">Fetch from service</button>
<div id="q"></div>
<div id="verify"></div>
</div></div>
<script>
const S=20,PAD=2; const canvas=document.getElementById('c'); let arena=null, snap=null;
async function loadArena(){ const r=await fetch('/arena'); arena=await r.json(); canvas.width=arena.cols*S; canvas.height=arena.rows*S; draw(); }
function colorForArea(a){ if(!a) return '#333'; if(a&&a.startsWith('station')) return '#22c55e'; if(a==='drop zone') return '#3b82f6'; if(a&&a.endsWith('home')) return '#a855f7'; return '#4ade80'; }
function draw(){
  if(!arena) return;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<arena.rows;r++) for(let c=0;c<arena.cols;c++){
    const cell=arena.grid[r][c];
    ctx.fillStyle = cell.walkable ? (cell.area?colorForArea(cell.area):'#2a3a2a') : '#7f1d1d';
    ctx.fillRect(c*S+PAD,r*S+PAD,S-PAD*2,S-PAD*2);
  }
  if(snap){
    // locks
    for(const L of (snap.locks||[])){
      for(const s of L.squares||[]){
        ctx.fillStyle='rgba(245,158,11,0.35)';
        ctx.fillRect(s[1]*S+PAD,s[0]*S+PAD,S-PAD*2,S-PAD*2);
      }
    }
    for(const rob of (snap.robots||[])){
      const pos=rob.square;
      ctx.fillStyle=rob.color; ctx.globalAlpha=0.85;
      ctx.beginPath(); ctx.arc(pos[1]*S+S/2, pos[0]*S+S/2, S/2.5, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      // route remaining
      if(rob.remainingRoute){ ctx.strokeStyle=rob.color; ctx.globalAlpha=0.2; ctx.beginPath(); let st=false; for(const p of rob.remainingRoute){ if(!st){ctx.moveTo(p[1]*S+S/2,p[0]*S+S/2);st=true;}else ctx.lineTo(p[1]*S+S/2,p[0]*S+S/2);} ctx.stroke(); ctx.globalAlpha=1; }
      ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.fillText((rob.id||'').split(' ')[1]||'', pos[1]*S+4, pos[0]*S+S-4);
      if(rob.state) { ctx.fillStyle='#ddd'; ctx.fillText(rob.state, pos[1]*S+4, pos[0]*S+12); }
    }
    // area labels centered
    const seen=new Set();
    for(let r=0;r<arena.rows;r++) for(let c=0;c<arena.cols;c++){
      const cell=arena.grid[r][c];
      if(cell.area && !arena.grid[r][c].walkable===false){
        // center label at area anchor approximate: draw on first cell? skip to avoid clutter
      }
    }
  }
}
async function poll(){
  try { const r=await fetch('/state'); snap=await r.json(); draw(); updatePanel(); } catch{}
  setTimeout(poll,100);
}
function updatePanel(){
  if(!snap) return;
  const s=document.getElementById('stats');
  s.innerHTML='state: '+snap.runState+' elapsed: '+(snap.elapsed||0).toFixed?snap.elapsed.toFixed(1):snap.elapsed+' issued:'+snap.issued+' delivered:'+snap.delivered+' throughput:'+ (snap.throughput||0).toFixed(2) + ' conflicts:'+snap.conflicts;
  const rdiv=document.getElementById('robots'); rdiv.innerHTML='';
  for(const rob of (snap.robots||[])){
    const card=document.createElement('div'); card.className='card';
    card.innerHTML='<b>'+rob.id+'</b> '+rob.serviceId+'<br>'+rob.state+' @ '+rob.square[0]+','+rob.square[1]+'<br>leg: '+(rob.leg||'')+' '+(rob.strategy||'')+'<br>finish:'+rob.finish;
    rdiv.appendChild(card);
  }
  document.getElementById('verify').innerHTML = (snap.conflicts||0)===0 ? '<span style="color:#4ade80">&#10003; no planner conflicts</span>' : '<span style="color:#f87171">conflicts: '+snap.conflicts+'</span>';
}
document.getElementById('place').onclick=async()=>{
  const body={ station: document.getElementById('station').value, priority: document.getElementById('priority').value };
  await fetch('/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
};
document.getElementById('fetch').onclick=async()=>{
  const r=await fetch('/warehouse-orders'); const d=await r.json();
  const q=document.getElementById('q'); q.innerHTML='<pre>'+JSON.stringify(d,null,2).slice(0,2000)+'</pre>';
};
loadArena(); poll();
</script></body></html>`;
}

module.exports = { start };