# Kubernetes HPA Demo: CPU Utilization vs. Node.js Event Loop Delay

A minimal, low-overhead local Kubernetes stack designed for a 6-core Intel Mac mini using **Colima (`vz` Virtualization.framework) + k3s**, **VictoriaMetrics**, **KEDA**, **Grafana**, **Grafana k6**, and **two identical Node.js Deployments (`prom-client`)**.

## Project Layout

- [`AGENTS.md`](AGENTS.md): Project rules and agent guidelines.
- [`app/`](app/): Node.js server exporting standard Prometheus metrics via `prom-client` (`nodejs_eventloop_lag_p99_seconds`, `process_cpu_seconds_total`, `http_request_duration_seconds_bucket`).
- [`k6s/`](k6s/): Standalone **Grafana k6** load-testing scripts (`loadgen.js`, `ramping-arrival.js`) using open-model arrival rates (`constant-arrival-rate` / `ramping-arrival-rate`), SLO thresholds, and Prometheus Remote Write (`--out experimental-prometheus-rw`).
- [`k8s/`](k8s/) & [`kustomization.yaml`](kustomization.yaml): Declarative Kustomize IaC bundling KEDA, VictoriaMetrics, Grafana (with Server & k6 Client dashboards), Deployments, HPAs, and the k6 ConfigMap generator.
- [`scripts/`](scripts/): Helper scripts (`setup.sh`, `load-profile.sh`).

---

## Architecture

| Component | Role | Resource Footprint |
| :--- | :--- | :--- |
| **Colima (`--vm-type=vz`) + k3s** | Native macOS `Virtualization.framework` VM with built-in single-node `k3s` & `metrics-server` | 4 vCPUs, 8 GB RAM |
| **`victoriametrics`** | Single-binary TSDB scraping pods every `2s` and receiving k6 Prometheus Remote Write at `/api/v1/write` | ~30 MB RAM |
| **KEDA** | Queries VictoriaMetrics every `5s` to drive the Event Loop Delay HPA | ~45 MB RAM |
| **`app-cpu` + `app-cpu-hpa`** | Node.js (`prom-client`) Deployment scaled by standard K8s CPU HPA (`averageUtilization: 65%` of `250m`) | `250m` CPU req / pod |
| **`app-eld` + `app-eld-hpa`** | Identical Node.js Deployment scaled by KEDA HPA on `nodejs_eventloop_lag_p99_seconds` (>20ms above min resolution) | `250m` CPU req / pod |
| **`grafana`** | Pre-provisioned with **2 Dashboards** (Server/HPA View & k6 Client Tail Latency View), both with a **`Deployment` picker (`All`, `app-cpu`, `app-eld`)** | ~55 MB RAM |
| **`loadgen` (`grafana/k6`)** | Runs `k6s/loadgen.js` and streams client tail latency (`p50`, `p90`, `p95`, `p99`), TTFB, RPS, and VUs to VictoriaMetrics | ~45 MB RAM |

---

## Commands

### 1. Apply Declarative Stack (Kustomize)
```bash
kubectl apply --server-side --force-conflicts -k .
```

### 2. Access Grafana Dashboards
Grafana is exposed on NodePort `30300` (or via port-forward on `http://localhost:3000`):
```bash
kubectl -n hpa-demo port-forward svc/grafana 3000:3000
```
Open **http://localhost:3000**:
- **Dashboard 1 (Default Home)**: *1. Server & HPA: CPU Usage vs Event Loop Delay* (`prom-client` metrics + replica counts)
- **Dashboard 2 (Top-right link)**: *2. k6 Client Load & Tail Latency* (`k6_http_req_duration_p99/p95/p90/p50`, TTFB `k6_http_req_waiting_*`, RPS, Checks, VUs)

### 3. Switch Load Profiles
```bash
./scripts/load-profile.sh microburst
./scripts/load-profile.sh heavy
./scripts/load-profile.sh idle
```
