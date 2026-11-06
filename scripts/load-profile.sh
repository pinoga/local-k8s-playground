#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
PROFILE="${2:-microburst}"

usage() {
  echo "Usage: $0 <app-cpu|app-eld|stop> [microburst|heavy|ramping]"
  echo ""
  echo "Examples:"
  echo "  $0 app-eld microburst   # Run 3m isolated microburst Job against app-eld"
  echo "  $0 app-cpu microburst   # Run 3m isolated microburst Job against app-cpu"
  echo "  $0 app-eld ramping      # Run 4m30s staged ramping-arrival.js Job against app-eld"
  echo "  $0 stop                 # Stop/delete any running loadgen Jobs"
  exit 1
}

if [[ -z "$TARGET" ]]; then
  usage
fi

if [[ "$TARGET" == "stop" || "$TARGET" == "idle" ]]; then
  echo "Deleting any active loadgen Jobs in hpa-demo..."
  kubectl -n hpa-demo delete job -l app=loadgen --ignore-not-found
  exit 0
fi

if [[ "$TARGET" != "app-cpu" && "$TARGET" != "app-eld" ]]; then
  usage
fi

JOB_NAME="loadgen-${TARGET}"

# Ensure no other loadgen Job is running concurrently to prevent noisy-neighbor interference
echo "Stopping any existing loadgen Jobs to ensure isolated execution..."
kubectl -n hpa-demo delete job -l app=loadgen --ignore-not-found

echo "Recreating suspended Job manifests from Kustomize..."
kubectl apply --server-side --force-conflicts -k "$ROOT_DIR"

case "$PROFILE" in
  microburst)
    echo "Starting isolated 'microburst' Job ($JOB_NAME -> $TARGET for 3m)..."
    kubectl -n hpa-demo patch "job/$JOB_NAME" --type=json -p='[
      {"op": "replace", "path": "/spec/suspend", "value": false}
    ]'
    ;;
  heavy)
    echo "Starting isolated 'heavy' Job ($JOB_NAME -> $TARGET for 3m, burst=7 every 500ms)..."
    kubectl -n hpa-demo patch "job/$JOB_NAME" --type=strategic -p='{
      "spec": {
        "suspend": false,
        "template": {
          "spec": {
            "containers": [{
              "name": "k6",
              "env": [
                {"name": "BURST_SIZE", "value": "7"},
                {"name": "BURST_INTERVAL_MS", "value": "500"},
                {"name": "IO_MS", "value": "35"},
                {"name": "BLOCK_MS", "value": "25"}
              ]
            }]
          }
        }
      }
    }'
    ;;
  ramping)
    echo "Starting isolated 'ramping' Job ($JOB_NAME -> $TARGET using ramping-arrival.js for 4m30s)..."
    kubectl -n hpa-demo patch "job/$JOB_NAME" --type=strategic -p="{
      \"spec\": {
        \"suspend\": false,
        \"template\": {
          \"spec\": {
            \"containers\": [{
              \"name\": \"k6\",
              \"args\": [
                \"run\",
                \"--out\",
                \"experimental-prometheus-rw\",
                \"--tag\",
                \"deployment=${TARGET}\",
                \"/scripts/ramping-arrival.js\"
              ]
            }]
          }
        }
      }
    }"
    ;;
  *)
    usage
    ;;
esac

echo "Job $JOB_NAME started! Follow logs with: kubectl -n hpa-demo logs -f job/$JOB_NAME"
