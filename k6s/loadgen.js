import http from 'k6/http';
import { check } from 'k6';

// Single-target open-model benchmark to prevent noisy-neighbor CPU/socket interference.
// Target deployment ('app-cpu' or 'app-eld') is injected via environment variables.
const TARGET_DEPLOYMENT = __ENV.TARGET_DEPLOYMENT || 'app-eld';
const TARGET_BASE_URL =
  __ENV.TARGET_BASE_URL || `http://${TARGET_DEPLOYMENT}.hpa-demo.svc.cluster.local:3000`;

const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '5', 10);
const BURST_INTERVAL_MS = parseInt(__ENV.BURST_INTERVAL_MS || '750', 10);
const IO_MS = parseInt(__ENV.IO_MS || '45', 10);
const BLOCK_MS = parseInt(__ENV.BLOCK_MS || '18', 10);
const DURATION = __ENV.DURATION || '3m';

export const options = {
  // Disable keep-alive so kube-proxy (L4 ClusterIP) load-balances every request across scaled pods
  noConnectionReuse: true,
  discardResponseBodies: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  tags: {
    deployment: TARGET_DEPLOYMENT
  },
  scenarios: {
      microburst_arrival_rate: {
        executor: 'constant-arrival-rate',
        exec: 'runBurst',
        rate: 1000,
        timeUnit: `${BURST_INTERVAL_MS * 1000}ms`,
        duration: DURATION,
        preAllocatedVUs: 15,
        maxVUs: 40,
      tags: { deployment: TARGET_DEPLOYMENT }
      }
    },
    thresholds: {
      [`http_req_duration{deployment:${TARGET_DEPLOYMENT}}`]: [
        'p(90)<100',
        'p(95)<120',
        'p(99)<160'
      ],
      [`http_req_waiting{deployment:${TARGET_DEPLOYMENT}}`]: [
        'p(95)<115',
        'p(99)<150'
      ],
      [`http_req_failed{deployment:${TARGET_DEPLOYMENT}}`]: ['rate<0.01']
    }
  };

  const WORK_URL = `${TARGET_BASE_URL}/work?ioMs=${IO_MS}&blockMs=${BLOCK_MS}`;

    export function runBurst() {
      const reqs = [];
      for (let i = 0; i < BURST_SIZE; i++) {
        reqs.push([
          'GET',
          WORK_URL,
          null,
          {
            tags: {
              deployment: TARGET_DEPLOYMENT,
              name: 'GET /work'
            },
            timeout: '5s'
          }
        ]);
      }
      const responses = http.batch(reqs);
      for (let i = 0; i < responses.length; i++) {
        check(
          responses[i],
          { 'status is 200': (r) => r.status === 200 },
      { deployment: TARGET_DEPLOYMENT }
        );
      }
    }
