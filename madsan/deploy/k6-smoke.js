import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(95)<800"],
  },
};

const BASE = __ENV.MADSAN_API_URL || "http://localhost:8088";

export default function () {
  check(http.get(`${BASE}/health`), { "health ok": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/energy/assets?limit=50`), { "assets ok": (r) => r.status === 200 });
  check(http.get(`${BASE}/tiles/energy-assets/4/8/5.mvt`), { "tiles ok": (r) => r.status === 200 });
  sleep(1);
}
