# Project Rules & Agent Guidelines (`AGENTS.md`)

## 1. Do Not Rebuild or Redeploy Unless Explicitly Asked
- When asked to make code, manifest, script, or configuration changes, **only modify the relevant files**.
- **Do NOT** automatically run `docker build`, `kubectl apply`, `kubectl rollout restart`, `helm`, or `colima` commands after making changes unless the user explicitly asks to build or deploy them.

## 2. Infrastructure as Code (IaC) First
- All Kubernetes resources (including operators such as KEDA, namespaces, ConfigMaps, Deployments, Services, HPAs, and ScaledObjects) must be declared in version-controlled manifests (`k8s/` and `kustomization.yaml`), never applied ad-hoc via imperative CLI commands.

## 3. Project Structure
- `app/`: Node.js server application exporting Prometheus metrics via `prom-client`.
- `k6s/`: Standalone Grafana k6 load-testing scripts (`loadgen.js`, etc.) following k6 best practices (open-model arrival rates, tail latency thresholds, tagged requests for Prometheus Remote Write).
- `k8s/`: Declarative Kubernetes manifests and Kustomize configuration.
- `scripts/`: Helper scripts for setup and switching load profiles.
