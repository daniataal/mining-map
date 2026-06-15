/**
 * MadSan V2 — prod smoke load test (k6)
 *
 * Dev (API direct):
 *   k6 run madsan/scripts/k6_smoke.js
 *
 * Prod gate (through Caddy on :80 — required before go-live):
 *   MADSAN_API_URL=http://<vm-hostname-or-ip>:80 k6 run madsan/scripts/k6_smoke.js
 *
 * With TLS after Caddy cutover:
 *   MADSAN_API_URL=https://madsan.example.com k6 run madsan/scripts/k6_smoke.js
 *
 * Pass: p95 < 2s on /health and a sample MVT tile routed via Caddy (not :8088 direct).
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "15s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
  },
};

// Default hits API directly (dev). Prod checklist: set MADSAN_API_URL=http://<vm>:80
const BASE = __ENV.MADSAN_API_URL || "http://localhost:8088";

export default function () {
  check(http.get(`${BASE}/health`), {
    "health ok": (r) => r.status === 200,
  });
  check(http.get(`${BASE}/tiles/energy-assets/4/8/5.mvt`), {
    "tile ok": (r) => r.status === 200,
  });
  sleep(1);
}
