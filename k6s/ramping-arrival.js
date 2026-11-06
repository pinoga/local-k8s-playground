import http from 'k6/http';
import { check } from 'k6';

// Staged ramping-arrival-rate benchmark targeting a single deployment at a time:
// Stage 1 (Warm-up, 30s): Low arrival rate (1 pod baseline)
// Stage 2 (Micro-bursts, 2m): Event Loop Lag spikes >75ms while CPU stays ~48% (<65% CPU HPA target)
// Stage 3 (Heavy Spike, 1m30s): Both CPU and ELD cross thresholds (showing ELD scaling out faster)
// Stage 4 (Cool-down, 30s): Return to baseline
const TARGET_DEPLOYMENT = __ENV.TARGET_DEPLOYMENT || 'app-eld';
const TARGET_BASE_URL =
  __ENV.TARGET_BASE_URL || `http://${TARGET_DEPLOYMENT}.hpa-demo.svc.cluster.local:3000`;

const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '5', 10);
const IO_MS = parseInt(__ENV.IO_MS || '45', 10);
const BLOCK_MS = parseInt(__ENV.BLOCK_MS || '18', 10);

export const options = {
  noConnectionReuse: true,
  discardResponseBodies: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  tags: {
    deployment: TARGET_DEPLOYMENT
  },
  scenarios: {
      staged_ramping_arrival: {
        executor: 'ramping-arrival-rate',
        exec: 'runBurst',
        startRate: 20,
        timeUnit: '1m',
        preAllocatedVUs: 20,
        maxVUs: 50,
      stages: [
          { target: 20, duration: '30s' },  // Warm-up: ~0.33 bursts/s
          { target: 80, duration: '2m' },   // Micro-burst plateau: ~1.33 bursts/s (CPU ~48%, ELD >75ms)
          { target: 130, duration: '90s' }, // Heavy load: ~2.16 bursts/s (CPU >75%, ELD >120ms)
          { target: 20, duration: '30s' }   // Cool-down
        ],
        tags: { deployment: TARGET_DEPLOYMENT }
      }
    },
    thresholds: {
      [`http_req_duration{deployment:${TARGET_DEPLOYMENT}}`]: ['p(95)<120', 'p(99)<160'],
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
