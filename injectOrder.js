const args = {};
for (let i=2;i<process.argv.length;i++){
  const a=process.argv[i];
  if (a.startsWith("--")) {
    const key=a.slice(2);
    const next=process.argv[i+1];
    if (next && !next.startsWith("--")) { args[key]=next; i++; }
    else args[key]=true;
  } else {
    // support positional station
    if (!args.station) args.station=a;
  }
}
const station = args.station || "station one";
const urgent = !!(args.urgent);
const port = args.port || "8000";
const token = args.token || "team-token-123";
const priority = urgent ? "urgent" : (args.priority || "normal");

(async ()=>{
  try {
    const res = await fetch("http://localhost:"+port+"/inject", {
      method:"POST",
      headers:{ "team-token": token, "Content-Type":"application/json" },
      body: JSON.stringify({ station, priority })
    });
    const json = await res.json();
    if (!res.ok) { console.error("Error:", res.status, json); process.exit(1); }
    console.log("Queued order:", json.id);
    console.log("  station:", json.station);
    console.log("  cube:", json.cube);
    console.log("  priority:", json.priority);
    console.log("  issueTime:", json.issuedAt);
  } catch(e) { console.error("Request failed:", e.message); process.exit(1); }
})();