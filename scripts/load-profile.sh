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
kubectl -n hpa-demo delete job -l app=loadgen --ignore-not-found --wait=true

# Ensure loadgen-script ConfigMap in k8s is up to date with k6s/ scripts
echo "Updating loadgen-script ConfigMap from k6s/..."
kubectl -n hpa-demo create configmap loadgen-script \
  --from-file=loadgen.js="$ROOT_DIR/k6s/loadgen.js" \
  --from-file=ramping-arrival.js="$ROOT_DIR/k6s/ramping-arrival.js" \
  --dry-run=client -o yaml | kubectl apply -f -

SCRIPT_NAME="loadgen.js"
BURST_SIZE="5"
BURST_INTERVAL_MS="750"
IO_MS="45"
BLOCK_MS="18"
DURATION="3m"

case "$PROFILE" in
  microburst)
    echo "Configuring 'microburst' profile ($TARGET for 3m, burst=5 every 750ms)..."
    BURST_SIZE="5"
    BURST_INTERVAL_MS="750"
    IO_MS="45"
    BLOCK_MS="18"
    DURATION="3m"
    ;;
  heavy)
    echo "Configuring 'heavy' profile ($TARGET for 15m, burst=7 every 500ms)..."
    BURST_SIZE="7"
    BURST_INTERVAL_MS="500"
    IO_MS="35"
    BLOCK_MS="25"
    DURATION="15m"
    ;;
  ramping)
    echo "Configuring 'ramping' profile ($TARGET using ramping-arrival.js for 4m30s)..."
    SCRIPT_NAME="ramping-arrival.js"
    ;;
  *)
    usage
    ;;
esac

echo "Launching fresh Job $JOB_NAME against $TARGET..."
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: hpa-demo
  labels:
    app: loadgen
    target-deployment: ${TARGET}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app: loadgen
        target-deployment: ${TARGET}
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:0.54.0
          args:
            - run
            - --out
            - experimental-prometheus-rw
            - --tag
            - deployment=${TARGET}
            - /scripts/${SCRIPT_NAME}
          env:
            - name: TARGET_DEPLOYMENT
              value: "${TARGET}"
            - name: K6_PROMETHEUS_RW_SERVER_URL
              value: "http://victoriametrics.hpa-demo.svc.cluster.local:8428/api/v1/write"
            - name: K6_PROMETHEUS_RW_TREND_STATS
              value: "p(50),p(90),p(95),p(99),avg,min,max"
            - name: K6_PROMETHEUS_RW_PUSH_INTERVAL
              value: "2s"
            - name: DURATION
              value: "${DURATION}"
            - name: BURST_SIZE
              value: "${BURST_SIZE}"
            - name: BURST_INTERVAL_MS
              value: "${BURST_INTERVAL_MS}"
            - name: IO_MS
              value: "${IO_MS}"
            - name: BLOCK_MS
              value: "${BLOCK_MS}"
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          volumeMounts:
            - name: script
              mountPath: /scripts
      volumes:
        - name: script
          configMap:
            name: loadgen-script
EOF

echo "Job $JOB_NAME started! Follow logs with: kubectl -n hpa-demo logs -f job/$JOB_NAME"
