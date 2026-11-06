import http from 'node:http';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import client from 'prom-client';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEPLOYMENT = process.env.DEPLOYMENT_NAME || 'app-unknown';
const POD_NAME = process.env.POD_NAME || os.hostname();

// Create a Registry and attach deployment & pod labels to all exported metrics
const register = new client.Registry();
register.setDefaultLabels({
  deployment: DEPLOYMENT,
  pod: POD_NAME
});

// Enable prom-client's built-in Node.js runtime & event loop lag metrics (10ms resolution)
// Exports:
// - nodejs_eventloop_lag_seconds, nodejs_eventloop_lag_p50_seconds,
//   nodejs_eventloop_lag_p90_seconds, nodejs_eventloop_lag_p99_seconds,
//   nodejs_eventloop_lag_mean_seconds, nodejs_eventloop_lag_max_seconds
// - process_cpu_seconds_total, process_cpu_user_seconds_total, process_cpu_system_seconds_total
// - process_resident_memory_bytes, nodejs_heap_size_used_bytes, etc.
client.collectDefaultMetrics({
  register,
  eventLoopMonitoringPrecision: 10
});

// Server-side HTTP request duration histogram (seconds, per Prometheus conventions)
const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.065, 0.08, 0.1, 0.125, 0.15, 0.2, 0.3, 0.5, 1.0],
  registers: [register]
});

// Server-side HTTP request counter
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// Concurrent in-flight HTTP requests gauge
const httpActiveRequests = new client.Gauge({
  name: 'http_active_requests',
  help: 'Number of concurrent in-flight HTTP requests',
  labelNames: ['route'],
  registers: [register]
});

// Synchronous event-loop blocking helper (simulates JSON serialization / regex / crypto on single JS thread)
function blockEventLoop(blockMs) {
  if (blockMs <= 0) return 0;
  const end = performance.now() + blockMs;
  let acc = 0;
  while (performance.now() < end) {
    acc += Math.imul(acc ^ 0x5bd1e995, 0x27d4eb2d);
  }
  return acc;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
    return;
  }

  if (url.pathname === '/metrics') {
    try {
      const metrics = await register.metrics();
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(metrics);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message);
    }
    return;
  }

  // Workload endpoint: /work?ioMs=45&blockMs=18
  const route = '/work';
  const method = req.method || 'GET';
  const endTimer = httpRequestDurationSeconds.startTimer({ method, route });
  httpActiveRequests.inc({ route });

  const ioMs = parseFloat(url.searchParams.get('ioMs') ?? '45');
  const blockMs = parseFloat(url.searchParams.get('blockMs') ?? '18');

  setTimeout(() => {
    blockEventLoop(blockMs);
    const durationSec = endTimer({ status_code: '200' });
    httpActiveRequests.dec({ route });
    httpRequestsTotal.inc({ method, route, status_code: '200' });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        deployment: DEPLOYMENT,
        pod: POD_NAME,
        ioMs,
        blockMs,
        durationMs: Number((durationSec * 1000).toFixed(2))
      }) + '\n'
    );
  }, Math.max(0, ioMs));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${DEPLOYMENT}/${POD_NAME}] Listening on :${PORT} with prom-client metrics (ESM/Node ${process.version})`);
});
