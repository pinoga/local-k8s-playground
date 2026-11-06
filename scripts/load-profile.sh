#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-microburst}"

case "$MODE" in
  idle|stop)
    echo "Stopping load generator (scaling loadgen to 0 replicas)..."
    kubectl -n hpa-demo scale deployment/loadgen --replicas=0
    ;;
  microburst)
    echo "Starting 'microburst' profile (5 concurrent reqs / 650ms, ioMs=45, blockMs=30):"
    echo "  -> CPU stays ~45% (<65% CPU HPA target), while Event Loop Delay spikes >90ms!"
    kubectl -n hpa-demo set env deployment/loadgen BURST_SIZE=5 BURST_INTERVAL_MS=650 IO_MS=45 BLOCK_MS=30
    kubectl -n hpa-demo scale deployment/loadgen --replicas=1
    ;;
  heavy)
    echo "Starting 'heavy' profile (8 concurrent reqs / 500ms, ioMs=35, blockMs=35):"
    echo "  -> Both ELD and CPU cross thresholds, showing how much faster ELD scales out than CPU!"
    kubectl -n hpa-demo set env deployment/loadgen BURST_SIZE=8 BURST_INTERVAL_MS=500 IO_MS=35 BLOCK_MS=35
    kubectl -n hpa-demo scale deployment/loadgen --replicas=1
    ;;
  *)
    echo "Usage: $0 {idle|microburst|heavy}"
    exit 1
    ;;
esac

