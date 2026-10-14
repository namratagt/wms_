const fs = require("fs");
const path = require("path");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Planning Diagrams</title>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
<style>body{background:#0b0b0b;color:#eee;font-family:sans-serif;margin:20px} .mermaid{background:#111;padding:20px;margin:20px 0;border-radius:8px}</style>
</head><body>
<h1>Multi-robot planning core</h1>

<h2>1. Workflow: orders to verified plans</h2>
<div class="mermaid">
flowchart TD
 A[Orders sorted by priority] --> B[For each order]
 B --> C[Expand into legs: rest to pick, pick to drop, drop to rest]
 C --> D[Plan each leg: shortest path, corridor, optimal arrival, lock squares]
 D --> E[Space and time search: wait-in-corridor then reroute then delayed start]
 E --> F[Commit route, dwell, lock into booking ledger]
 F --> G{More legs/orders?}
 G -- yes --> C
 G -- no --> H[Independent conflict checker]
 H --> I[Verified plans]
 A -. later robots read earlier bookings .-> F
</div>

<h2>2. Search loop</h2>
<div class="mermaid">
flowchart TD
 S[Pop state from FIFO queue] --> T{At goal with lock zone free for whole dwell?}
 T -- yes --> R[Return timed steps]
 T -- no --> H{Tick at horizon?}
 H -- yes --> S
 H -- no --> G{Mid rotation?}
 G -- yes --> ST[Stay put, reduce turn counter]
 G -- no --> GEN[Generate successors: wait, drive, begin-turn]
 GEN --> GUARD[Guard: square free, no head-on swap, state unseen]
 GUARD --> ENQ[Enqueue at next tick]
 ST --> ENQ
 ENQ --> S
</div>
<p>Every path out of the generate step costs exactly one tick, which keeps the breadth-first search optimal.</p>

<h2>3. Strategy selection</h2>
<div class="mermaid">
flowchart TD
 P[Compute ideal shortest path] --> C[Derive corridor and optimal arrival]
 C --> L[Compute lock squares]
 L --> A1[Attempt A: corridor restricted, wait only]
 A1 --> OPT{Arrives at optimal arrival?}
 OPT -- yes --> D[Direct]
 OPT -- no --> A2[Attempt B: unrestricted, may detour]
 A2 --> PICK[Pick earlier of A and B, ties to A]
 PICK --> CMP{Different squares than ideal?}
 CMP -- yes --> ALT[Alternate route]
 CMP -- no --> DEL{First depart after earliest start?}
 DEL -- yes --> DELAYED[Delayed start]
 DEL -- no --> ARR{Arrives later than optimal?}
 ARR -- yes --> WAIT[Wait on route]
 ARR -- no --> D
 A1 --> NONE{Both attempts failed?}
 NONE -- yes --> RETRY[Retry with growing delay up to max]
 RETRY --> DS[Delayed start or fail]
 DS --> COMMIT[Commit]
</div>

<p>Strategies: direct, wait on route, alternate route, delayed start.</p>
</body></html>`;

fs.writeFileSync(path.join(__dirname, "diagram.html"), html);
console.log("Wrote diagram.html");