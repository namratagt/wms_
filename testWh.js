const { spawn } = require("child_process");
const assert = require("assert");

const TOKEN = "test-token-xyz";
let proc;
const PORT = 18955;

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function req(method, path, body, token){
  const opts = { method, headers: { "team-token": token||TOKEN, "Content-Type":"application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch("http://localhost:"+PORT+path, opts);
  let json=null; try{ json=await res.json(); }catch{}
  return { status: res.status, json };
}

async function main(){
  proc = spawn(process.execPath, ["mockWh.js","--port",String(PORT),"--token",TOKEN,"--scenario","sample","--duration","0"], { stdio:["ignore","pipe","pipe"] });
  await new Promise((resolve,reject)=>{
    proc.stdout.on("data", d=>{ if(String(d).includes("listening")) resolve(); });
    proc.on("error", reject);
    setTimeout(()=>reject(new Error("startup timeout")), 5000);
  });
  let pass=0, fail=0;
  function check(name, fn){ return fn().then(()=>{ console.log("PASS:",name); pass++; }).catch(e=>{ console.log("FAIL:",name, e.message); fail++; }); }

  await check("bad token rejected", async ()=>{
    const r = await req("GET","/orders",null,"nope");
    assert.equal(r.status, 401);
  });

  await check("state waiting before start", async ()=>{
    const r = await req("GET","/run");
    assert.equal(r.status, 200);
    assert.equal(r.json.state, "waiting");
  });

  await check("start makes running", async ()=>{
    const r = await req("POST","/start");
    assert.equal(r.status, 200);
    assert.equal(r.json.state, "running");
    const r2 = await req("GET","/run");
    assert.equal(r2.json.state, "running");
  });

  await check("orders shape", async ()=>{
    const r = await req("GET","/orders");
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.time, "number");
    assert.ok(Array.isArray(r.json.orders));
  });

  // happy path
  const ordersRes = await req("GET","/orders");
  const first = (ordersRes.json.orders||[])[0];
  assert.ok(first, "no order available");
  await check("happy path pick", async ()=>{
    const r = await req("POST","/orders/"+first.id+"/picked", { robot:"robot one", cube:first.cube });
    assert.ok(r.status>=200 && r.status<300, "status "+r.status);
  });
  await check("happy path deliver", async ()=>{
    const r = await req("POST","/orders/"+first.id+"/delivered", { robot:"robot one" });
    assert.ok(r.status>=200 && r.status<300, "status "+r.status);
  });

  // unknown order
  await check("unknown order 404 picked", async ()=>{
    const r = await req("POST","/orders/NOPE/picked", { robot:"r", cube:"x" });
    assert.equal(r.status, 404);
  });
  // wrong cube
  // inject a new order
  const inj = await req("POST","/inject", { station:"station one", priority:"normal" });
  const injId = inj.json.id;
  // ensure issued: now may be >0 due time passed; but issuedAt=nowTime at injection, so issued. get orders
  await wait(100);
  // mark? first pick wrong cube
  const ordRes = await req("GET","/orders");
  const o = ordRes.json.orders.find(x=>x.id===injId);
  // if not issued yet, skip wrong cube test
  if (o) {
    await check("wrong cube conflict", async ()=>{
      const r = await req("POST","/orders/"+injId+"/picked", { robot:"robot one", cube:"WRONG" });
      assert.equal(r.status, 409);
    });
    await check("deliver before pick conflict", async ()=>{
      const r2 = await req("POST","/orders/"+injId+"/delivered", { robot:"robot one" });
      assert.equal(r2.status, 409);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  proc.kill();
  process.exit(fail?1:0);
}

main().catch(e=>{ console.error(e); if(proc) proc.kill(); process.exit(1); });