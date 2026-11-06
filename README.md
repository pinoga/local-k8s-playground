# Kubernetes HPA Demo: CPU Utilization vs. Node.js Event Loop Delay

A minimal, low-overhead local Kubernetes stack designed for a 6-core Intel Mac mini using **Colima (`vz` Virtualization.framework) + k3s**, **VictoriaMetrics**, **KEDA**, **Grafana**, and **two identical Node.js Deployments**.

## Architecture

| Component | Role | Resource Footprint |
| :--- | :--- | :--- |
| **Colima (`--vm-type=vz`) + k3s** | Native macOS `Virtualization.framework` VM with built-in single-node `k3s` & `metrics-server` | 4 vCPUs, 8 GB RAM |
| **`victoriametrics`** | Single-binary TSDB scraping pods every `2s` (`prometheus.io/scrape=true`) | ~30 MB RAM |
| **KEDA** | Queries VictoriaMetrics every `5s` to drive the Event Loop Delay HPA | ~45 MB RAM |
| **`app-cpu` + `app-cpu-hpa`** | Node.js Deployment scaled by standard K8s CPU HPA (`averageUtilization: 65%` of `500m`) | `500m` CPU req / pod |
| **`app-eld` + `app-eld-hpa`** | Identical Node.js Deployment scaled by KEDA HPA on `nodejs_eventloop_delay_p99_ms > 20ms` | `500m` CPU req / pod |
| **`grafana`** | Pre-provisioned dashboard with a **`Deployment` picker (`All`, `app-cpu`, `app-eld`)** | ~55 MB RAM |
| **`loadgen`** | In-cluster load generator sending identical micro-bursts to both `app-cpu` and `app-eld` | ~20 MB RAM |

---

## Why CPU-Based HPA Fails for Event-Loop Runtimes

Node.js runs JavaScript on a **single thread**. Under realistic traffic where requests perform async I/O (`ioMs=45ms`) followed by synchronous payload processing (`blockMs=30ms`, e.g., JSON serialization, validation, regex, encryption):

1. **Micro-burst Queuing on the Single Thread**: When 5 concurrent requests finish their I/O together every `650ms` (~`7.7 req/s`), they queue sequentially on the event loop (`30ms × 5 = 150ms` stall).
   - **Event Loop Delay (`nodejs_eventloop_delay_p99_ms`)** spikes from `<1ms` to **`>90ms`**.
   - **HTTP p95 Latency** degrades from `~75ms` to **`~195ms+`**.
2. **CPU Averaging Blind Spot**:
   - `7.7 req/s × 30ms CPU = 230m CPU`, which is only **`~46%` of the pod's `500m` CPU request**.
   - Because `46% < 65%` (the CPU HPA threshold), **`app-cpu-hpa` thinks the pod is healthy and stays stuck at 1 replica!**
   - Meanwhile, **`app-eld-hpa`** detects `nodejs_eventloop_delay_p99_ms > 20ms` within seconds, scales out to **4–5 replicas**, distributes the event-loop queue across pods, and brings p95 latency back down to **`~78ms`**.

---

## Quick Commands

### 1. Access Grafana Dashboard
Grafana is exposed on NodePort `30300` (or via port-forward on `http://localhost:3000`):
```bash
kubectl -n hpa-demo port-forward svc/grafana 3000:3000
```
Open **http://localhost:3000** (no login required — lands directly on the **Kubernetes HPA: CPU Usage vs Event Loop Delay** dashboard with the `Deployment` picker at the top).

### 2. Watch the HPAs and Pods Live
```bash
kubectl -n hpa-demo get hpa,pods -w
```

### 3. Switch Load Profiles
```bash
# Default: Micro-bursts (CPU stays ~46% so app-cpu never scales, while app-eld scales to 4-5 pods)
./scripts/load-profile.sh microburst

# Heavy: High CPU + ELD (both eventually scale, showing ELD scaling 45-60s faster than CPU)
./scripts/load-profile.sh heavy

# Stop load (watch both deployments scale back down to 1 replica)
./scripts/load-profile.sh idle
```

