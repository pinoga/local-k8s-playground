import http from 'k6/http';
import { check } from 'k6';

// Configurable workload parameters via environment variables
const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '5', 10);
const BURST_INTERVAL_MS = parseInt(__ENV.BURST_INTERVAL_MS || '750', 10);
const IO_MS = parseInt(__ENV.IO_MS || '45', 10);
const BLOCK_MS = parseInt(__ENV.BLOCK_MS || '18', 10);
const DURATION = __ENV.DURATION || '24h';

const CPU_BASE_URL = __ENV.CPU_BASE_URL || 'http://app-cpu.hpa-demo.svc.cluster.local:3000';
const ELD_BASE_URL = __ENV.ELD_BASE_URL || 'http://app-eld.hpa-demo.svc.cluster.local:3000';

// Industry-standard open-model arrival-rate scenarios:
// Both deployments receive identical, independent micro-bursts without Coordinated Omission.
export const options = {
  // Disable keep-alive so kube-proxy (L4 ClusterIP) load-balances every request across scaled pods
  noConnectionReuse: true,
  discardResponseBodies: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    cpu_deployment_load: {
      executor: 'constant-arrival-rate',
      exec: 'hitCpuDeployment',
      rate: 1000,
      timeUnit: `${BURST_INTERVAL_MS * 1000}ms`,
      duration: DURATION,
      preAllocatedVUs: 15,
      maxVUs: 40,
      tags: { deployment: 'app-cpu' }
    },
    eld_deployment_load: {
      executor: 'constant-arrival-rate',
      exec: 'hitEldDeployment',
      rate: 1000,
      timeUnit: `${BURST_INTERVAL_MS * 1000}ms`,
      duration: DURATION,
      preAllocatedVUs: 15,
      maxVUs: 40,
      tags: { deployment: 'app-eld' }
    }
  },
  thresholds: {
    'http_req_duration{deployment:app-eld}': ['p(90)<100', 'p(95)<120', 'p(99)<160'],
    'http_req_duration{deployment:app-cpu}': ['p(90)<100', 'p(95)<120', 'p(99)<160'],
    'http_req_waiting{deployment:app-eld}': ['p(95)<115', 'p(99)<150'],
    'http_req_waiting{deployment:app-cpu}': ['p(95)<115', 'p(99)<150'],
    'http_req_failed{deployment:app-eld}': ['rate<0.01'],
    'http_req_failed{deployment:app-cpu}': ['rate<0.01']
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

