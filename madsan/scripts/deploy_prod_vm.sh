#!/usr/bin/env bash
# MadSan production VM deploy — invoked by GitHub Actions and manual SSH.
#
# Requires bash (arrays/mapfile). Env:
#   IMAGE_TAG, MADSAN_DEPLOY_PATH, LEGACY_DEPLOY_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN
#
# Usage (after git sync on VM):
#   IMAGE_TAG=latest ./madsan/scripts/deploy_prod_vm.sh
set -euo pipefail

DEPLOY_PATH="${MADSAN_DEPLOY_PATH:-/opt/madsan}"
LEGACY_PATH="${LEGACY_DEPLOY_PATH:-/opt/mining-map}"
MADSAN_PROJECT="madsan"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found in PATH (PATH=${PATH})"
  exit 1
fi
if ! docker info >/dev/null 2>&1 && ! sudo docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon not reachable (permission denied or not running)"
  exit 1
fi

_step() {
  echo "=== STEP: $* ==="
}

_volume_is_empty() {
  local vol="$1"
  local rc=0
  set +e
  if ! docker volume inspect "${vol}" >/dev/null 2>&1; then
    set -e
    return 0
  fi
  local count
  count="$(docker run --rm -v "${vol}:/v" alpine sh -c 'ls -A /v 2>/dev/null | wc -l' 2>/dev/null || true)"
  count="${count//[[:space:]]/}"
  if [ -z "${count}" ]; then
    count=0
  fi
  if [ "${count}" -eq 0 ] 2>/dev/null; then
    rc=0
  else
    rc=1
  fi
  set -e
  return "${rc}"
}

_stop_legacy_stack() {
  local legacy_path="$1"
  local compose_file="${legacy_path}/docker-compose.prod.yml"
  if [ ! -f "${compose_file}" ]; then
    echo "No legacy compose at ${compose_file} - skipping legacy shutdown"
    return 0
  fi
  echo "Stopping legacy mining-map stack at ${legacy_path} (volumes preserved)..."
  local down_ok=false
  if (cd "${legacy_path}" && docker compose -p mining-map -f docker-compose.prod.yml down --remove-orphans); then
    down_ok=true
  elif (cd "${legacy_path}" && sudo docker compose -p mining-map -f docker-compose.prod.yml down --remove-orphans); then
    down_ok=true
  elif (cd "${legacy_path}" && sudo docker-compose -p mining-map -f docker-compose.prod.yml down --remove-orphans); then
    down_ok=true
  fi
  if [ "${down_ok}" = "true" ]; then
    echo "Legacy stack stopped"
  else
    echo "WARN: legacy stack shutdown failed (permission, compose missing, or stack not running) - continuing MadSan deploy"
  fi
  return 0
}

_ensure_deploy_path_ready() {
  local path="$1"
  if [ -d "${path}" ]; then
    if [ -w "${path}" ]; then
      return 0
    fi
    if [ -z "$(ls -A "${path}" 2>/dev/null || true)" ]; then
      sudo chown "$(whoami):$(whoami)" "${path}"
      return 0
    fi
    echo "ERROR: ${path} exists, is not writable, and is not empty"
    return 1
  fi
  sudo mkdir -p "${path}"
  sudo chown "$(whoami):$(whoami)" "${path}"
}

_bootstrap_deploy_checkout() {
  if [ -d "${DEPLOY_PATH}/.git" ]; then
    return 0
  fi

  echo "Bootstrapping ${DEPLOY_PATH} (not a git checkout)..."

  if [ -d "${LEGACY_PATH}/.git" ] && [ -r "${LEGACY_PATH}" ]; then
    if [ ! -e "${DEPLOY_PATH}" ] || [ -z "$(ls -A "${DEPLOY_PATH}" 2>/dev/null || true)" ]; then
      rm -rf "${DEPLOY_PATH}" 2>/dev/null || sudo rm -rf "${DEPLOY_PATH}" 2>/dev/null || true
      if [ ! -e "${DEPLOY_PATH}" ]; then
        sudo ln -sfn "${LEGACY_PATH}" "${DEPLOY_PATH}" 2>/dev/null \
          || ln -sfn "${LEGACY_PATH}" "${DEPLOY_PATH}"
      fi
      echo "Linked ${DEPLOY_PATH} -> ${LEGACY_PATH} (legacy checkout)"
      return 0
    fi
    echo "WARN: ${DEPLOY_PATH} is non-empty and not a git repo - cannot symlink legacy ${LEGACY_PATH}"
  fi

  if [ -d "${DEPLOY_PATH}" ] && [ -n "$(ls -A "${DEPLOY_PATH}" 2>/dev/null || true)" ]; then
    echo "ERROR: ${DEPLOY_PATH} is not empty and not a git checkout - manual cleanup required"
    exit 1
  fi

  if [ -z "${GITHUB_REPOSITORY:-}" ]; then
    echo "ERROR: GITHUB_REPOSITORY not set - cannot clone"
    exit 1
  fi
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "ERROR: GITHUB_TOKEN not set - cannot clone private repo"
    exit 1
  fi

  _clone_repo() {
    local target="$1"
    echo "Cloning https://github.com/${GITHUB_REPOSITORY}.git into ${target}..."
    git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "${target}"
    git -C "${target}" remote set-url origin "https://github.com/${GITHUB_REPOSITORY}.git"
  }

  if _ensure_deploy_path_ready "${DEPLOY_PATH}"; then
    rm -rf "${DEPLOY_PATH}" 2>/dev/null || sudo rm -rf "${DEPLOY_PATH}" 2>/dev/null || true
    _ensure_deploy_path_ready "${DEPLOY_PATH}"
    _clone_repo "${DEPLOY_PATH}"
  else
    FALLBACK_PATH="${HOME}/madsan"
    echo "WARN: cannot prepare ${DEPLOY_PATH} (passwordless sudo for mkdir/chown required) - cloning to ${FALLBACK_PATH}"
    rm -rf "${FALLBACK_PATH}" 2>/dev/null || true
    _clone_repo "${FALLBACK_PATH}"
    if sudo ln -sfn "${FALLBACK_PATH}" "${DEPLOY_PATH}" 2>/dev/null; then
      echo "Symlinked ${DEPLOY_PATH} -> ${FALLBACK_PATH}"
    else
      echo "WARN: could not symlink ${DEPLOY_PATH}; using ${FALLBACK_PATH} for this deploy"
      DEPLOY_PATH="${FALLBACK_PATH}"
    fi
  fi
}

_bootstrap_deploy_checkout

_step "sync deploy checkout to origin/main"
cd "${DEPLOY_PATH}"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  echo "WARN: discarding uncommitted VM working-tree changes before deploy sync"
  git status --short || true
fi
git fetch --tags origin
git reset --hard origin/main

if [ -f madsan/scripts/seed_prod_volumes.sh ]; then
  chmod +x madsan/scripts/seed_prod_volumes.sh
elif [ -f scripts/seed_prod_volumes.sh ]; then
  chmod +x scripts/seed_prod_volumes.sh
fi

if [ -f madsan/deploy/docker-compose.yml ]; then
  COMPOSE_DIR="madsan/deploy"
  REPO_ROOT="${DEPLOY_PATH}"
  SEED_SCRIPT="madsan/scripts/seed_prod_volumes.sh"
elif [ -f deploy/docker-compose.yml ]; then
  COMPOSE_DIR="deploy"
  REPO_ROOT="${DEPLOY_PATH}"
  SEED_SCRIPT="scripts/seed_prod_volumes.sh"
else
  echo "ERROR: cannot find docker-compose.yml under ${DEPLOY_PATH}"
  exit 1
fi

_step "prepare deploy env"
ENV_FILE="${REPO_ROOT}/${COMPOSE_DIR}/.env"
ENV_EXAMPLE="${REPO_ROOT}/${COMPOSE_DIR}/.env.example"
if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${ENV_EXAMPLE}" ]; then
    if ! cp "${ENV_EXAMPLE}" "${ENV_FILE}"; then
      echo "ERROR: failed to copy ${ENV_EXAMPLE} to ${ENV_FILE}"
      ls -la "${REPO_ROOT}/${COMPOSE_DIR}/" || true
      exit 1
    fi
    echo "Created ${ENV_FILE} from .env.example - set secrets on the host before relying on prod traffic"
  else
    echo "ERROR: missing ${ENV_FILE} and ${ENV_EXAMPLE}"
    ls -la "${REPO_ROOT}/${COMPOSE_DIR}/" || true
    exit 1
  fi
fi
if [ ! -r "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} exists but is not readable"
  ls -la "${REPO_ROOT}/${COMPOSE_DIR}/" || true
  exit 1
fi
echo "ENV_FILE=${ENV_FILE} exists=$(test -f "${ENV_FILE}" && echo yes || echo no) readable=$(test -r "${ENV_FILE}" && echo yes || echo no)"

_step "sync deploy secrets from GitHub Actions"
# The GitHub Actions deploy job passes select API keys as environment variables (no secret values printed).
# This script upserts ONLY non-empty values into ${ENV_FILE}.
SYNC_SCRIPT=""
if [ -f "${REPO_ROOT}/madsan/scripts/sync_deploy_secrets_from_gha.sh" ]; then
  SYNC_SCRIPT="${REPO_ROOT}/madsan/scripts/sync_deploy_secrets_from_gha.sh"
elif [ -f "${REPO_ROOT}/scripts/sync_deploy_secrets_from_gha.sh" ]; then
  SYNC_SCRIPT="${REPO_ROOT}/scripts/sync_deploy_secrets_from_gha.sh"
fi

if [ -n "${SYNC_SCRIPT}" ]; then
  chmod +x "${SYNC_SCRIPT}" 2>/dev/null || true
  bash "${SYNC_SCRIPT}" "${ENV_FILE}"
else
  echo "WARN: secrets sync script not found — skipping GitHub secrets → VM .env sync"
fi

if grep -Eq '^AISSTREAM_API_KEY=.+$' "${ENV_FILE}"; then
  echo "AISSTREAM_API_KEY now set - enabling ais profile"
else
  echo "AISSTREAM_API_KEY still empty - AIS ingest stays disabled"
fi

NEED_SEED=false
if _volume_is_empty madsan_raw_data; then
  NEED_SEED=true
fi
if _volume_is_empty madsan_etl_data; then
  NEED_SEED=true
fi
if [ "${NEED_SEED}" = "true" ]; then
  if [ -x "${REPO_ROOT}/${SEED_SCRIPT}" ]; then
    _step "seed prod volumes"
    if (cd "${REPO_ROOT}" && "./${SEED_SCRIPT}"); then
      echo "Volume seed finished successfully"
    else
      echo "ERROR: ${SEED_SCRIPT} failed"
      exit 1
    fi
  else
    echo "WARN: ${SEED_SCRIPT} missing or not executable - skipping volume seed"
  fi
else
  echo "Prod volumes already populated - skipping seed_prod_volumes.sh"
fi

_step "legacy stack shutdown"
_stop_legacy_stack "${LEGACY_PATH}"

COMPOSE_PROD="${REPO_ROOT}/madsan/scripts/compose_prod.sh"
if [ ! -x "${COMPOSE_PROD}" ]; then
  chmod +x "${COMPOSE_PROD}"
fi
if [ ! -f "${COMPOSE_PROD}" ]; then
  echo "ERROR: missing ${COMPOSE_PROD}"
  exit 1
fi

PROFILES=(--profile proxy)
if grep -Eq '^AISSTREAM_API_KEY=.+$' "${ENV_FILE}"; then
  PROFILES+=(--profile ais)
  echo "AISSTREAM_API_KEY set - enabling ais profile"
else
  echo "AISSTREAM_API_KEY unset - skipping ais profile"
fi

_step "compose pull or build"
echo "Deploying app IMAGE_TAG=${IMAGE_TAG:-latest} from git $(git rev-parse --short HEAD)"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

PULL_SERVICES=(madsan-db madsan-api madsan-worker madsan-scheduler madsan-frontend)
if grep -Eq '^AISSTREAM_API_KEY=.+$' "${ENV_FILE}"; then
  PULL_SERVICES+=(madsan-ais-ingest)
fi

PULL_OK=true
if ! "${COMPOSE_PROD}" "${PROFILES[@]}" pull "${PULL_SERVICES[@]}"; then
  echo "Registry pull failed - falling back to on-VM build"
  PULL_OK=false
fi

if [ "${PULL_OK}" = "false" ]; then
  "${COMPOSE_PROD}" "${PROFILES[@]}" build --pull
fi

CRITICAL_SERVICES=(madsan-db madsan-api madsan-worker madsan-scheduler madsan-frontend caddy)
if grep -Eq '^AISSTREAM_API_KEY=.+$' "${ENV_FILE}"; then
  CRITICAL_SERVICES+=(madsan-ais-ingest)
fi

_step "compose up"
echo "Bringing up stack (waiting for healthchecks)..."
if ! "${COMPOSE_PROD}" "${PROFILES[@]}" up -d --remove-orphans --wait --wait-timeout 180; then
  echo "WARN: compose --wait failed or timed out - falling back to manual health poll"
  if "${COMPOSE_PROD}" "${PROFILES[@]}" ps --format json 2>/dev/null | grep -q 'does not provide the specified platform'; then
    echo "HINT: arm64 VMs need MADSAN_DB_IMAGE=imresamu/postgis:16-3.6.1-bookworm (see docker-compose.prod.yml)"
  fi
  "${COMPOSE_PROD}" "${PROFILES[@]}" ps || true
fi

_service_health_ok() {
  local svc="$1"
  local row
  row="$("${COMPOSE_PROD}" "${PROFILES[@]}" ps --status running --format json "${svc}" 2>/dev/null | head -1 || true)"
  if [ -z "${row}" ]; then
    return 1
  fi
  local health=""
  if command -v jq >/dev/null 2>&1; then
    health="$(echo "${row}" | jq -r '.Health // empty' 2>/dev/null || true)"
  else
    health="$(echo "${row}" | sed -n 's/.*"Health":"\([^"]*\)".*/\1/p' | head -1 || true)"
  fi
  if [ -z "${health}" ] || [ "${health}" = "healthy" ]; then
    return 0
  fi
  return 1
}

_step "compose health poll"
echo "Verifying critical services: ${CRITICAL_SERVICES[*]}"
READY=false
for i in $(seq 1 90); do
  ALL_OK=true
  for svc in "${CRITICAL_SERVICES[@]}"; do
    if ! _service_health_ok "${svc}"; then
      ALL_OK=false
      break
    fi
  done
  if [ "${ALL_OK}" = "true" ]; then
    READY=true
    break
  fi
  sleep 2
done

if [ "${READY}" != "true" ]; then
  echo "ERROR: compose health poll failed"
  "${COMPOSE_PROD}" "${PROFILES[@]}" ps
  exit 1
fi
echo "Compose health checks passed for: ${CRITICAL_SERVICES[*]}"

_step "edge health via Caddy"
echo "Verifying edge health via Caddy..."
CURL_OK=false
for i in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 10 http://127.0.0.1/health >/dev/null 2>&1; then
    CURL_OK=true
    break
  fi
  sleep 2
done

if [ "${CURL_OK}" != "true" ]; then
  echo "ERROR: Caddy → API health check failed after deploy"
  "${COMPOSE_PROD}" "${PROFILES[@]}" ps
  exit 1
fi
echo "Edge health check passed: http://127.0.0.1/health"

_step "scoped image cleanup"
echo "Scoped image cleanup (project=${MADSAN_PROJECT})..."
docker image prune -f

mapfile -t PROJECT_IMAGES < <(docker images -q --filter "label=com.docker.compose.project=${MADSAN_PROJECT}" 2>/dev/null | sort -u || true)
for img_id in "${PROJECT_IMAGES[@]:-}"; do
  [ -z "${img_id}" ] && continue
  if [ -z "$(docker ps -aq --filter "ancestor=${img_id}" 2>/dev/null)" ]; then
    docker rmi "${img_id}" 2>/dev/null || true
  fi
done

docker builder prune -f --filter "until=48h" 2>/dev/null || true

echo "Deploy complete."
"${COMPOSE_PROD}" ps
