/**
 * Netpas Distance Proxy — Render.com deployment
 * Updated with full debug logging + /api/test endpoint
 */

const express = require("express");
const cors    = require("cors");
const app     = express();
const PORT    = process.env.PORT || 3000;

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
  res.json({ status: "Netpas proxy is running", pin_code: NETPAS.pin_code, account: NETPAS.access_code });
});

// ── Core Netpas caller — logs FULL raw response ───────────────────────────────
async function callNetpas(dep_port, arr_port) {
  const payload = {
    pin_code:      NETPAS.pin_code,
    access_code:   NETPAS.access_code,
    dep_port,
    arr_port,
    piracy_code:   NETPAS.piracy_code,
    use_local_eca: NETPAS.use_local_eca,
  };

  console.log("\n=== NETPAS REQUEST ===");
  console.log(JSON.stringify(payload, null, 2));

  const resp = await fetch(NETPAS.baseUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  const raw = await resp.text();
  console.log("=== NETPAS RAW RESPONSE ===");
  console.log(raw);
  console.log("===========================\n");

  let data;
  try   { data = JSON.parse(raw); }
  catch { throw new Error("Non-JSON from Netpas: " + raw.substring(0, 200)); }

  if (data.error || data.err_msg)
    throw new Error("Netpas error: " + (data.error || data.err_msg));

  // Extract distance — try every known field name
  const nm =
    data.distance         ??
    data.total_distance   ??
    data.sea_distance     ??
    data.nm               ??
    data.dist             ??
    data.result?.distance ??
    data.result?.total_distance ??
    data.data?.distance   ??
    (Array.isArray(data.legs)
      ? data.legs.reduce((s, l) => s + (Number(l.distance) || 0), 0)
      : null);

  console.log("Extracted distance:", nm, "NM");
  return { nm: nm ? Math.round(Number(nm)) : null, raw: data };
}

// ── DEBUG: Test endpoint — shows raw Netpas response ─────────────────────────
// GET /api/test?from=ROTTERDAM&to=SINGAPORE
app.get("/api/test", async (req, res) => {
  const dep = req.query.from || "ROTTERDAM";
  const arr = req.query.to   || "PIRAEUS";
  try {
    const { nm, raw } = await callNetpas(dep, arr);
    res.json({ dep_port: dep, arr_port: arr, extracted_nm: nm, full_netpas_response: raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Single distance  POST /api/distance ──────────────────────────────────────
app.post("/api/distance", async (req, res) => {
  const { dep_port, arr_port } = req.body;
  if (!dep_port || !arr_port)
    return res.status(400).json({ error: "dep_port and arr_port required" });
  try {
    const { nm } = await callNetpas(dep_port, arr_port);
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
      const { nm } = await callNetpas(dep_port, arr_port);
      if (nm && nm > 0) results[dep_port] = nm;
      else failures.push({ port: dep_port, reason: "no distance in response" });
    } catch (err) {
      failures.push({ port: dep_port, reason: err.message });
    }
  }
  res.json({ results, failures });
});

app.listen(PORT, () => console.log("Netpas proxy live on port " + PORT));
