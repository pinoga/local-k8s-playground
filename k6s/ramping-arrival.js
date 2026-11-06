import {
  TARGET_DEPLOYMENT,
  createSetupTeardown,
  sendBurstRequests
} from './common.js';

export const options = {
  noConnectionReuse: true,
  discardResponseBodies: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  tags: { deployment: TARGET_DEPLOYMENT },
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
        { target: 80, duration: '2m' },   // Micro-burst plateau: ~1.33 bursts/s
        { target: 130, duration: '90s' }, // Heavy load: ~2.16 bursts/s
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

const hooks = createSetupTeardown('stages=20->80->130->20 bursts/m');
export const setup = hooks.setup;
export const teardown = hooks.teardown;
export const runBurst = sendBurstRequests;
