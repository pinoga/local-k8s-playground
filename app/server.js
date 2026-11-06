'use strict';

const http = require('node:http');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const os = require('node:os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEPLOYMENT = process.env.DEPLOYMENT_NAME || 'app-unknown';
const POD_NAME = process.env.POD_NAME || os.hostname();
const CPU_REQUEST_CORES = parseFloat(process.env.CPU_REQUEST_CORES || '0.5');

// High-resolution native C++ event loop delay sampler (10ms timer resolution)
const eldHistogram = monitorEventLoopDelay({ resolution: 10 });
eldHistogram.enable();

// Smoothed real-time Event Loop Delay metrics (in milliseconds)
let eldMeanMs = 0;
let eldP50Ms = 0;
let eldP95Ms = 0;
let eldP99Ms = 0;
let eldMaxMs = 0;

// Track CPU usage rate locally as well as cumulative counter for Prometheus rate()
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = performance.now();
let currentCpuCores = 0;

// Sample and reset event loop delay histogram every 500ms so gauges reflect live lag
function updateRuntimeMetrics() {
  if (eldHistogram.count > 0) {
    const minMs = Math.min(eldHistogram.min / 1e6, 12);
    const rawMean = eldHistogram.mean / 1e6;
    const rawP50 = eldHistogram.percentile(50) / 1e6;
    const rawP95 = eldHistogram.percentile(95) / 1e6;
    const rawP99 = eldHistogram.percentile(99) / 1e6;
    const rawMax = eldHistogram.max / 1e6;

    const adjMean = Math.max(0, rawMean - minMs);
    const adjP50 = Math.max(0, rawP50 - minMs);
    const adjP95 = Math.max(0, rawP95 - minMs);
    const adjP99 = Math.max(0, rawP99 - minMs);
    const adjMax = Math.max(0, rawMax - minMs);

    // Fast EMA (alpha=0.55) so spikes register immediately and decay cleanly over ~3-4s
    const alpha = 0.55;
    eldMeanMs = alpha * adjMean + (1 - alpha) * eldMeanMs;
    eldP50Ms = alpha * adjP50 + (1 - alpha) * eldP50Ms;
    eldP95Ms = alpha * adjP95 + (1 - alpha) * eldP95Ms;
    eldP99Ms = alpha * adjP99 + (1 - alpha) * eldP99Ms;
    eldMaxMs = Math.max(adjMax, eldMaxMs * 0.6);

    eldHistogram.reset();
  } else {
    eldMeanMs *= 0.7;
    eldP50Ms *= 0.7;
    eldP95Ms *= 0.7;
    eldP99Ms *= 0.7;
    eldMaxMs *= 0.7;
  }

  const now = performance.now();
  const elapsedSec = (now - lastCpuTime) / 1000;
  if (elapsedSec > 0.2) {
    const diff = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = now;
    const usedSec = (diff.user + diff.system) / 1e6;
    const instCores = usedSec / elapsedSec;
    currentCpuCores = 0.4 * instCores + 0.6 * currentCpuCores;
  }
}

setInterval(updateRuntimeMetrics, 500).unref();

// HTTP Request & Latency Metrics
let httpRequestsTotal = 0;
let activeRequests = 0;
const latencyBuckets = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000, 2500];
const bucketCounts = new Array(latencyBuckets.length).fill(0);
let latencyCount = 0;
let latencySumMs = 0;

// Sliding window of recent request durations (last 5 seconds) for responsive p50/p95 gauges
const recentLatencies = [];
function recordLatency(durationMs) {
  latencyCount++;
  latencySumMs += durationMs;
  for (let i = 0; i < latencyBuckets.length; i++) {
    if (durationMs <= latencyBuckets[i]) {
      bucketCounts[i]++;
    }
  }
  const now = Date.now();
  recentLatencies.push({ t: now, d: durationMs });
  while (recentLatencies.length > 0 && now - recentLatencies[0].t > 5000) {
    recentLatencies.shift();
  }
}

function getRecentPercentile(p) {
  const now = Date.now();
  while (recentLatencies.length > 0 && now - recentLatencies[0].t > 5000) {
    recentLatencies.shift();
  }
  if (recentLatencies.length === 0) return 0;
  const sorted = recentLatencies.map((x) => x.d).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Synchronous event-loop blocking helper (simulates JSON serialization / regex / crypto on single JS thread)
function blockEventLoop(blockMs) {
  if (blockMs <= 0) return;
  const end = performance.now() + blockMs;
  let acc = 0;
  while (performance.now() < end) {
    // Busy-wait on the main V8 thread so the single-threaded event loop cannot process other callbacks
    acc += Math.imul(acc ^ 0x5bd1e995, 0x27d4eb2d);
  }
  return acc;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
    return;
  }

  if (url.pathname === '/metrics') {
    const totalCpu = process.cpuUsage();
    const cpuUserSec = totalCpu.user / 1e6;
    const cpuSystemSec = totalCpu.system / 1e6;
    const cpuTotalSec = cpuUserSec + cpuSystemSec;
    const cpuPercentOfRequest = (currentCpuCores / CPU_REQUEST_CORES) * 100;
    const memRssBytes = process.memoryUsage().rss;
    const p50Latency = getRecentPercentile(50);
    const p95Latency = getRecentPercentile(95);
    const p99Latency = getRecentPercentile(99);

    const labels = `deployment="${DEPLOYMENT}",pod="${POD_NAME}"`;
    const lines = [
      '# HELP nodejs_eventloop_delay_mean_ms Rolling mean Node.js event loop delay in ms',
      '# TYPE nodejs_eventloop_delay_mean_ms gauge',
      `nodejs_eventloop_delay_mean_ms{${labels}} ${eldMeanMs.toFixed(3)}`,
      '# HELP nodejs_eventloop_delay_p50_ms Rolling p50 Node.js event loop delay in ms',
      '# TYPE nodejs_eventloop_delay_p50_ms gauge',
      `nodejs_eventloop_delay_p50_ms{${labels}} ${eldP50Ms.toFixed(3)}`,
      '# HELP nodejs_eventloop_delay_p95_ms Rolling p95 Node.js event loop delay in ms',
      '# TYPE nodejs_eventloop_delay_p95_ms gauge',
      `nodejs_eventloop_delay_p95_ms{${labels}} ${eldP95Ms.toFixed(3)}`,
      '# HELP nodejs_eventloop_delay_p99_ms Rolling p99 Node.js event loop delay in ms',
      '# TYPE nodejs_eventloop_delay_p99_ms gauge',
      `nodejs_eventloop_delay_p99_ms{${labels}} ${eldP99Ms.toFixed(3)}`,
      '# HELP nodejs_eventloop_delay_max_ms Rolling max Node.js event loop delay in ms',
      '# TYPE nodejs_eventloop_delay_max_ms gauge',
      `nodejs_eventloop_delay_max_ms{${labels}} ${eldMaxMs.toFixed(3)}`,
      '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds',
      '# TYPE process_cpu_seconds_total counter',
      `process_cpu_seconds_total{${labels}} ${cpuTotalSec.toFixed(4)}`,
      '# HELP app_cpu_utilization_percent Current pod CPU usage as percentage of CPU request',
      '# TYPE app_cpu_utilization_percent gauge',
      `app_cpu_utilization_percent{${labels}} ${cpuPercentOfRequest.toFixed(2)}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes{${labels}} ${memRssBytes}`,
      '# HELP http_requests_total Total number of HTTP /work requests processed',
      '# TYPE http_requests_total counter',
      `http_requests_total{${labels}} ${httpRequestsTotal}`,
      '# HELP app_active_requests Concurrent in-flight HTTP /work requests',
      '# TYPE app_active_requests gauge',
      `app_active_requests{${labels}} ${activeRequests}`,
      '# HELP http_request_duration_p50_ms Sliding 5s window p50 HTTP latency in ms',
      '# TYPE http_request_duration_p50_ms gauge',
      `http_request_duration_p50_ms{${labels}} ${p50Latency.toFixed(2)}`,
      '# HELP http_request_duration_p95_ms Sliding 5s window p95 HTTP latency in ms',
      '# TYPE http_request_duration_p95_ms gauge',
      `http_request_duration_p95_ms{${labels}} ${p95Latency.toFixed(2)}`,
      '# HELP http_request_duration_p99_ms Sliding 5s window p99 HTTP latency in ms',
      '# TYPE http_request_duration_p99_ms gauge',
      `http_request_duration_p99_ms{${labels}} ${p99Latency.toFixed(2)}`,
      '# HELP http_request_duration_ms HTTP request duration in milliseconds',
      '# TYPE http_request_duration_ms histogram'
    ];

    for (let i = 0; i < latencyBuckets.length; i++) {
      lines.push(
        `http_request_duration_ms_bucket{${labels},le="${latencyBuckets[i]}"} ${bucketCounts[i]}`
      );
    }
    lines.push(`http_request_duration_ms_bucket{${labels},le="+Inf"} ${latencyCount}`);
    lines.push(`http_request_duration_ms_sum{${labels}} ${latencySumMs.toFixed(2)}`);
    lines.push(`http_request_duration_ms_count{${labels}} ${latencyCount}`);

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(lines.join('\n') + '\n');
    return;
  }

  // Default workload endpoint: /work?ioMs=45&blockMs=35
  // Simulates an async I/O call (e.g. DB query) followed by synchronous JS payload processing
  const start = performance.now();
  activeRequests++;
  const ioMs = parseFloat(url.searchParams.get('ioMs') ?? '45');
  const blockMs = parseFloat(url.searchParams.get('blockMs') ?? '35');

  setTimeout(() => {
    blockEventLoop(blockMs);
    const durationMs = performance.now() - start;
    activeRequests--;
    httpRequestsTotal++;
    recordLatency(durationMs);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        deployment: DEPLOYMENT,
        pod: POD_NAME,
        ioMs,
        blockMs,
        durationMs: Number(durationMs.toFixed(2)),
        eldP99Ms: Number(eldP99Ms.toFixed(2))
      }) + '\n'
    );
  }, Math.max(0, ioMs));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${DEPLOYMENT}/${POD_NAME}] Listening on :${PORT}`);
});
