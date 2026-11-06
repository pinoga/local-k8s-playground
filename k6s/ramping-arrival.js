import http from 'k6/http';
import { check } from 'k6';

// Staged ramping-arrival-rate benchmark comparing app-cpu vs app-eld across load phases:
// Stage 1 (Warm-up): Low arrival rate (both deployments at 1 pod)
// Stage 2 (Micro-bursts): Event Loop Lag spikes >75ms while CPU stays ~48% (<65% CPU HPA target)
// Stage 3 (Heavy Spike): Both CPU and ELD cross thresholds (showing ELD scaling out 45-60s faster)
// Stage 4 (Cool-down): Return to baseline
const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '5', 10);
const IO_MS = parseInt(__ENV.IO_MS || '45', 10);
const BLOCK_MS = parseInt(__ENV.BLOCK_MS || '18', 10);

const CPU_BASE_URL = __ENV.CPU_BASE_URL || 'http://app-cpu.hpa-demo.svc.cluster.local:3000';
const ELD_BASE_URL = __ENV.ELD_BASE_URL || 'http://app-eld.hpa-demo.svc.cluster.local:3000';

const stages = [
  { target: 20, duration: '30s' },  // Warm-up: ~0.33 bursts/s
  { target: 80, duration: '3m' },   // Micro-burst plateau: ~1.33 bursts/s (CPU ~48%, ELD >75ms)
  { target: 130, duration: '2m' },  // Heavy load: ~2.16 bursts/s (CPU >75%, ELD >120ms)
  { target: 20, duration: '1m' }    // Cool-down
];

export const options = {
  noConnectionReuse: true,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    cpu_ramping: {
      executor: 'ramping-arrival-rate',
      exec: 'hitCpuDeployment',
      startRate: 20,
      timeUnit: '1m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages,
      tags: { deployment: 'app-cpu' }
    },
    eld_ramping: {
      executor: 'ramping-arrival-rate',
      exec: 'hitEldDeployment',
      startRate: 20,
      timeUnit: '1m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      stages,
      tags: { deployment: 'app-eld' }
    }
  },
  thresholds: {
    'http_req_duration{deployment:app-eld}': ['p(95)<120', 'p(99)<160'],
    'http_req_duration{deployment:app-cpu}': ['p(95)<120', 'p(99)<160'],
    'http_req_failed': ['rate<0.01']
  }
};

const CPU_URL = `${CPU_BASE_URL}/work?ioMs=${IO_MS}&blockMs=${BLOCK_MS}`;
const ELD_URL = `${ELD_BASE_URL}/work?ioMs=${IO_MS}&blockMs=${BLOCK_MS}`;

function runBurst(url, deploymentName) {
  const reqs = [];
  for (let i = 0; i < BURST_SIZE; i++) {
    reqs.push([
      'GET',
      url,
      null,
      {
        tags: {
          deployment: deploymentName,
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
      { deployment: deploymentName }
    );
  }
}

export function hitCpuDeployment() {
  runBurst(CPU_URL, 'app-cpu');
}

export function hitEldDeployment() {
  runBurst(ELD_URL, 'app-eld');
}

