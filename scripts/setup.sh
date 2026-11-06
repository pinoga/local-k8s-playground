#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "1. Starting Colima with Apple Virtualization.framework (vz) + k3s..."
colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8 --kubernetes

echo "2. Building demo Node.js image (hpa-eld-demo:latest) inside Colima's Docker daemon..."
docker build -t hpa-eld-demo:latest "$ROOT_DIR/app"

echo "3. Installing KEDA via Helm..."
helm repo add kedacore https://kedacore.github.io/charts --force-update
helm upgrade --install keda kedacore/keda --namespace keda --create-namespace --wait

echo "4. Deploying VictoriaMetrics, Grafana, Demo Apps (app-cpu & app-eld), HPAs, and LoadGen..."
kubectl apply -f "$ROOT_DIR/k8s/00-namespace.yaml"
kubectl apply -f "$ROOT_DIR/k8s/01-victoriametrics.yaml"
kubectl apply -f "$ROOT_DIR/k8s/02-apps-and-hpas.yaml"
kubectl apply -f "$ROOT_DIR/k8s/03-grafana.yaml"
kubectl apply -f "$ROOT_DIR/k8s/04-loadgen.yaml"

echo "5. Waiting for pods in hpa-demo to be Ready..."
kubectl -n hpa-demo rollout status deployment/victoriametrics --timeout=120s
kubectl -n hpa-demo rollout status deployment/grafana --timeout=120s
kubectl -n hpa-demo rollout status deployment/app-cpu --timeout=120s
kubectl -n hpa-demo rollout status deployment/app-eld --timeout=120s

echo "Done! Run 'kubectl -n hpa-demo port-forward svc/grafana 3000:3000' and open http://localhost:3000"

