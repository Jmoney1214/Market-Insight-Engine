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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_public_probe') THEN CREATE ROLE candidate_board_public_probe NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='findesk_candidate_board_publisher') THEN
    CREATE ROLE findesk_candidate_board_publisher LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pine_candidate_reader') THEN
    CREATE ROLE pine_candidate_reader LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
  END IF;
END $$;
ALTER ROLE findesk_candidate_board_publisher LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
ALTER ROLE pine_candidate_reader LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON TABLES TO findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON FUNCTIONS TO findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON SEQUENCES TO findesk_candidate_board_publisher, pine_candidate_reader;
CREATE SCHEMA private;
CREATE SCHEMA app;
GRANT USAGE ON SCHEMA private, app TO PUBLIC;
GRANT ALL PRIVILEGES ON SCHEMA private, app TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON SCHEMA private, app TO findesk_candidate_board_publisher, pine_candidate_reader;
CREATE TABLE app.unrelated_acl_probe (id integer PRIMARY KEY);
CREATE TABLE private.unrelated_acl_probe (id integer PRIMARY KEY);
CREATE SEQUENCE app.unrelated_acl_probe_sequence;
CREATE SEQUENCE private.unrelated_acl_probe_sequence;
CREATE FUNCTION app.unrelated_acl_probe_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE FUNCTION private.unrelated_acl_probe_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE PROCEDURE app.unrelated_acl_probe_procedure() LANGUAGE plpgsql AS 'BEGIN NULL; END';
CREATE PROCEDURE private.unrelated_acl_probe_procedure() LANGUAGE plpgsql AS 'BEGIN NULL; END';
REVOKE EXECUTE ON FUNCTION app.unrelated_acl_probe_function() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.unrelated_acl_probe_function() FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE app.unrelated_acl_probe_procedure() FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE private.unrelated_acl_probe_procedure() FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE app.unrelated_acl_probe_procedure(), private.unrelated_acl_probe_procedure()
  TO findesk_candidate_board_publisher, pine_candidate_reader;
INSERT INTO app.unrelated_acl_probe VALUES (1);
INSERT INTO private.unrelated_acl_probe VALUES (1);
GRANT SELECT ON app.unrelated_acl_probe, private.unrelated_acl_probe TO anon, authenticated, service_role;
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

# A pre-existing private target is not migration-owned authority, even when it
# looks compatible enough for CREATE TABLE IF NOT EXISTS to reuse it.
run_private_target_refusal_proof() {
  local target_database="candidate_boards_private_target_drift"
  local target_output
  local target_status

  docker exec "$container" createdb -U postgres "$target_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$target_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA private;
CREATE SCHEMA app;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_private_drift_owner') THEN
    CREATE ROLE candidate_board_private_drift_owner NOLOGIN;
  END IF;
END $$;
GRANT USAGE, CREATE ON SCHEMA private TO candidate_board_private_drift_owner;
SET ROLE candidate_board_private_drift_owner;
CREATE TABLE private.candidate_boards (
  schema_version integer, source_board_id uuid PRIMARY KEY, source_project_ref text,
  source_system_version text, source_run_id text, trade_date date, board_type text,
  stage_scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz,
  decision_cutoff_at timestamptz, frozen_at timestamptz, status text, exception_code text,
  parent_board_id uuid, board_hash text, candidate_count integer, created_at timestamptz
);
CREATE TABLE private.candidate_board_entries (
  source_board_id uuid, symbol text, source_rank integer, source_score double precision,
  first_seen_board_id uuid, first_seen_at timestamptz, evidence_cutoff_at timestamptz,
  evidence_reference_ids text[], reason_codes text[], source_reason_summary text,
  entry_hash text, created_at timestamptz
);
INSERT INTO private.candidate_boards VALUES (
  99,'10101010-1010-4010-8010-101010101010','attacker','attacker','attacker',DATE '2026-07-15','UNCONSTRAINED',
  now(),now(),NULL,now(),NULL,'ATTACKER',NULL,NULL,NULL,999,now()
);
RESET ROLE;
SQL

  set +e
  target_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$target_database" -f /tmp/0002.sql 2>&1)"
  target_status=$?
  set -e
  if [[ $target_status -eq 0 || "$target_output" != *"PINE_CANDIDATE_BOARD_PRIVATE_TARGET_PRESENT"* ]]; then
    echo "Pre-existing private candidate targets did not fail with the stable refusal code." >&2
    echo "$target_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$target_database" -c "
    SELECT count(*) || '|' || pg_get_userbyid(c.relowner) || '|' ||
      (to_regclass('private.candidate_board_entries') IS NOT NULL)::int
    FROM private.candidate_boards b
    CROSS JOIN pg_class c
    WHERE c.oid='private.candidate_boards'::regclass
    GROUP BY c.relowner;
  " | grep -qx '1|candidate_board_private_drift_owner|1'
}

# Shared schemas may pre-exist, but their owner must be the trusted migration
# principal. An unknown owner could later replace SECURITY DEFINER authority.
run_untrusted_schema_owner_refusal_proof() {
  local schema_database="candidate_boards_untrusted_schema_owner"
  local schema_output
  local schema_status

  docker exec "$container" createdb -U postgres "$schema_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$schema_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_untrusted_schema_owner') THEN
    CREATE ROLE candidate_board_untrusted_schema_owner NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA private AUTHORIZATION candidate_board_untrusted_schema_owner;
CREATE SCHEMA app;
SQL

  set +e
  schema_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$schema_database" -f /tmp/0002.sql 2>&1)"
  schema_status=$?
  set -e
  if [[ $schema_status -eq 0 || "$schema_output" != *"PINE_CANDIDATE_BOARD_SCHEMA_OWNER_UNTRUSTED"* ]]; then
    echo "Untrusted app/private schema owner did not fail with the stable refusal code." >&2
    echo "$schema_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$schema_database" -c "
    SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='private';
  " | grep -qx 'candidate_board_untrusted_schema_owner'
}

# Revokes cannot remove implicit owner authority. Any app/private ownership by
# a dedicated role must abort without rewriting that ownership or object.
run_dedicated_owner_refusal_proof() {
  local owner_database="candidate_boards_dedicated_owner_drift"
  local owner_output
  local owner_status

  docker exec "$container" createdb -U postgres "$owner_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$owner_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA private;
CREATE SCHEMA app;
ALTER SCHEMA app OWNER TO pine_candidate_reader;
GRANT USAGE, CREATE ON SCHEMA private TO findesk_candidate_board_publisher;
SET ROLE findesk_candidate_board_publisher;
CREATE TABLE private.dedicated_owner_probe (id integer PRIMARY KEY);
INSERT INTO private.dedicated_owner_probe VALUES (1);
RESET ROLE;
SQL

  set +e
  owner_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$owner_database" -f /tmp/0002.sql 2>&1)"
  owner_status=$?
  set -e
  if [[ $owner_status -eq 0 || "$owner_output" != *"PINE_CANDIDATE_BOARD_ROLE_OWNERSHIP_PRESENT"* ]]; then
    echo "Dedicated-role app/private ownership did not fail with the stable refusal code." >&2
    echo "$owner_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$owner_database" -c "
    SELECT pg_get_userbyid(nspowner) || '|' ||
      pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='private.dedicated_owner_probe'::regclass)) || '|' ||
      (SELECT count(*) FROM private.dedicated_owner_probe)
    FROM pg_namespace WHERE nspname='app';
  " | grep -qx 'pine_candidate_reader|findesk_candidate_board_publisher|1'
}

# Default ACLs owned by an unknown principal can re-expand dedicated authority
# after migration. They are ambiguous and must fail closed atomically.
run_foreign_default_acl_refusal_proof() {
  local acl_database="candidate_boards_foreign_default_acl"
  local acl_output
  local acl_status

  docker exec "$container" createdb -U postgres "$acl_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$acl_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA private;
CREATE SCHEMA app;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_foreign_default_owner') THEN
    CREATE ROLE candidate_board_foreign_default_owner NOLOGIN;
  END IF;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE candidate_board_foreign_default_owner IN SCHEMA app
  GRANT ALL PRIVILEGES ON TABLES TO pine_candidate_reader;
SQL

  set +e
  acl_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$acl_database" -f /tmp/0002.sql 2>&1)"
  acl_status=$?
  set -e
  if [[ $acl_status -eq 0 || "$acl_output" != *"PINE_CANDIDATE_BOARD_ROLE_DEFAULT_ACL_PRESENT"* ]]; then
    echo "Foreign-owner dedicated-role default ACL did not fail with the stable refusal code." >&2
    echo "$acl_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$acl_database" -c "
    SELECT count(DISTINCT defaults.oid) FROM pg_default_acl defaults
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
    JOIN pg_roles grantee ON grantee.oid=acl.grantee
    WHERE defaults.defaclrole='candidate_board_foreign_default_owner'::regrole
      AND grantee.rolname='pine_candidate_reader';
  " | grep -qx '1'
}

# PUBLIC CREATE applies to every role and cannot be subtracted from the two
# dedicated roles. Refuse it atomically while preserving the shared schemas,
# their ACLs, and unrelated data for an operator-led remediation.
run_public_schema_create_refusal_proof() {
  local schema_database="candidate_boards_public_schema_create"
  local schema_output
  local schema_status

  docker exec "$container" createdb -U postgres "$schema_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$schema_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA private;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA private, app TO PUBLIC;
CREATE TABLE app.public_create_policy_probe (id integer PRIMARY KEY);
INSERT INTO app.public_create_policy_probe VALUES (1);
SQL

  set +e
  schema_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$schema_database" -f /tmp/0002.sql 2>&1)"
  schema_status=$?
  set -e
  if [[ $schema_status -eq 0 || "$schema_output" != *"PINE_CANDIDATE_BOARD_PUBLIC_SCHEMA_CREATE_PRESENT"* ]]; then
    echo "PUBLIC CREATE on app/private did not fail with the stable refusal code." >&2
    echo "$schema_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$schema_database" -c "
    SELECT
      has_schema_privilege('candidate_board_public_probe','app','CREATE')::int || '|' ||
      has_schema_privilege('candidate_board_public_probe','private','CREATE')::int || '|' ||
      (SELECT count(*) FROM app.public_create_policy_probe);
  " | grep -qx '1|1|1'
}

# Unknown inherited authority is not safe to rewrite automatically. Prove the
# migration refuses both directions of a membership edge touching either
# dedicated role, and that the transaction preserves role/object state.
run_membership_refusal_proof() {
  local membership_direction="$1"
  local membership_database="candidate_boards_role_membership_${membership_direction}"
  local membership_output
  local membership_status

  docker exec "$container" createdb -U postgres "$membership_database"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE public.candidate_boards (id text PRIMARY KEY);
CREATE TABLE public.candidate_board_entries (id text PRIMARY KEY, board_id text);
CREATE VIEW public.pine_candidate_boards_v1 AS SELECT id FROM public.candidate_boards;
CREATE FUNCTION public.freeze_candidate_board(text) RETURNS text LANGUAGE sql AS 'SELECT $1';
CREATE FUNCTION public.prevent_frozen_candidate_board_mutation() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
CREATE TRIGGER legacy_candidate_board_guard BEFORE UPDATE ON public.candidate_boards
FOR EACH ROW EXECUTE FUNCTION public.prevent_frozen_candidate_board_mutation();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_unknown_parent') THEN
    CREATE ROLE candidate_board_unknown_parent NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='candidate_board_unknown_member') THEN
    CREATE ROLE candidate_board_unknown_member LOGIN;
  END IF;
END $$;
ALTER ROLE findesk_candidate_board_publisher LOGIN INHERIT CREATEDB CREATEROLE;
SQL

  if [[ "$membership_direction" == "parent" ]]; then
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" \
      -c 'GRANT candidate_board_unknown_parent TO findesk_candidate_board_publisher' >/dev/null
  else
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" \
      -c 'GRANT findesk_candidate_board_publisher TO candidate_board_unknown_member' >/dev/null
  fi

  set +e
  membership_output="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" -f /tmp/0002.sql 2>&1)"
  membership_status=$?
  set -e
  if [[ $membership_status -eq 0 || "$membership_output" != *"PINE_CANDIDATE_BOARD_ROLE_MEMBERSHIP_PRESENT"* ]]; then
    echo "Dedicated-role ${membership_direction} membership did not fail with the stable refusal code." >&2
    echo "$membership_output" >&2
    exit 1
  fi
  docker exec "$container" psql -At -U postgres -d "$membership_database" -c "
    SELECT rolcanlogin::int || '|' || rolinherit::int || '|' || rolcreatedb::int || '|' || rolcreaterole::int || '|' ||
      (EXISTS(
        SELECT 1 FROM pg_auth_members
        WHERE member=role_state.oid OR roleid=role_state.oid
      ))::int
    FROM pg_roles role_state WHERE rolname='findesk_candidate_board_publisher';
  " | grep -qx '1|1|1|1|1'
  docker exec "$container" psql -At -U postgres -d "$membership_database" -c "
    SELECT
      (to_regclass('public.candidate_boards') IS NOT NULL)::int || '|' ||
      (to_regclass('public.candidate_board_entries') IS NOT NULL)::int || '|' ||
      (to_regclass('public.pine_candidate_boards_v1') IS NOT NULL)::int || '|' ||
      (to_regprocedure('public.freeze_candidate_board(text)') IS NOT NULL)::int || '|' ||
      (to_regprocedure('public.prevent_frozen_candidate_board_mutation()') IS NOT NULL)::int || '|' ||
      (EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='legacy_candidate_board_guard' AND NOT tgisinternal))::int;
  " | grep -qx '1|1|1|1|1|1'

  if [[ "$membership_direction" == "parent" ]]; then
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" \
      -c 'REVOKE candidate_board_unknown_parent FROM findesk_candidate_board_publisher' >/dev/null
  else
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$membership_database" \
      -c 'REVOKE findesk_candidate_board_publisher FROM candidate_board_unknown_member' >/dev/null
  fi
}

run_membership_refusal_proof parent
run_membership_refusal_proof member
run_private_target_refusal_proof
run_untrusted_schema_owner_refusal_proof
run_dedicated_owner_refusal_proof
run_foreign_default_acl_refusal_proof
run_public_schema_create_refusal_proof

echo "candidate-board database proof passed"
