-- Immutable, versioned FinDesk candidate-board authority for the read-only Pine handoff.
-- This migration owns private durable tables and app routines; Drizzle exports types only.

BEGIN;

-- These objects are a new security authority, not an idempotent replacement
-- for arbitrary pre-existing objects. Fail before touching legacy public
-- drift so a partial/manual/attacker-owned authority is preserved for review.
DO $authority_preflight$
BEGIN
  IF to_regclass('private.candidate_boards') IS NOT NULL
    OR to_regclass('private.candidate_board_entries') IS NOT NULL
    OR to_regclass('app.pine_candidate_boards_v1') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname IN ('app', 'private')
        AND procedure.proname = ANY (ARRAY[
          'canonical_date_in_range_v1', 'canonical_date_v1',
          'canonical_timestamp_in_range_v1', 'canonical_timestamp_v1',
          'ecmascript_trim_v1', 'utf16_code_unit_length_v1',
          'text_array_is_canonical_v1', 'canonical_json_string_v1',
          'canonical_float8_v1', 'canonical_text_array_v1',
          'canonical_candidate_entry_json_v1',
          'compute_candidate_board_entry_hash_v1',
          'compute_candidate_board_payload_hash_v1',
          'compute_candidate_board_hash_v1',
          'guard_candidate_board_mutation_v1',
          'guard_candidate_board_entry_v1',
          'reject_candidate_board_truncate_v1',
          'read_pine_candidate_boards_v1',
          'create_candidate_board_v1',
          'append_candidate_board_entry_v1',
          'freeze_candidate_board_v1'
        ]::text[])
    )
  THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_PRIVATE_TARGET_PRESENT' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace namespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
    WHERE namespace.nspname IN ('app', 'private')
      AND owner_role.rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname IN ('app', 'private')
      AND owner_role.rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE namespace.nspname IN ('app', 'private')
      AND owner_role.rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
  )
  THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_ROLE_OWNERSHIP_PRESENT' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace namespace
    WHERE namespace.nspname IN ('app', 'private')
      AND namespace.nspowner <> current_user::regrole::oid
  )
  THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_SCHEMA_OWNER_UNTRUSTED' USING ERRCODE = '55000';
  END IF;

  -- PUBLIC CREATE cannot be subtracted from either dedicated role. Refuse a
  -- shared-schema policy that would let the reader or publisher plant new
  -- objects after their narrow grants are installed.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
    ) acl
    WHERE namespace.nspname IN ('app', 'private')
      AND acl.grantee = 0
      AND acl.privilege_type = 'CREATE'
  )
  THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_PUBLIC_SCHEMA_CREATE_PRESENT' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl defaults
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
    WHERE grantee.rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
      AND (defaults.defaclnamespace = 0 OR namespace.nspname IN ('app', 'private'))
      AND defaults.defaclrole <> current_user::regrole::oid
  )
  THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_ROLE_DEFAULT_ACL_PRESENT' USING ERRCODE = '55000';
  END IF;
END
$authority_preflight$;

DO $drift$
DECLARE
  board_rows bigint := 0;
  entry_rows bigint := 0;
BEGIN
  IF to_regclass('public.candidate_boards') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.candidate_boards IN ACCESS EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.candidate_board_entries') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.candidate_board_entries IN ACCESS EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.candidate_boards') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.candidate_boards' INTO board_rows;
  END IF;
  IF to_regclass('public.candidate_board_entries') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.candidate_board_entries' INTO entry_rows;
  END IF;
  IF board_rows <> 0 OR entry_rows <> 0 THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_LEGACY_DATA_PRESENT'
      USING ERRCODE = 'P0001', DETAIL = format('candidate_boards=%s candidate_board_entries=%s', board_rows, entry_rows);
  END IF;
END
$drift$;

DROP VIEW IF EXISTS public.pine_candidate_boards_v1;
DROP FUNCTION IF EXISTS public.freeze_candidate_board(text);
DO $cleanup$
BEGIN
  IF to_regclass('public.candidate_board_entries') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS prevent_frozen_candidate_board_entries_mutation ON public.candidate_board_entries';
  END IF;
  IF to_regclass('public.candidate_boards') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS prevent_frozen_candidate_board_mutation ON public.candidate_boards';
    EXECUTE 'DROP TRIGGER IF EXISTS legacy_candidate_board_guard ON public.candidate_boards';
  END IF;
END
$cleanup$;
DROP TABLE IF EXISTS public.candidate_board_entries;
DROP TABLE IF EXISTS public.candidate_boards;
DROP FUNCTION IF EXISTS public.prevent_frozen_candidate_board_mutation();

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS app;
DO $schema_owner_postcheck$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace namespace
    WHERE namespace.nspname IN ('app', 'private')
      AND namespace.nspowner <> current_user::regrole::oid
  ) THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_SCHEMA_OWNER_UNTRUSTED' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
    ) acl
    WHERE namespace.nspname IN ('app', 'private')
      AND acl.grantee = 0
      AND acl.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_PUBLIC_SCHEMA_CREATE_PRESENT' USING ERRCODE = '55000';
  END IF;
END
$schema_owner_postcheck$;
-- The app/private namespaces are shared. Preserve harmless PUBLIC USAGE, but
-- PUBLIC CREATE was refused above because it would defeat least privilege.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'findesk_candidate_board_publisher') THEN
    CREATE ROLE findesk_candidate_board_publisher;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pine_candidate_reader') THEN
    CREATE ROLE pine_candidate_reader;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members memberships
    WHERE memberships.member IN (
      SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
    ) OR memberships.roleid IN (
      SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname IN ('findesk_candidate_board_publisher', 'pine_candidate_reader')
    )
  ) THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_ROLE_MEMBERSHIP_PRESENT' USING ERRCODE = '55000';
  END IF;
  ALTER ROLE findesk_candidate_board_publisher
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER ROLE pine_candidate_reader
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'PINE_CANDIDATE_BOARD_ROLE_HARDENING_FAILED' USING ERRCODE = '42501';
END
$roles$;

-- Global and schema-specific default privileges are additive. Remove only
-- grants to the two dedicated roles for the migration owner; generic/public
-- defaults remain untouched. Foreign-owned defaults were refused above.
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TYPES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SCHEMAS
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, private REVOKE ALL PRIVILEGES ON TABLES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, private REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, private REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM findesk_candidate_board_publisher, pine_candidate_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA app, private REVOKE ALL PRIVILEGES ON TYPES
  FROM findesk_candidate_board_publisher, pine_candidate_reader;

CREATE FUNCTION private.canonical_date_in_range_v1(value date)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT extract(year FROM value) BETWEEN 1 AND 9999 $$;
REVOKE ALL ON FUNCTION private.canonical_date_in_range_v1(date) FROM PUBLIC;

CREATE FUNCTION private.canonical_date_v1(value date)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, private
AS $fn$
BEGIN
  IF NOT private.canonical_date_in_range_v1(value) THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_CANONICAL_DATE_RANGE' USING ERRCODE = '22008';
  END IF;
  RETURN to_char(value, 'YYYY-MM-DD');
END
$fn$;
REVOKE ALL ON FUNCTION private.canonical_date_v1(date) FROM PUBLIC;

CREATE FUNCTION private.canonical_timestamp_in_range_v1(value timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT extract(year FROM value AT TIME ZONE 'UTC') BETWEEN 1 AND 9999 $$;
REVOKE ALL ON FUNCTION private.canonical_timestamp_in_range_v1(timestamptz) FROM PUBLIC;

CREATE FUNCTION private.ecmascript_trim_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
REVOKE ALL ON FUNCTION private.ecmascript_trim_v1(text) FROM PUBLIC;

CREATE FUNCTION private.utf16_code_unit_length_v1(value text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(sum(
    CASE WHEN octet_length(character) = 4 THEN 2 ELSE 1 END
  ), 0)::integer
  FROM regexp_split_to_table(value, '') AS characters(character)
$$;
REVOKE ALL ON FUNCTION private.utf16_code_unit_length_v1(text) FROM PUBLIC;

CREATE FUNCTION private.text_array_is_canonical_v1(value text[], reason_codes boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT array_ndims(value) = 1
    AND array_lower(value, 1) = 1
    AND cardinality(value) > 0
    AND cardinality(value) = (SELECT count(DISTINCT item) FROM unnest(value) AS item)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(value) WITH ORDINALITY AS current(item, ordinal)
      WHERE (reason_codes AND item !~ '^[A-Z][A-Z0-9_]{0,127}$')
         OR (NOT reason_codes AND item !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
         OR (ordinal > 1 AND item COLLATE "C" <= value[ordinal - 1] COLLATE "C")
    )
$$;
REVOKE ALL ON FUNCTION private.text_array_is_canonical_v1(text[], boolean) FROM PUBLIC;

CREATE TABLE private.candidate_boards (
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source_board_id uuid PRIMARY KEY,
  source_project_ref text NOT NULL CHECK (source_project_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_system_version text NOT NULL CHECK (source_system_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_run_id text NOT NULL CHECK (source_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  trade_date date NOT NULL,
  board_type text NOT NULL CHECK (board_type IN ('DISCOVERY_0800','RERANK_0900','PREMARKET_OFFICIAL','OPENING_MOVERS')),
  stage_scheduled_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  decision_cutoff_at timestamptz NOT NULL,
  frozen_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FROZEN','BLOCKED','DEGRADED','FAILED','SKIPPED')),
  exception_code text CHECK (exception_code IS NULL OR exception_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  parent_board_id uuid REFERENCES private.candidate_boards(source_board_id),
  board_hash text CHECK (board_hash IS NULL OR board_hash ~ '^[a-f0-9]{64}$'),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (parent_board_id IS NULL OR parent_board_id <> source_board_id),
  CHECK (decision_cutoff_at <= stage_scheduled_at),
  CHECK (completed_at IS NULL OR started_at <= completed_at),
  CHECK (frozen_at IS NULL OR completed_at IS NULL OR completed_at <= frozen_at),
  CHECK (
    (status = 'FROZEN' AND completed_at IS NOT NULL AND frozen_at IS NOT NULL AND board_hash IS NOT NULL AND exception_code IS NULL)
    OR (status <> 'FROZEN' AND board_hash IS NULL)
  ),
  CHECK ((stage_scheduled_at AT TIME ZONE 'America/New_York')::date = trade_date),
  CONSTRAINT candidate_boards_canonical_date_range_v1 CHECK (
    private.canonical_date_in_range_v1(trade_date)
    AND private.canonical_timestamp_in_range_v1(stage_scheduled_at)
    AND private.canonical_timestamp_in_range_v1(started_at)
    AND private.canonical_timestamp_in_range_v1(decision_cutoff_at)
    AND (completed_at IS NULL OR private.canonical_timestamp_in_range_v1(completed_at))
    AND (frozen_at IS NULL OR private.canonical_timestamp_in_range_v1(frozen_at))
  ),
  CHECK (date_trunc('milliseconds', stage_scheduled_at) = stage_scheduled_at),
  CHECK (date_trunc('milliseconds', started_at) = started_at),
  CHECK (date_trunc('milliseconds', decision_cutoff_at) = decision_cutoff_at),
  CHECK (
    (board_type = 'DISCOVERY_0800' AND (stage_scheduled_at AT TIME ZONE 'America/New_York')::time = TIME '08:00:00') OR
    (board_type = 'RERANK_0900' AND (stage_scheduled_at AT TIME ZONE 'America/New_York')::time = TIME '09:00:00') OR
    (board_type = 'PREMARKET_OFFICIAL' AND (stage_scheduled_at AT TIME ZONE 'America/New_York')::time = TIME '09:28:00') OR
    (board_type = 'OPENING_MOVERS' AND (stage_scheduled_at AT TIME ZONE 'America/New_York')::time = TIME '09:40:00')
  )
);

CREATE TABLE private.candidate_board_entries (
  source_board_id uuid NOT NULL REFERENCES private.candidate_boards(source_board_id),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  source_rank integer NOT NULL CHECK (source_rank BETWEEN 1 AND 20),
  source_score double precision NOT NULL CHECK (
    source_score NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision)
    AND source_score BETWEEN -1e12 AND 1e12
  ),
  first_seen_board_id uuid REFERENCES private.candidate_boards(source_board_id),
  first_seen_at timestamptz,
  evidence_cutoff_at timestamptz NOT NULL,
  evidence_reference_ids text[] NOT NULL CONSTRAINT candidate_board_entries_evidence_array_shape_v1 CHECK (
    private.text_array_is_canonical_v1(evidence_reference_ids, false)
    AND cardinality(evidence_reference_ids) BETWEEN 1 AND 64
  ),
  reason_codes text[] NOT NULL CONSTRAINT candidate_board_entries_reason_array_shape_v1 CHECK (
    private.text_array_is_canonical_v1(reason_codes, true)
    AND cardinality(reason_codes) BETWEEN 1 AND 32
  ),
  source_reason_summary text NOT NULL CONSTRAINT candidate_board_entries_summary_domain_v1 CHECK (
    private.utf16_code_unit_length_v1(source_reason_summary) BETWEEN 1 AND 1000
    AND source_reason_summary = private.ecmascript_trim_v1(source_reason_summary)
    AND source_reason_summary = normalize(source_reason_summary, NFC)
  ),
  entry_hash text NOT NULL CHECK (entry_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_board_id, symbol),
  UNIQUE (source_board_id, source_rank),
  CHECK ((first_seen_board_id IS NULL) = (first_seen_at IS NULL)),
  CHECK (first_seen_at IS NULL OR first_seen_at <= evidence_cutoff_at),
  CONSTRAINT candidate_board_entries_canonical_date_range_v1 CHECK (
    private.canonical_timestamp_in_range_v1(evidence_cutoff_at)
    AND (first_seen_at IS NULL OR private.canonical_timestamp_in_range_v1(first_seen_at))
  ),
  CHECK (date_trunc('milliseconds', evidence_cutoff_at) = evidence_cutoff_at),
  CHECK (first_seen_at IS NULL OR date_trunc('milliseconds', first_seen_at) = first_seen_at)
);

ALTER TABLE private.candidate_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.candidate_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE private.candidate_board_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.candidate_board_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.candidate_boards, private.candidate_board_entries
  FROM PUBLIC, findesk_candidate_board_publisher, pine_candidate_reader;

CREATE FUNCTION private.canonical_json_string_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT to_json(value)::text $$;
REVOKE ALL ON FUNCTION private.canonical_json_string_v1(text) FROM PUBLIC;

CREATE FUNCTION private.canonical_timestamp_v1(value timestamptz)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, private
AS $fn$
BEGIN
  IF NOT private.canonical_timestamp_in_range_v1(value) THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_CANONICAL_DATE_RANGE' USING ERRCODE = '22008';
  END IF;
  RETURN to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
END
$fn$;
REVOKE ALL ON FUNCTION private.canonical_timestamp_v1(timestamptz) FROM PUBLIC;

CREATE FUNCTION private.canonical_float8_v1(value double precision)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
SET extra_float_digits = 3
AS $fn$
DECLARE
  raw text;
  mantissa text;
  exponent_part integer := 0;
  whole text;
  fraction text;
  untrimmed text;
  digits text;
  leading_count integer;
  exponent integer;
  negative boolean;
BEGIN
  IF value IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) THEN
    RAISE EXCEPTION 'CANONICAL_JSON_NONFINITE_NUMBER' USING ERRCODE = '22003';
  END IF;
  IF value = 0 THEN RETURN '0'; END IF;
  negative := value < 0;
  raw := lower(abs(value)::text);
  IF position('e' IN raw) > 0 THEN
    mantissa := split_part(raw, 'e', 1);
    exponent_part := split_part(raw, 'e', 2)::integer;
  ELSE
    mantissa := raw;
  END IF;
  whole := split_part(mantissa, '.', 1);
  fraction := CASE WHEN position('.' IN mantissa) > 0 THEN split_part(mantissa, '.', 2) ELSE '' END;
  untrimmed := whole || fraction;
  leading_count := length(untrimmed) - length(ltrim(untrimmed, '0'));
  digits := rtrim(substr(untrimmed, leading_count + 1), '0');
  exponent := exponent_part + length(whole) - leading_count - 1;
  RETURN (CASE WHEN negative THEN '-' ELSE '' END)
    || substr(digits, 1, 1)
    || CASE WHEN length(digits) > 1 THEN '.' || substr(digits, 2) ELSE '' END
    || 'e' || exponent::text;
END
$fn$;
REVOKE ALL ON FUNCTION private.canonical_float8_v1(double precision) FROM PUBLIC;

CREATE FUNCTION private.canonical_text_array_v1(value text[])
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT '[' || string_agg(to_json(item)::text, ',' ORDER BY ordinal) || ']'
  FROM unnest(value) WITH ORDINALITY AS items(item, ordinal)
$$;
REVOKE ALL ON FUNCTION private.canonical_text_array_v1(text[]) FROM PUBLIC;

CREATE FUNCTION private.canonical_candidate_entry_json_v1(entry jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, private
SET extra_float_digits = 3
AS $fn$
  SELECT '{'
    || '"entryHash":' || CASE WHEN entry ? 'entryHash' THEN private.canonical_json_string_v1(entry->>'entryHash') ELSE NULL END || ','
    || '"evidenceCutoffAt":' || private.canonical_json_string_v1(entry->>'evidenceCutoffAt') || ','
    || '"evidenceReferenceIds":' || private.canonical_text_array_v1(ARRAY(SELECT jsonb_array_elements_text(entry->'evidenceReferenceIds'))) || ','
    || '"firstSeenAt":' || CASE WHEN entry->'firstSeenAt' = 'null'::jsonb THEN 'null' ELSE private.canonical_json_string_v1(entry->>'firstSeenAt') END || ','
    || '"firstSeenBoardId":' || CASE WHEN entry->'firstSeenBoardId' = 'null'::jsonb THEN 'null' ELSE private.canonical_json_string_v1(entry->>'firstSeenBoardId') END || ','
    || '"reasonCodes":' || private.canonical_text_array_v1(ARRAY(SELECT jsonb_array_elements_text(entry->'reasonCodes'))) || ','
    || '"schemaVersion":1e0,'
    || '"sourceBoardId":' || private.canonical_json_string_v1(entry->>'sourceBoardId') || ','
    || '"sourceRank":' || private.canonical_float8_v1((entry->>'sourceRank')::double precision) || ','
    || '"sourceReasonSummary":' || private.canonical_json_string_v1(entry->>'sourceReasonSummary') || ','
    || '"sourceScore":' || private.canonical_float8_v1((entry->>'sourceScore')::double precision) || ','
    || '"symbol":' || private.canonical_json_string_v1(entry->>'symbol')
    || '}'
$fn$;
REVOKE ALL ON FUNCTION private.canonical_candidate_entry_json_v1(jsonb) FROM PUBLIC;

CREATE FUNCTION private.compute_candidate_board_entry_hash_v1(
  p_source_board_id uuid, p_symbol text, p_source_rank integer, p_source_score double precision,
  p_first_seen_board_id uuid, p_first_seen_at timestamptz, p_evidence_cutoff_at timestamptz,
  p_evidence_reference_ids text[], p_reason_codes text[], p_source_reason_summary text
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private, extensions
SET extra_float_digits = 3
AS $fn$
  SELECT encode(extensions.digest(convert_to(
    '{'
    || '"evidenceCutoffAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_evidence_cutoff_at)) || ','
    || '"evidenceReferenceIds":' || private.canonical_text_array_v1(p_evidence_reference_ids) || ','
    || '"firstSeenAt":' || CASE WHEN p_first_seen_at IS NULL THEN 'null' ELSE private.canonical_json_string_v1(private.canonical_timestamp_v1(p_first_seen_at)) END || ','
    || '"firstSeenBoardId":' || CASE WHEN p_first_seen_board_id IS NULL THEN 'null' ELSE private.canonical_json_string_v1(p_first_seen_board_id::text) END || ','
    || '"reasonCodes":' || private.canonical_text_array_v1(p_reason_codes) || ','
    || '"schemaVersion":1e0,'
    || '"sourceBoardId":' || private.canonical_json_string_v1(p_source_board_id::text) || ','
    || '"sourceRank":' || private.canonical_float8_v1(p_source_rank::double precision) || ','
    || '"sourceReasonSummary":' || private.canonical_json_string_v1(p_source_reason_summary) || ','
    || '"sourceScore":' || private.canonical_float8_v1(p_source_score) || ','
    || '"symbol":' || private.canonical_json_string_v1(p_symbol)
    || '}', 'UTF8'), 'sha256'), 'hex')
$fn$;
REVOKE ALL ON FUNCTION private.compute_candidate_board_entry_hash_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text) FROM PUBLIC;

CREATE FUNCTION private.compute_candidate_board_payload_hash_v1(
  p_source_board_id uuid, p_source_project_ref text, p_source_system_version text, p_source_run_id text,
  p_trade_date date, p_board_type text, p_stage_scheduled_at timestamptz, p_started_at timestamptz,
  p_completed_at timestamptz, p_decision_cutoff_at timestamptz, p_frozen_at timestamptz,
  p_parent_board_id uuid, p_candidate_count integer, p_entries jsonb
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private, extensions
SET extra_float_digits = 3
AS $fn$
  SELECT encode(extensions.digest(convert_to(
    '{'
    || '"boardType":' || private.canonical_json_string_v1(p_board_type) || ','
    || '"candidateCount":' || private.canonical_float8_v1(p_candidate_count::double precision) || ','
    || '"completedAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_completed_at)) || ','
    || '"decisionCutoffAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_decision_cutoff_at)) || ','
    || '"entries":[' || COALESCE((SELECT string_agg(private.canonical_candidate_entry_json_v1(item), ',' ORDER BY ordinal) FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS items(item, ordinal)), '') || '],'
    || '"exceptionCode":null,'
    || '"frozenAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_frozen_at)) || ','
    || '"parentBoardId":' || CASE WHEN p_parent_board_id IS NULL THEN 'null' ELSE private.canonical_json_string_v1(p_parent_board_id::text) END || ','
    || '"schemaVersion":1e0,'
    || '"sourceBoardId":' || private.canonical_json_string_v1(p_source_board_id::text) || ','
    || '"sourceProjectRef":' || private.canonical_json_string_v1(p_source_project_ref) || ','
    || '"sourceRunId":' || private.canonical_json_string_v1(p_source_run_id) || ','
    || '"sourceSystemVersion":' || private.canonical_json_string_v1(p_source_system_version) || ','
    || '"stageScheduledAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_stage_scheduled_at)) || ','
    || '"startedAt":' || private.canonical_json_string_v1(private.canonical_timestamp_v1(p_started_at)) || ','
    || '"status":"FROZEN",'
    || '"tradeDate":' || private.canonical_json_string_v1(private.canonical_date_v1(p_trade_date))
    || '}', 'UTF8'), 'sha256'), 'hex')
$fn$;
REVOKE ALL ON FUNCTION private.compute_candidate_board_payload_hash_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer,jsonb) FROM PUBLIC;

CREATE FUNCTION private.compute_candidate_board_hash_v1(p_source_board_id uuid, p_completed_at timestamptz, p_frozen_at timestamptz)
RETURNS text LANGUAGE sql STABLE PARALLEL RESTRICTED
SET search_path = pg_catalog, private
SET extra_float_digits = 3
AS $fn$
  SELECT private.compute_candidate_board_payload_hash_v1(
    board.source_board_id, board.source_project_ref, board.source_system_version, board.source_run_id,
    board.trade_date, board.board_type, board.stage_scheduled_at, board.started_at, p_completed_at,
    board.decision_cutoff_at, p_frozen_at, board.parent_board_id, count(entries.source_board_id)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'schemaVersion',1,'sourceBoardId',entries.source_board_id::text,'symbol',entries.symbol,
      'sourceRank',entries.source_rank,'sourceScore',entries.source_score,
      'firstSeenBoardId',CASE WHEN entries.first_seen_board_id IS NULL THEN NULL ELSE entries.first_seen_board_id::text END,
      'firstSeenAt',CASE WHEN entries.first_seen_at IS NULL THEN NULL ELSE private.canonical_timestamp_v1(entries.first_seen_at) END,
      'evidenceCutoffAt',private.canonical_timestamp_v1(entries.evidence_cutoff_at),
      'evidenceReferenceIds',to_jsonb(entries.evidence_reference_ids),'reasonCodes',to_jsonb(entries.reason_codes),
      'sourceReasonSummary',entries.source_reason_summary,'entryHash',entries.entry_hash
    ) ORDER BY entries.source_rank, entries.symbol) FILTER (WHERE entries.source_board_id IS NOT NULL), '[]'::jsonb)
  )
  FROM private.candidate_boards board
  LEFT JOIN private.candidate_board_entries entries ON entries.source_board_id = board.source_board_id
  WHERE board.source_board_id = p_source_board_id
  GROUP BY board.source_board_id
$fn$;
REVOKE ALL ON FUNCTION private.compute_candidate_board_hash_v1(uuid,timestamptz,timestamptz) FROM PUBLIC;

CREATE FUNCTION private.guard_candidate_board_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CANDIDATE_BOARD_IMMUTABLE' USING ERRCODE='55000'; END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'FROZEN'
    AND ROW(OLD.schema_version,OLD.source_board_id,OLD.source_project_ref,OLD.source_system_version,OLD.source_run_id,OLD.trade_date,OLD.board_type,OLD.stage_scheduled_at,OLD.started_at,OLD.decision_cutoff_at,OLD.parent_board_id,OLD.created_at)
      IS NOT DISTINCT FROM
        ROW(NEW.schema_version,NEW.source_board_id,NEW.source_project_ref,NEW.source_system_version,NEW.source_run_id,NEW.trade_date,NEW.board_type,NEW.stage_scheduled_at,NEW.started_at,NEW.decision_cutoff_at,NEW.parent_board_id,NEW.created_at)
    AND OLD.board_hash IS NULL AND NEW.board_hash IS NOT NULL AND NEW.completed_at IS NOT NULL AND NEW.frozen_at IS NOT NULL
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'CANDIDATE_BOARD_IMMUTABLE' USING ERRCODE='55000';
END
$fn$;
REVOKE ALL ON FUNCTION private.guard_candidate_board_mutation_v1() FROM PUBLIC;

CREATE FUNCTION private.guard_candidate_board_entry_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
DECLARE board private.candidate_boards%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_IMMUTABLE' USING ERRCODE='55000'; END IF;
  SELECT * INTO board FROM private.candidate_boards WHERE source_board_id=NEW.source_board_id FOR UPDATE;
  IF NOT FOUND OR board.status <> 'DRAFT' THEN RAISE EXCEPTION 'CANDIDATE_BOARD_NOT_DRAFT' USING ERRCODE='55000'; END IF;
  IF NEW.evidence_cutoff_at > board.decision_cutoff_at THEN RAISE EXCEPTION 'CANDIDATE_BOARD_EVIDENCE_AFTER_CUTOFF' USING ERRCODE='22007'; END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.guard_candidate_board_entry_v1() FROM PUBLIC;

CREATE FUNCTION private.reject_candidate_board_truncate_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$ BEGIN RAISE EXCEPTION 'CANDIDATE_BOARD_TRUNCATE_FORBIDDEN' USING ERRCODE='55000'; END $fn$;
REVOKE ALL ON FUNCTION private.reject_candidate_board_truncate_v1() FROM PUBLIC;

DROP TRIGGER IF EXISTS candidate_boards_immutable_v1 ON private.candidate_boards;
CREATE TRIGGER candidate_boards_immutable_v1 BEFORE UPDATE OR DELETE ON private.candidate_boards
FOR EACH ROW EXECUTE FUNCTION private.guard_candidate_board_mutation_v1();
DROP TRIGGER IF EXISTS candidate_board_entries_immutable_v1 ON private.candidate_board_entries;
CREATE TRIGGER candidate_board_entries_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON private.candidate_board_entries
FOR EACH ROW EXECUTE FUNCTION private.guard_candidate_board_entry_v1();
DROP TRIGGER IF EXISTS candidate_boards_no_truncate_v1 ON private.candidate_boards;
CREATE TRIGGER candidate_boards_no_truncate_v1 BEFORE TRUNCATE ON private.candidate_boards
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_candidate_board_truncate_v1();
DROP TRIGGER IF EXISTS candidate_board_entries_no_truncate_v1 ON private.candidate_board_entries;
CREATE TRIGGER candidate_board_entries_no_truncate_v1 BEFORE TRUNCATE ON private.candidate_board_entries
FOR EACH STATEMENT EXECUTE FUNCTION private.reject_candidate_board_truncate_v1();

CREATE FUNCTION app.create_candidate_board_v1(
  p_source_board_id uuid, p_source_project_ref text, p_source_system_version text, p_source_run_id text,
  p_trade_date date, p_board_type text, p_stage_scheduled_at timestamptz, p_started_at timestamptz,
  p_decision_cutoff_at timestamptz, p_parent_board_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
DECLARE parent private.candidate_boards%ROWTYPE;
BEGIN
  IF private.canonical_date_in_range_v1(p_trade_date) IS NOT TRUE
    OR private.canonical_timestamp_in_range_v1(p_stage_scheduled_at) IS NOT TRUE
    OR private.canonical_timestamp_in_range_v1(p_started_at) IS NOT TRUE
    OR private.canonical_timestamp_in_range_v1(p_decision_cutoff_at) IS NOT TRUE
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_CANONICAL_DATE_RANGE' USING ERRCODE='22008'; END IF;
  IF date_trunc('milliseconds',p_stage_scheduled_at) <> p_stage_scheduled_at
    OR (p_stage_scheduled_at AT TIME ZONE 'America/New_York')::date <> p_trade_date
    OR NOT ((p_board_type='DISCOVERY_0800' AND (p_stage_scheduled_at AT TIME ZONE 'America/New_York')::time=TIME '08:00')
      OR (p_board_type='RERANK_0900' AND (p_stage_scheduled_at AT TIME ZONE 'America/New_York')::time=TIME '09:00')
      OR (p_board_type='PREMARKET_OFFICIAL' AND (p_stage_scheduled_at AT TIME ZONE 'America/New_York')::time=TIME '09:28')
      OR (p_board_type='OPENING_MOVERS' AND (p_stage_scheduled_at AT TIME ZONE 'America/New_York')::time=TIME '09:40'))
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_SCHEDULE_MISMATCH' USING ERRCODE='22007'; END IF;
  IF p_decision_cutoff_at > p_stage_scheduled_at THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_TIMING_INVALID' USING ERRCODE='22007';
  END IF;
  IF date_trunc('milliseconds',p_started_at)<>p_started_at OR date_trunc('milliseconds',p_decision_cutoff_at)<>p_decision_cutoff_at THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_TIMING_INVALID' USING ERRCODE='22007';
  END IF;
  IF p_parent_board_id = p_source_board_id THEN RAISE EXCEPTION 'CANDIDATE_BOARD_PARENT_INVALID' USING ERRCODE='23514'; END IF;
  IF p_parent_board_id IS NOT NULL THEN
    SELECT * INTO parent FROM private.candidate_boards WHERE source_board_id=p_parent_board_id;
    IF NOT FOUND OR parent.source_project_ref<>p_source_project_ref OR parent.trade_date<>p_trade_date THEN
      RAISE EXCEPTION 'CANDIDATE_BOARD_PARENT_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  INSERT INTO private.candidate_boards(source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at,parent_board_id)
  VALUES(p_source_board_id,p_source_project_ref,p_source_system_version,p_source_run_id,p_trade_date,p_board_type,p_stage_scheduled_at,p_started_at,p_decision_cutoff_at,p_parent_board_id);
  RETURN p_source_board_id;
END
$fn$;
REVOKE ALL ON FUNCTION app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid) FROM PUBLIC;

CREATE FUNCTION app.append_candidate_board_entry_v1(
  p_source_board_id uuid, p_symbol text, p_source_rank integer, p_source_score double precision,
  p_first_seen_board_id uuid, p_first_seen_at timestamptz, p_evidence_cutoff_at timestamptz,
  p_evidence_reference_ids text[], p_reason_codes text[], p_source_reason_summary text, p_expected_entry_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
DECLARE board private.candidate_boards%ROWTYPE; first_board private.candidate_boards%ROWTYPE; actual_hash text;
BEGIN
  SELECT * INTO board FROM private.candidate_boards WHERE source_board_id=p_source_board_id FOR UPDATE;
  IF NOT FOUND OR board.status<>'DRAFT' THEN RAISE EXCEPTION 'CANDIDATE_BOARD_NOT_DRAFT' USING ERRCODE='55000'; END IF;
  IF private.canonical_timestamp_in_range_v1(p_evidence_cutoff_at) IS NOT TRUE
    OR (p_first_seen_at IS NOT NULL AND private.canonical_timestamp_in_range_v1(p_first_seen_at) IS NOT TRUE)
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_CANONICAL_DATE_RANGE' USING ERRCODE='22008'; END IF;
  IF p_source_rank NOT BETWEEN 1 AND 20 OR (SELECT count(*) FROM private.candidate_board_entries WHERE source_board_id=p_source_board_id)>=20 THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_LIMIT' USING ERRCODE='22003'; END IF;
  IF p_evidence_cutoff_at>board.decision_cutoff_at THEN RAISE EXCEPTION 'CANDIDATE_BOARD_EVIDENCE_AFTER_CUTOFF' USING ERRCODE='22007'; END IF;
  IF (p_first_seen_board_id IS NULL)<>(p_first_seen_at IS NULL) OR (p_first_seen_at IS NOT NULL AND p_first_seen_at>p_evidence_cutoff_at) THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_LINEAGE_INVALID' USING ERRCODE='23514'; END IF;
  IF p_first_seen_board_id IS NOT NULL THEN
    SELECT * INTO first_board FROM private.candidate_boards WHERE source_board_id=p_first_seen_board_id;
    IF NOT FOUND OR first_board.source_project_ref<>board.source_project_ref OR first_board.trade_date<>board.trade_date THEN
      RAISE EXCEPTION 'CANDIDATE_BOARD_LINEAGE_INVALID' USING ERRCODE='23514'; END IF;
  END IF;
  IF p_source_reason_summary IS NULL OR octet_length(p_source_reason_summary)>3000 THEN
    RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID' USING ERRCODE='23514'; END IF;
  -- Reject hostile shapes and sizes before DISTINCT, regex, or array
  -- subscripting. The expensive canonical validator now sees at most 64/32
  -- short ASCII-safe candidates.
  IF p_evidence_reference_ids IS NULL
    OR array_ndims(p_evidence_reference_ids) IS DISTINCT FROM 1
    OR array_lower(p_evidence_reference_ids,1) IS DISTINCT FROM 1
    OR cardinality(p_evidence_reference_ids) NOT BETWEEN 1 AND 64
    OR p_reason_codes IS NULL
    OR array_ndims(p_reason_codes) IS DISTINCT FROM 1
    OR array_lower(p_reason_codes,1) IS DISTINCT FROM 1
    OR cardinality(p_reason_codes) NOT BETWEEN 1 AND 32
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_evidence_reference_ids) item WHERE item IS NULL OR octet_length(item)>128)
    OR EXISTS (SELECT 1 FROM unnest(p_reason_codes) item WHERE item IS NULL OR octet_length(item)>128)
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID' USING ERRCODE='23514'; END IF;
  IF NOT private.text_array_is_canonical_v1(p_evidence_reference_ids,false)
    OR NOT private.text_array_is_canonical_v1(p_reason_codes,true)
    OR p_source_reason_summary<>private.ecmascript_trim_v1(p_source_reason_summary) OR p_source_reason_summary<>normalize(p_source_reason_summary,NFC)
    OR private.utf16_code_unit_length_v1(p_source_reason_summary) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID' USING ERRCODE='23514'; END IF;
  actual_hash:=private.compute_candidate_board_entry_hash_v1(p_source_board_id,p_symbol,p_source_rank,p_source_score,p_first_seen_board_id,p_first_seen_at,p_evidence_cutoff_at,p_evidence_reference_ids,p_reason_codes,p_source_reason_summary);
  IF p_expected_entry_hash IS NULL OR p_expected_entry_hash !~ '^[a-f0-9]{64}$' OR actual_hash IS DISTINCT FROM p_expected_entry_hash THEN RAISE EXCEPTION 'CANDIDATE_BOARD_ENTRY_HASH_MISMATCH' USING ERRCODE='22000'; END IF;
  INSERT INTO private.candidate_board_entries VALUES(p_source_board_id,p_symbol,p_source_rank,p_source_score,p_first_seen_board_id,p_first_seen_at,p_evidence_cutoff_at,p_evidence_reference_ids,p_reason_codes,p_source_reason_summary,actual_hash,clock_timestamp());
  RETURN actual_hash;
END
$fn$;
REVOKE ALL ON FUNCTION app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text) FROM PUBLIC;

CREATE FUNCTION app.freeze_candidate_board_v1(p_source_board_id uuid,p_completed_at timestamptz,p_frozen_at timestamptz,p_expected_board_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private
AS $fn$
DECLARE board private.candidate_boards%ROWTYPE; actual_hash text; actual_count integer; bad_count integer;
BEGIN
  SELECT * INTO board FROM private.candidate_boards WHERE source_board_id=p_source_board_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANDIDATE_BOARD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF private.canonical_timestamp_in_range_v1(p_completed_at) IS NOT TRUE
    OR private.canonical_timestamp_in_range_v1(p_frozen_at) IS NOT TRUE
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_CANONICAL_DATE_RANGE' USING ERRCODE='22008'; END IF;
  IF board.status='FROZEN' THEN
    IF p_expected_board_hash IS NOT NULL AND board.board_hash=p_expected_board_hash
      AND board.completed_at IS NOT DISTINCT FROM p_completed_at
      AND board.frozen_at IS NOT DISTINCT FROM p_frozen_at
    THEN RETURN board.board_hash; END IF;
    RAISE EXCEPTION 'CANDIDATE_BOARD_HASH_CONFLICT' USING ERRCODE='40001';
  END IF;
  IF board.status<>'DRAFT' OR board.board_type NOT IN ('PREMARKET_OFFICIAL','OPENING_MOVERS') THEN RAISE EXCEPTION 'CANDIDATE_BOARD_NOT_ACTIONABLE_DRAFT' USING ERRCODE='55000'; END IF;
  IF p_completed_at<board.started_at OR p_completed_at>p_frozen_at OR board.decision_cutoff_at>p_frozen_at
    OR date_trunc('milliseconds',p_completed_at)<>p_completed_at OR date_trunc('milliseconds',p_frozen_at)<>p_frozen_at
  THEN RAISE EXCEPTION 'CANDIDATE_BOARD_FREEZE_TIMING_INVALID' USING ERRCODE='22007'; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE source_rank<>ordinal OR entry_hash<>private.compute_candidate_board_entry_hash_v1(source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,evidence_reference_ids,reason_codes,source_reason_summary))::integer
  INTO actual_count,bad_count FROM (SELECT entries.*,row_number() OVER(ORDER BY source_rank,symbol)::integer ordinal FROM private.candidate_board_entries entries WHERE source_board_id=p_source_board_id) checked;
  IF actual_count>20 OR bad_count<>0 THEN RAISE EXCEPTION 'CANDIDATE_BOARD_FREEZE_VALIDATION_FAILED' USING ERRCODE='23514'; END IF;
  actual_hash:=private.compute_candidate_board_hash_v1(p_source_board_id,p_completed_at,p_frozen_at);
  IF p_expected_board_hash IS NULL OR p_expected_board_hash !~ '^[a-f0-9]{64}$' OR actual_hash IS DISTINCT FROM p_expected_board_hash THEN RAISE EXCEPTION 'CANDIDATE_BOARD_HASH_MISMATCH' USING ERRCODE='22000'; END IF;
  UPDATE private.candidate_boards SET completed_at=p_completed_at,frozen_at=p_frozen_at,status='FROZEN',exception_code=NULL,board_hash=actual_hash,candidate_count=actual_count WHERE source_board_id=p_source_board_id;
  RETURN actual_hash;
END
$fn$;
REVOKE ALL ON FUNCTION app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text) FROM PUBLIC;

CREATE FUNCTION private.read_pine_candidate_boards_v1()
RETURNS TABLE(
  "schemaVersion" integer,"sourceBoardId" uuid,"sourceProjectRef" text,"sourceSystemVersion" text,"sourceRunId" text,
  "tradeDate" date,"boardType" text,"stageScheduledAt" text,"startedAt" text,"completedAt" text,"decisionCutoffAt" text,
  "frozenAt" text,status text,"exceptionCode" text,"parentBoardId" uuid,"boardHash" text,"candidateCount" integer,entries jsonb
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private
SET extra_float_digits = 3
AS $fn$
  SELECT board.schema_version,board.source_board_id,board.source_project_ref,board.source_system_version,board.source_run_id,
    board.trade_date,board.board_type,private.canonical_timestamp_v1(board.stage_scheduled_at),private.canonical_timestamp_v1(board.started_at),
    private.canonical_timestamp_v1(board.completed_at),private.canonical_timestamp_v1(board.decision_cutoff_at),private.canonical_timestamp_v1(board.frozen_at),
    board.status,board.exception_code,board.parent_board_id,board.board_hash,board.candidate_count,
    COALESCE(jsonb_agg(jsonb_build_object(
      'schemaVersion',1,'sourceBoardId',entry.source_board_id,'symbol',entry.symbol,'sourceRank',entry.source_rank,'sourceScore',entry.source_score,
      'firstSeenBoardId',entry.first_seen_board_id,'firstSeenAt',CASE WHEN entry.first_seen_at IS NULL THEN NULL ELSE private.canonical_timestamp_v1(entry.first_seen_at) END,
      'evidenceCutoffAt',private.canonical_timestamp_v1(entry.evidence_cutoff_at),'evidenceReferenceIds',to_jsonb(entry.evidence_reference_ids),
      'reasonCodes',to_jsonb(entry.reason_codes),'sourceReasonSummary',entry.source_reason_summary,'entryHash',entry.entry_hash
    ) ORDER BY entry.source_rank,entry.symbol) FILTER(WHERE entry.source_board_id IS NOT NULL),'[]'::jsonb)
  FROM private.candidate_boards board LEFT JOIN private.candidate_board_entries entry ON entry.source_board_id=board.source_board_id
  WHERE board.status='FROZEN' AND board.board_type IN ('PREMARKET_OFFICIAL','OPENING_MOVERS')
  GROUP BY board.source_board_id
$fn$;
REVOKE ALL ON FUNCTION private.read_pine_candidate_boards_v1() FROM PUBLIC;

CREATE VIEW app.pine_candidate_boards_v1 WITH (security_invoker=true) AS
SELECT * FROM private.read_pine_candidate_boards_v1();
REVOKE ALL ON app.pine_candidate_boards_v1 FROM PUBLIC;

DO $candidate_acl_reset$
DECLARE
  acl_role text;
BEGIN
  FOREACH acl_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'findesk_candidate_board_publisher', 'pine_candidate_reader'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = acl_role) THEN
      IF acl_role IN ('findesk_candidate_board_publisher', 'pine_candidate_reader') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA private FROM %I', acl_role);
        EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA app FROM %I', acl_role);
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA private, app FROM %I', acl_role);
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA private, app FROM %I', acl_role);
        EXECUTE format('REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA private, app FROM %I', acl_role);
      END IF;
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE private.candidate_boards FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE private.candidate_board_entries FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE app.pine_candidate_boards_v1 FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_date_in_range_v1(date) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_date_v1(date) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_timestamp_in_range_v1(timestamptz) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.ecmascript_trim_v1(text) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.utf16_code_unit_length_v1(text) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.text_array_is_canonical_v1(text[],boolean) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_json_string_v1(text) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_timestamp_v1(timestamptz) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_float8_v1(double precision) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_text_array_v1(text[]) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.canonical_candidate_entry_json_v1(jsonb) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.compute_candidate_board_entry_hash_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.compute_candidate_board_payload_hash_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer,jsonb) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.compute_candidate_board_hash_v1(uuid,timestamptz,timestamptz) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.guard_candidate_board_mutation_v1() FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.guard_candidate_board_entry_v1() FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.reject_candidate_board_truncate_v1() FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION private.read_pine_candidate_boards_v1() FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text) FROM %I', acl_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text) FROM %I', acl_role);
    END IF;
  END LOOP;
END
$candidate_acl_reset$;

GRANT USAGE ON SCHEMA app TO findesk_candidate_board_publisher, pine_candidate_reader;
GRANT USAGE ON SCHEMA private TO pine_candidate_reader;
GRANT EXECUTE ON FUNCTION app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid) TO findesk_candidate_board_publisher;
GRANT EXECUTE ON FUNCTION app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text) TO findesk_candidate_board_publisher;
GRANT EXECUTE ON FUNCTION app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text) TO findesk_candidate_board_publisher;
GRANT EXECUTE ON FUNCTION private.read_pine_candidate_boards_v1() TO pine_candidate_reader;
GRANT SELECT ON app.pine_candidate_boards_v1 TO pine_candidate_reader;

COMMIT;
