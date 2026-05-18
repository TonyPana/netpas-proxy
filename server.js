/**
 * Netpas Distance Proxy — optimised for Glitch.com
 * Paste this entire file into your Glitch project's server.js
 */

const express = require("express");
const cors    = require("cors");
const app     = express();
const PORT    = process.env.PORT || 3000;   // Glitch uses process.env.PORT

// ── Credentials (set these in Glitch's .env panel) ────────────────────────────
const NETPAS = {
  baseUrl:       "https://api.netpas.net/nea/v7/json",
  pin_code:      process.env.NETPAS_PIN_CODE    || "DEMO",
  access_code:   process.env.NETPAS_ACCESS_CODE || "apanagakos@brave.gr",
  piracy_code:   process.env.NETPAS_PIRACY_CODE || "000",
  use_local_eca: false,
};

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status:   "Netpas proxy is running",
    pin_code: NETPAS.pin_code,
    account:  NETPAS.access_code,
  });
});

// ── Helper: call Netpas and return distance in NM ─────────────────────────────
async function netpasDistance(dep_port, arr_port) {
  const resp = await fetch(NETPAS.baseUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pin_code:      NETPAS.pin_code,
      access_code:   NETPAS.access_code,
      dep_port,
      arr_port,
      piracy_code:   NETPAS.piracy_code,
      use_local_eca: NETPAS.use_local_eca,
    }),
  });
  const raw  = await resp.text();
  const data = JSON.parse(raw);
  if (data.error || data.err_msg) throw new Error(data.error || data.err_msg);
  const nm =
    data.distance       ?? data.total_distance  ?? data.sea_distance ??
    data.result?.distance ??
    (Array.isArray(data.legs) ? data.legs.reduce((s,l)=>s+(Number(l.distance)||0),0) : null);
  return nm ? Math.round(Number(nm)) : null;
}

// ── Single  POST /api/distance ────────────────────────────────────────────────
app.post("/api/distance", async (req, res) => {
  const { dep_port, arr_port } = req.body;
  if (!dep_port || !arr_port)
    return res.status(400).json({ error: "dep_port and arr_port required" });
  try {
    const nm = await netpasDistance(dep_port, arr_port);
    console.log(`${dep_port} -> ${arr_port} = ${nm} NM`);
    res.json({ dep_port, arr_port, distance_nm: nm });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Batch  POST /api/distances/batch ─────────────────────────────────────────
app.post("/api/distances/batch", async (req, res) => {
  const { ports, arr_port } = req.body;
  if (!ports?.length || !arr_port)
    return res.status(400).json({ error: "ports[] and arr_port required" });
  const results = {}, failures = [];
  for (const dep_port of ports) {
    try {
      const nm = await netpasDistance(dep_port, arr_port);
      if (nm && nm > 0) { results[dep_port] = nm; console.log(`${dep_port} -> ${arr_port} = ${nm} NM`); }
      else failures.push({ port: dep_port, reason: "no distance returned" });
    } catch (err) {
      failures.push({ port: dep_port, reason: err.message });
    }
  }
  res.json({ results, failures });
});

app.listen(PORT, () => console.log("Netpas proxy live on port " + PORT));
