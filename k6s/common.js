import http from 'k6/http';
import { check } from 'k6';

export const TARGET_DEPLOYMENT = __ENV.TARGET_DEPLOYMENT || 'app-eld';
export const PROFILE = __ENV.PROFILE || 'microburst';
export const TARGET_BASE_URL =
  __ENV.TARGET_BASE_URL || `http://${TARGET_DEPLOYMENT}.hpa-demo.svc.cluster.local:3000`;
export const GRAFANA_URL =
  __ENV.GRAFANA_URL || 'http://grafana.hpa-demo.svc.cluster.local:3000';

export const BURST_SIZE = parseInt(__ENV.BURST_SIZE || '8', 10);
export const BURST_INTERVAL_MS = parseInt(__ENV.BURST_INTERVAL_MS || '1000', 10);
export const IO_MS = parseInt(__ENV.IO_MS || '40', 10);
export const BLOCK_MS = parseInt(__ENV.BLOCK_MS || '7', 10);
export const DURATION = __ENV.DURATION || '3m';

export const WORK_URL = `${TARGET_BASE_URL}/work?ioMs=${IO_MS}&blockMs=${BLOCK_MS}`;

export function postGrafanaAnnotation(text) {
  const payload = JSON.stringify({
    time: Date.now(),
    tags: ['load-test', TARGET_DEPLOYMENT, PROFILE],
    text
  });
  http.post(`${GRAFANA_URL}/api/annotations`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '3s',
    tags: { name: 'grafana-annotation' }
  });
}

export function createSetupTeardown(extraSummary = '') {
  return {
    setup: () => {
      const summary = `target=${TARGET_DEPLOYMENT} | profile=${PROFILE} | burst=${BURST_SIZE} | ioMs=${IO_MS} | blockMs=${BLOCK_MS}${extraSummary ? ` | ${extraSummary}` : ''}`;
      postGrafanaAnnotation(`START k6 [${TARGET_DEPLOYMENT}] (${PROFILE}) — ${summary}`);
      return { summary };
    },
    teardown: (data) => {
      postGrafanaAnnotation(`END k6 [${TARGET_DEPLOYMENT}] (${PROFILE}) — ${data.summary}`);
    }
  };
}

export function sendBurstRequests() {
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
  // Send batch of requests without failing checks so k6 exits cleanly with code 0
  http.batch(reqs);
}

