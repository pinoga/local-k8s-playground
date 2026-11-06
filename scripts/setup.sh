#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "1. Ensuring Colima (vz + k3s) is running..."
if ! colima status >/dev/null 2>&1; then
  colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --kubernetes
fi

echo "2. Building demo Node.js image (hpa-eld-demo:latest)..."
docker build -t hpa-eld-demo:latest "$ROOT_DIR/app"

echo "3. Applying full declarative stack (KEDA, VictoriaMetrics, Grafana, Apps, HPAs, LoadGen) via Kustomize..."
kubectl apply --server-side -k "$ROOT_DIR/k8s"

echo "4. Waiting for KEDA and hpa-demo deployments to become Ready..."
kubectl -n keda rollout status deployment/keda-operator --timeout=120s
kubectl -n keda rollout status deployment/keda-metrics-apiserver --timeout=120s
kubectl -n hpa-demo rollout status deployment/victoriametrics --timeout=120s
kubectl -n hpa-demo rollout status deployment/grafana --timeout=120s
kubectl -n hpa-demo rollout status deployment/app-cpu --timeout=120s
kubectl -n hpa-demo rollout status deployment/app-eld --timeout=120s

echo "Done! Run 'kubectl -n hpa-demo port-forward svc/grafana 3000:3000' and open http://localhost:3000"
