import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "15s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
  },
};

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
