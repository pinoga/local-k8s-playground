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
  }
};

const hooks = createSetupTeardown(`interval=${BURST_INTERVAL_MS}ms | duration=${DURATION}`);
export const setup = hooks.setup;
export const teardown = hooks.teardown;
export const runBurst = sendBurstRequests;
