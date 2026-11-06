import {
  TARGET_DEPLOYMENT,
  BURST_INTERVAL_MS,
  DURATION,
  createSetupTeardown,
  sendBurstRequests
} from './common.js';

export const options = {
  noConnectionReuse: true,
  discardResponseBodies: false,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  tags: { deployment: TARGET_DEPLOYMENT },
  scenarios: {
    microburst_arrival_rate: {
      executor: 'constant-arrival-rate',
      exec: 'runBurst',
      rate: 1,
      timeUnit: `${BURST_INTERVAL_MS}ms`,
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 30,
      tags: { deployment: TARGET_DEPLOYMENT }
    }
  },
  thresholds: {
    [`http_req_duration{deployment:${TARGET_DEPLOYMENT}}`]: ['p(90)<100', 'p(95)<120', 'p(99)<160'],
    [`http_req_waiting{deployment:${TARGET_DEPLOYMENT}}`]: ['p(95)<115', 'p(99)<150'],
    [`http_req_failed{deployment:${TARGET_DEPLOYMENT}}`]: ['rate<0.01']
  }
};

const hooks = createSetupTeardown(`interval=${BURST_INTERVAL_MS}ms | duration=${DURATION}`);
export const setup = hooks.setup;
export const teardown = hooks.teardown;
export const runBurst = sendBurstRequests;
