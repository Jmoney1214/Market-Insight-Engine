#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
migration="$repo_root/lib/db/migrations/0002_immutable_pine_candidate_boards.sql"
pgtap_test="$repo_root/lib/db/tests/candidate_boards.pgtap.sql"
concurrency_test="$repo_root/lib/db/tests/candidate_boards_concurrency.sh"
container="findesk-candidate-boards-$(date +%s)-${RANDOM}"
container_id=""
database="candidate_boards_test"
password="candidate-board-test-only"

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_id="$(docker run --name "$container" --detach \
  --env POSTGRES_PASSWORD="$password" \
  --env POSTGRES_DB="$database" \
  postgres:17-bookworm)"

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d "$database" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ $ready -ne 1 ]]; then
  echo "Isolated PostgreSQL container did not become ready." >&2
  exit 1
fi

docker exec "$container" bash -ec \
  'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-17-pgtap >/dev/null'
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
  -c 'CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgtap;'

if [[ ! -f "$migration" ]]; then
  echo "Expected RED: migration absent; probing the required app routine." >&2
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
    -c "SELECT app.create_candidate_board_v1('11111111-1111-4111-8111-111111111111'::uuid, 'ganihlwaijdxpigssyab', 'findesk-1.0.0', 'red-probe', DATE '2026-07-15', 'PREMARKET_OFFICIAL', TIMESTAMPTZ '2026-07-15 13:28:00+00', TIMESTAMPTZ '2026-07-15 13:25:00+00', TIMESTAMPTZ '2026-07-15 13:28:00+00', NULL);"
  exit 1
fi

docker cp "$migration" "$container:/tmp/0002.sql"
docker cp "$pgtap_test" "$container:/tmp/candidate_boards.pgtap.sql"
docker cp "$concurrency_test" "$container:/tmp/candidate_boards_concurrency.sh"
docker exec "$container" chmod 0700 /tmp/candidate_boards_concurrency.sh

# Empty legacy drift must be safely removed by the migration.
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.candidate_boards (id text PRIMARY KEY);
CREATE TABLE public.candidate_board_entries (id text PRIMARY KEY, board_id text);
CREATE VIEW public.pine_candidate_boards_v1 AS SELECT id FROM public.candidate_boards;
CREATE FUNCTION public.freeze_candidate_board(text) RETURNS text LANGUAGE sql AS 'SELECT $1';
CREATE FUNCTION public.prevent_frozen_candidate_board_mutation() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
CREATE TRIGGER legacy_candidate_board_guard BEFORE UPDATE ON public.candidate_boards
FOR EACH ROW EXECUTE FUNCTION public.prevent_frozen_candidate_board_mutation();
SQL
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f /tmp/0002.sql >/dev/null
docker exec "$container" pg_prove -U postgres -d "$database" /tmp/candidate_boards.pgtap.sql
docker exec --env PGDATABASE="$database" --env PGUSER=postgres "$container" /tmp/candidate_boards_concurrency.sh

# Separate databases prove either nonempty legacy table fails closed and the
# transaction preserves every legacy object plus the populated row.
run_drift_refusal_proof() {
  local drift_case="$1"
  local drift_database="candidate_boards_drift_${drift_case}"
  local expected_counts
  local drift_output
  local drift_status

  docker exec "$container" createdb -U postgres "$drift_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$drift_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.candidate_boards (id text PRIMARY KEY);
CREATE TABLE public.candidate_board_entries (id text PRIMARY KEY, board_id text);
CREATE VIEW public.pine_candidate_boards_v1 AS SELECT id FROM public.candidate_boards;
CREATE FUNCTION public.freeze_candidate_board(text) RETURNS text LANGUAGE sql AS 'SELECT $1';
CREATE FUNCTION public.prevent_frozen_candidate_board_mutation() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
CREATE TRIGGER legacy_candidate_board_guard BEFORE UPDATE ON public.candidate_boards
FOR EACH ROW EXECUTE FUNCTION public.prevent_frozen_candidate_board_mutation();
SQL

  if [[ "$drift_case" == "board" ]]; then
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$drift_database" \
      -c "INSERT INTO public.candidate_boards VALUES ('legacy-board-must-survive')" >/dev/null
    expected_counts="1|0"
  else
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$drift_database" \
      -c "INSERT INTO public.candidate_board_entries VALUES ('legacy-entry-must-survive','untracked-parent')" >/dev/null
    expected_counts="0|1"
  fi

  set +e
  drift_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$drift_database" -f /tmp/0002.sql 2>&1)"
  drift_status=$?
  set -e
  if [[ $drift_status -eq 0 || "$drift_output" != *"PINE_CANDIDATE_BOARD_LEGACY_DATA_PRESENT"* ]]; then
    echo "${drift_case}-only legacy drift did not fail with the stable refusal code." >&2
    echo "$drift_output" >&2
    exit 1
  fi

  docker exec "$container" psql -At -U postgres -d "$drift_database" -c "
    SELECT count(*) || '|' || (SELECT count(*) FROM public.candidate_board_entries)
    FROM public.candidate_boards;
  " | grep -qx "$expected_counts"
  docker exec "$container" psql -At -U postgres -d "$drift_database" -c "
    SELECT
      (to_regclass('public.candidate_boards') IS NOT NULL)::int || '|' ||
      (to_regclass('public.candidate_board_entries') IS NOT NULL)::int || '|' ||
      (to_regclass('public.pine_candidate_boards_v1') IS NOT NULL)::int || '|' ||
      (to_regprocedure('public.freeze_candidate_board(text)') IS NOT NULL)::int || '|' ||
      (to_regprocedure('public.prevent_frozen_candidate_board_mutation()') IS NOT NULL)::int || '|' ||
      (EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='legacy_candidate_board_guard' AND NOT tgisinternal))::int;
  " | grep -qx '1|1|1|1|1|1'
}

run_drift_refusal_proof board
run_drift_refusal_proof entry

echo "candidate-board database proof passed"
