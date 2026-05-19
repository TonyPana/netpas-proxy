/**
 * Netpas Distance Proxy — corrected for NEA v7 GET API
 *
 * Key fixes (from official PDF guide):
 *  - Method:   GET  (not POST)
 *  - Endpoint: /nea/v7/json/get_distance/   (not /nea/v7/json)
 *  - Params:   pincode (no underscore), ports repeated per port
 *  - Response: data.total_distance  (not data.distance)
 */

const express = require("express");
const cors    = require("cors");
const app     = express();
const PORT    = process.env.PORT || 3000;

const NETPAS = {
  // Correct endpoint — must end with trailing slash
  baseUrl:      "https://api.netpas.net/nea/v7/json/",
  pincode:      process.env.NETPAS_PIN_CODE    || "DEMO",
  access_code:  process.env.NETPAS_ACCESS_CODE || "apanagakos@brave.gr",
  piracy_code:  process.env.NETPAS_PIRACY_CODE || "000",
  canal_pass_code: "111",    // 111 = use all canals (Suez + Panama + Kiel)
  use_local_eca: "false",
};

app.use(cors());
app.use(express.json());

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "Netpas proxy running", pincode: NETPAS.pincode, account: NETPAS.access_code });
});

// ── Core caller (GET with URL params) ─────────────────────────────────────────
async function netpasGetDistance(dep_port, arr_port) {
  // Build query string — "ports" must appear TWICE (once per port)
  const params = new URLSearchParams({
    pincode:          NETPAS.pincode,      // ← no underscore
    access_code:      NETPAS.access_code,
    piracy_code:      NETPAS.piracy_code,
    canal_pass_code:  NETPAS.canal_pass_code,
    use_local_eca:    NETPAS.use_local_eca,
  });
  params.append("ports", dep_port);   // first port
  params.append("ports", arr_port);   // second port

  const url = `${NETPAS.baseUrl}get_distance/?${params.toString()}`;

  console.log(`\n=== NETPAS GET REQUEST ===`);
  console.log(url);

  const resp = await fetch(url, { method: "GET" });
  const raw  = await resp.text();

  console.log("=== NETPAS RAW RESPONSE ===");
  console.log(raw);
  console.log("===========================\n");

  let data;
  try   { data = JSON.parse(raw); }
  catch { throw new Error("Non-JSON from Netpas: " + raw.substring(0, 300)); }

  // Check Netpas return codes (200 = success, 403 = day limit, 221 = bad credentials, etc.)
  if (data.code && data.code !== 200)
    throw new Error(`Netpas code ${data.code}: ${data.message || "unknown error"}`);

  // Correct response field is total_distance (double)
  const nm = data.total_distance
          ?? data.section?.[0]?.distance
          ?? null;

  console.log(`Result: ${dep_port} → ${arr_port} = ${nm} NM`);
  return nm ? Math.round(Number(nm)) : null;
}

// ── License info (check expiry & day limit) ──────────────────────────────────
app.get("/api/license", async (_req, res) => {
  try {
    const url = `${NETPAS.baseUrl}license_info/?pincode=${NETPAS.pincode}&access_code=${encodeURIComponent(NETPAS.access_code)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug test endpoint — GET /api/test?from=Norfolk&to=Corinth ───────────────
app.get("/api/test", async (req, res) => {
  const dep = req.query.from || "Norfolk";
  const arr = req.query.to   || "Corinth";
  try {
    const nm = await netpasGetDistance(dep, arr);
    res.json({ dep_port: dep, arr_port: arr, distance_nm: nm, status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Single  POST /api/distance ────────────────────────────────────────────────
app.post("/api/distance", async (req, res) => {
  const { dep_port, arr_port } = req.body;
  if (!dep_port || !arr_port)
    return res.status(400).json({ error: "dep_port and arr_port required" });
  try {
    const nm = await netpasGetDistance(dep_port, arr_port);
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
      const nm = await netpasGetDistance(dep_port, arr_port);
      if (nm && nm > 0) results[dep_port] = nm;
      else failures.push({ port: dep_port, reason: "no distance returned" });
    } catch (err) {
      failures.push({ port: dep_port, reason: err.message });
    }
  }
  res.json({ results, failures });
});

app.listen(PORT, () => console.log("✓ Netpas proxy (corrected GET API) live on port " + PORT));
