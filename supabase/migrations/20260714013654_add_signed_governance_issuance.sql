create table governance.decision_attestations (
  decision_id uuid primary key,
  decision_type text not null check (decision_type in ('PRINCIPAL', 'CREDENTIAL')),
  subject_id uuid not null,
  human_principal_id uuid not null references governance.principals(principal_id),
  credential_id uuid not null references governance.api_credentials(credential_id),
  request_id text not null check (request_id <> ''),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  canonical_payload_sha256 text not null check (canonical_payload_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_key_id text not null check (attestation_key_id <> ''),
  attestation_hmac_sha256 text not null check (attestation_hmac_sha256 ~ '^[0-9a-f]{64}$'),
  attested_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create index decision_attestations_subject
  on governance.decision_attestations(decision_type, subject_id, attested_at desc);
create index decision_attestations_request
  on governance.decision_attestations(request_id);

alter table governance.decision_attestations enable row level security;
alter table governance.decision_attestations force row level security;

create trigger decision_attestations_reject_update_delete
before update or delete on governance.decision_attestations
for each row execute function governance.reject_immutable_mutation();
create trigger decision_attestations_reject_truncate
before truncate on governance.decision_attestations
for each statement execute function governance.reject_immutable_mutation();

create function governance.validate_signed_decision(
  p_signed_decision jsonb,
  p_payload_sha256 text,
  p_decision_type text,
  p_verdict text,
  p_decision_id uuid,
  p_subject_id uuid,
  p_subject_sha256 text,
  p_revision bigint,
  p_supersedes_decision_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  top_keys text[];
  subject_keys text[];
  subject jsonb;
  decided_at timestamptz;
  expected_subject_type text;
  expected_subject_id_key text;
  expected_subject_sha_key text;
begin
  if jsonb_typeof(p_signed_decision) <> 'object'
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_subject_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;

  select array_agg(key order by key) into top_keys
  from pg_catalog.jsonb_object_keys(p_signed_decision) as keys(key);
  if top_keys is distinct from array[
    'attestationHmacSha256', 'attestationKeyId', 'credentialId', 'decidedAt',
    'decisionId', 'decisionType', 'humanPrincipalId', 'nonce', 'rationale',
    'requestId', 'revision', 'subject', 'supersedesDecisionId', 'verdict'
  ]::text[] then
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;

  if p_decision_type = 'PRINCIPAL' then
    expected_subject_type := 'PRINCIPAL';
    expected_subject_id_key := 'principalId';
    expected_subject_sha_key := 'principalSha256';
  elsif p_decision_type = 'CREDENTIAL' then
    expected_subject_type := 'CREDENTIAL';
    expected_subject_id_key := 'credentialId';
    expected_subject_sha_key := 'credentialSha256';
  else
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;

  subject := p_signed_decision->'subject';
  if jsonb_typeof(subject) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;
  select array_agg(key order by key) into subject_keys
  from pg_catalog.jsonb_object_keys(subject) as keys(key);
  if subject_keys is distinct from array[
    expected_subject_id_key, expected_subject_sha_key, 'subjectType'
  ]::text[] then
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;

  begin
    decided_at := (p_signed_decision->>'decidedAt')::timestamptz;
  exception
    when invalid_datetime_format then
      raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end;

  if p_revision < 1
    or p_signed_decision->>'decisionType' is distinct from p_decision_type
    or p_signed_decision->>'verdict' is distinct from p_verdict
    or p_signed_decision->>'decisionId' is distinct from p_decision_id::text
    or (p_signed_decision->>'revision')::bigint is distinct from p_revision
    or p_signed_decision->>'humanPrincipalId' is distinct from p_actor_principal_id::text
    or p_signed_decision->>'credentialId' is distinct from p_step_up_credential_id::text
    or p_signed_decision->>'requestId' is distinct from p_request_id
    or nullif(p_signed_decision->>'rationale', '') is null
    or nullif(p_signed_decision->>'nonce', '') is null
    or nullif(p_signed_decision->>'attestationKeyId', '') is null
    or coalesce(p_signed_decision->>'attestationHmacSha256', '') !~ '^[0-9a-f]{64}$'
    or subject->>'subjectType' is distinct from expected_subject_type
    or subject->>expected_subject_id_key is distinct from p_subject_id::text
    or subject->>expected_subject_sha_key is distinct from p_subject_sha256
    or decided_at < pg_catalog.clock_timestamp() - interval '5 minutes'
    or decided_at > pg_catalog.clock_timestamp() + interval '1 minute'
    or (
      p_supersedes_decision_id is null
      and p_signed_decision->'supersedesDecisionId' is distinct from 'null'::jsonb
    )
    or (
      p_supersedes_decision_id is not null
      and p_signed_decision->>'supersedesDecisionId'
        is distinct from p_supersedes_decision_id::text
    )
  then
    raise exception using errcode = '22023', message = 'invalid_decision_attestation';
  end if;
end
$function$;

create function governance.record_decision_attestation(
  p_signed_decision jsonb,
  p_payload_sha256 text,
  p_decision_type text,
  p_decision_id uuid,
  p_subject_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  insert into governance.decision_attestations(
    decision_id,
    decision_type,
    subject_id,
    human_principal_id,
    credential_id,
    request_id,
    canonical_payload,
    canonical_payload_sha256,
    attestation_key_id,
    attestation_hmac_sha256,
    attested_at
  ) values (
    p_decision_id,
    p_decision_type,
    p_subject_id,
    p_actor_principal_id,
    p_step_up_credential_id,
    p_request_id,
    p_signed_decision,
    p_payload_sha256,
    p_signed_decision->>'attestationKeyId',
    p_signed_decision->>'attestationHmacSha256',
    (p_signed_decision->>'decidedAt')::timestamptz
  );
end
$function$;

create function governance.issue_principal_signed(
  p_principal_id uuid,
  p_principal_kind text,
  p_subject text,
  p_display_name text,
  p_scopes text[],
  p_service_principal_id uuid,
  p_manifest_id text,
  p_manifest_version text,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text,
  p_signed_decision jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_decision_id uuid := (p_signed_decision->>'decisionId')::uuid;
  subject_sha256 text := p_signed_decision->'subject'->>'principalSha256';
  decided_at timestamptz := (p_signed_decision->>'decidedAt')::timestamptz;
  owner_kind text;
  owner_verdict text;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id,
    p_step_up_credential_id,
    p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  if p_principal_kind not in ('human', 'service', 'agent')
    or nullif(p_subject, '') is null
    or nullif(p_display_name, '') is null
    or p_scopes is null
    or cardinality(p_scopes) = 0
    or p_scopes is distinct from array(
      select distinct scope from pg_catalog.unnest(p_scopes) scope order by scope
    )
    or (
      p_principal_kind = 'agent'
      and (
        p_service_principal_id is null
        or nullif(p_manifest_id, '') is null
        or nullif(p_manifest_version, '') is null
      )
    )
    or (
      p_principal_kind in ('human', 'service')
      and (
        p_service_principal_id is not null
        or p_manifest_id is not null
        or p_manifest_version is not null
      )
    )
  then
    raise exception using errcode = '22023', message = 'invalid_principal_issuance';
  end if;

  if p_principal_kind = 'agent' then
    select principal.principal_kind, head.verdict
    into owner_kind, owner_verdict
    from governance.principals principal
    join lateral (
      select verdict
      from governance.principal_decisions
      where principal_id = principal.principal_id
      order by revision desc
      limit 1
    ) head on true
    where principal.principal_id = p_service_principal_id
    for update of principal;
    if owner_kind is distinct from 'service' or owner_verdict is distinct from 'ACTIVE' then
      raise exception using errcode = '42501', message = 'active_agent_owner_required';
    end if;
  end if;

  perform governance.validate_signed_decision(
    p_signed_decision, p_payload_sha256, 'PRINCIPAL', 'ACTIVATE',
    new_decision_id, p_principal_id, subject_sha256, 1, null,
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );

  insert into governance.principals(
    principal_id, principal_kind, subject, display_name, scopes,
    service_principal_id, manifest_id, manifest_version,
    created_by_principal_id, created_request_id
  ) values (
    p_principal_id, p_principal_kind, p_subject, p_display_name, p_scopes,
    p_service_principal_id, p_manifest_id, p_manifest_version,
    p_actor_principal_id, p_request_id
  );

  insert into governance.principal_decisions(
    decision_id, principal_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale, decided_at
  ) values (
    new_decision_id, p_principal_id, 1, 'ACTIVE', null,
    p_actor_principal_id, p_request_id,
    p_signed_decision->>'rationale', decided_at
  );

  perform governance.record_decision_attestation(
    p_signed_decision, p_payload_sha256, 'PRINCIPAL', new_decision_id,
    p_principal_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  return p_signed_decision;
end
$function$;

create function governance.issue_api_credential_signed(
  p_credential_id uuid,
  p_principal_id uuid,
  p_raw_secret text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text,
  p_signed_decision jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  principal governance.principals%rowtype;
  principal_verdict text;
  new_decision_id uuid := (p_signed_decision->>'decisionId')::uuid;
  subject_sha256 text := p_signed_decision->'subject'->>'credentialSha256';
  decided_at timestamptz := (p_signed_decision->>'decidedAt')::timestamptz;
  prefix text := pg_catalog.split_part(p_raw_secret, '.', 1);
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id,
    p_step_up_credential_id,
    p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  if p_raw_secret !~ '^mie_[A-Za-z0-9_-]{12,64}\..{32,}$'
    or p_scopes is null
    or cardinality(p_scopes) = 0
    or p_scopes is distinct from array(
      select distinct scope from pg_catalog.unnest(p_scopes) scope order by scope
    )
    or (p_expires_at is not null and p_expires_at <= pg_catalog.clock_timestamp())
  then
    raise exception using errcode = '22023', message = 'invalid_credential_issuance';
  end if;

  select * into principal
  from governance.principals
  where principal_id = p_principal_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'principal_not_found';
  end if;
  select verdict into principal_verdict
  from governance.principal_decisions
  where principal_id = p_principal_id
  order by revision desc
  limit 1;
  if principal_verdict is distinct from 'ACTIVE' then
    raise exception using errcode = '42501', message = 'principal_inactive';
  end if;
  if exists(
    select 1
    from pg_catalog.unnest(p_scopes) requested(scope)
    where not (requested.scope = any(principal.scopes))
  ) then
    raise exception using errcode = '42501', message = 'credential_scope_escalation';
  end if;

  perform governance.validate_signed_decision(
    p_signed_decision, p_payload_sha256, 'CREDENTIAL', 'ACTIVATE',
    new_decision_id, p_credential_id, subject_sha256, 1, null,
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );

  insert into governance.api_credentials(
    credential_id, credential_prefix, credential_digest, pepper_version,
    principal_id, scopes, expires_at,
    owning_service_principal_id, manifest_id, manifest_version,
    created_by_principal_id, created_request_id
  ) values (
    p_credential_id, prefix, governance.credential_digest(p_raw_secret, 'v1'), 'v1',
    p_principal_id, p_scopes, p_expires_at,
    principal.service_principal_id, principal.manifest_id, principal.manifest_version,
    p_actor_principal_id, p_request_id
  );

  insert into governance.credential_decisions(
    decision_id, credential_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale, decided_at
  ) values (
    new_decision_id, p_credential_id, 1, 'ACTIVE', null,
    p_actor_principal_id, p_request_id,
    p_signed_decision->>'rationale', decided_at
  );

  perform governance.record_decision_attestation(
    p_signed_decision, p_payload_sha256, 'CREDENTIAL', new_decision_id,
    p_credential_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  return p_signed_decision;
end
$function$;

create function governance.append_principal_revocation_signed(
  p_principal_id uuid,
  p_expected_revision bigint,
  p_expected_decision_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text,
  p_signed_decision jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  head governance.principal_decisions%rowtype;
  new_decision_id uuid := (p_signed_decision->>'decisionId')::uuid;
  subject_sha256 text := p_signed_decision->'subject'->>'principalSha256';
  decided_at timestamptz := (p_signed_decision->>'decidedAt')::timestamptz;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  perform 1 from governance.principals where principal_id = p_principal_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'principal_not_found';
  end if;
  select * into head
  from governance.principal_decisions
  where principal_id = p_principal_id
  order by revision desc
  limit 1;
  if head.revision is distinct from p_expected_revision
    or head.decision_id is distinct from p_expected_decision_id
  then
    raise exception using errcode = 'P0001', message = 'governance_revision_conflict';
  end if;
  if head.verdict = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'principal_decision_terminal';
  end if;

  perform governance.validate_signed_decision(
    p_signed_decision, p_payload_sha256, 'PRINCIPAL', 'REVOKE',
    new_decision_id, p_principal_id, subject_sha256, head.revision + 1,
    head.decision_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  insert into governance.principal_decisions(
    decision_id, principal_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale, decided_at
  ) values (
    new_decision_id, p_principal_id, head.revision + 1, 'REVOKED', head.decision_id,
    p_actor_principal_id, p_request_id,
    p_signed_decision->>'rationale', decided_at
  );
  perform governance.record_decision_attestation(
    p_signed_decision, p_payload_sha256, 'PRINCIPAL', new_decision_id,
    p_principal_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  return p_signed_decision;
end
$function$;

create function governance.append_credential_revocation_signed(
  p_credential_id uuid,
  p_expected_revision bigint,
  p_expected_decision_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text,
  p_signed_decision jsonb,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  credential_principal_id uuid;
  head governance.credential_decisions%rowtype;
  new_decision_id uuid := (p_signed_decision->>'decisionId')::uuid;
  subject_sha256 text := p_signed_decision->'subject'->>'credentialSha256';
  decided_at timestamptz := (p_signed_decision->>'decidedAt')::timestamptz;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  select principal_id into credential_principal_id
  from governance.api_credentials
  where credential_id = p_credential_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'credential_not_found';
  end if;
  perform 1 from governance.principals
  where principal_id = credential_principal_id for update;
  perform 1 from governance.api_credentials
  where credential_id = p_credential_id for update;
  select * into head
  from governance.credential_decisions
  where credential_id = p_credential_id
  order by revision desc
  limit 1;
  if head.revision is distinct from p_expected_revision
    or head.decision_id is distinct from p_expected_decision_id
  then
    raise exception using errcode = 'P0001', message = 'governance_revision_conflict';
  end if;
  if head.verdict = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'credential_decision_terminal';
  end if;

  perform governance.validate_signed_decision(
    p_signed_decision, p_payload_sha256, 'CREDENTIAL', 'REVOKE',
    new_decision_id, p_credential_id, subject_sha256, head.revision + 1,
    head.decision_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  insert into governance.credential_decisions(
    decision_id, credential_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale, decided_at
  ) values (
    new_decision_id, p_credential_id, head.revision + 1, 'REVOKED', head.decision_id,
    p_actor_principal_id, p_request_id,
    p_signed_decision->>'rationale', decided_at
  );
  perform governance.record_decision_attestation(
    p_signed_decision, p_payload_sha256, 'CREDENTIAL', new_decision_id,
    p_credential_id, p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  return p_signed_decision;
end
$function$;

create function governance.read_principal_governance_subject(
  p_principal_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);
  select pg_catalog.jsonb_build_object(
    'principal_id', principal.principal_id,
    'principal_kind', principal.principal_kind,
    'subject', principal.subject,
    'display_name', principal.display_name,
    'scopes', to_jsonb(principal.scopes),
    'service_principal_id', principal.service_principal_id,
    'manifest_id', principal.manifest_id,
    'manifest_version', principal.manifest_version,
    'head_decision_id', head.decision_id,
    'head_revision', head.revision,
    'head_verdict', head.verdict
  ) into payload
  from governance.principals principal
  join lateral (
    select decision_id, revision, verdict
    from governance.principal_decisions
    where principal_id = principal.principal_id
    order by revision desc
    limit 1
  ) head on true
  where principal.principal_id = p_principal_id;
  return payload;
end
$function$;

create function governance.read_credential_governance_subject(
  p_credential_id uuid,
  p_actor_principal_id uuid,
  p_step_up_credential_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_actor_principal_id, p_step_up_credential_id, p_request_id
  );
  perform governance.assert_active_governance_actor(p_actor_principal_id);
  select pg_catalog.jsonb_build_object(
    'credential_id', credential.credential_id,
    'credential_prefix', credential.credential_prefix,
    'principal_id', credential.principal_id,
    'scopes', to_jsonb(credential.scopes),
    'expires_at', credential.expires_at,
    'owning_service_principal_id', credential.owning_service_principal_id,
    'manifest_id', credential.manifest_id,
    'manifest_version', credential.manifest_version,
    'pepper_version', credential.pepper_version,
    'head_decision_id', head.decision_id,
    'head_revision', head.revision,
    'head_verdict', head.verdict
  ) into payload
  from governance.api_credentials credential
  join lateral (
    select decision_id, revision, verdict
    from governance.credential_decisions
    where credential_id = credential.credential_id
    order by revision desc
    limit 1
  ) head on true
  where credential.credential_id = p_credential_id;
  return payload;
end
$function$;

create function governance.rotate_browser_session(
  p_session_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_raw_session_token text,
  p_raw_csrf_token text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_session governance.browser_sessions%rowtype;
  old_head governance.browser_session_decisions%rowtype;
  principal_verdict text;
  credential_verdict text;
  new_session_id uuid := pg_catalog.gen_random_uuid();
  new_decision_id uuid := pg_catalog.gen_random_uuid();
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  perform governance.assert_verified_credential_context(
    p_principal_id, p_credential_id, p_request_id
  );
  perform governance.assert_active_governance_actor(p_principal_id);
  if pg_catalog.length(coalesce(p_raw_session_token, '')) < 32
    or pg_catalog.length(coalesce(p_raw_csrf_token, '')) < 32
  then
    raise exception using errcode = '22023', message = 'invalid_browser_session_input';
  end if;

  perform 1 from governance.principals
  where principal_id = p_principal_id for update;
  perform 1 from governance.api_credentials
  where credential_id = p_credential_id and principal_id = p_principal_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'credential_principal_mismatch';
  end if;
  select * into old_session
  from governance.browser_sessions
  where session_id = p_session_id
  for update;
  if not found
    or old_session.principal_id <> p_principal_id
    or old_session.credential_id <> p_credential_id
  then
    raise exception using errcode = '42501', message = 'browser_session_mismatch';
  end if;
  select * into old_head
  from governance.browser_session_decisions
  where session_id = p_session_id
  order by revision desc
  limit 1;
  select verdict into principal_verdict
  from governance.principal_decisions
  where principal_id = p_principal_id order by revision desc limit 1;
  select verdict into credential_verdict
  from governance.credential_decisions
  where credential_id = p_credential_id order by revision desc limit 1;
  if old_head.verdict is distinct from 'ACTIVE'
    or principal_verdict is distinct from 'ACTIVE'
    or credential_verdict is distinct from 'ACTIVE'
    or (old_session.expires_at is not null
      and old_session.expires_at <= pg_catalog.clock_timestamp())
    or exists(
      select 1
      from governance.api_credentials credential
      where credential.credential_id = p_credential_id
        and credential.expires_at is not null
        and credential.expires_at <= pg_catalog.clock_timestamp()
    )
  then
    raise exception using errcode = '42501', message = 'browser_session_inactive';
  end if;

  insert into governance.browser_sessions(
    session_id, principal_id, credential_id, session_digest, csrf_digest,
    pepper_version, expires_at, created_request_id
  ) values (
    new_session_id, p_principal_id, p_credential_id,
    governance.session_token_digest(p_raw_session_token, 'v1'),
    governance.session_token_digest(p_raw_csrf_token, 'v1'),
    'v1', old_session.expires_at, p_request_id
  );
  insert into governance.browser_session_decisions(
    decision_id, session_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    new_decision_id, new_session_id, 1, 'ACTIVE', null,
    p_principal_id, p_request_id, 'permanent-key step-up rotation'
  );
  insert into governance.browser_session_decisions(
    session_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    p_session_id, old_head.revision + 1, 'REVOKED', old_head.decision_id,
    p_principal_id, p_request_id, 'replaced by permanent-key step-up rotation'
  );
  return pg_catalog.jsonb_build_object(
    'session_id', new_session_id,
    'replaced_session_id', p_session_id,
    'revision', 1,
    'verdict', 'ACTIVE'
  );
end
$function$;

revoke all on governance.decision_attestations
  from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on all functions in schema governance
  from public, anon, authenticated, service_role, mie_catalog_inspector;

revoke execute on function governance.decide_principal(uuid, bigint, text, uuid, text, text)
  from mie_api_read;
revoke execute on function governance.decide_credential(uuid, bigint, text, uuid, text, text)
  from mie_api_read;

grant execute on function governance.issue_principal_signed(
  uuid, text, text, text, text[], uuid, text, text, uuid, uuid, text, jsonb, text
) to mie_api_read, mie_migrator;
grant execute on function governance.issue_api_credential_signed(
  uuid, uuid, text, text[], timestamptz, uuid, uuid, text, jsonb, text
) to mie_api_read, mie_migrator;
grant execute on function governance.append_principal_revocation_signed(
  uuid, bigint, uuid, uuid, uuid, text, jsonb, text
) to mie_api_read, mie_migrator;
grant execute on function governance.append_credential_revocation_signed(
  uuid, bigint, uuid, uuid, uuid, text, jsonb, text
) to mie_api_read, mie_migrator;
grant execute on function governance.read_principal_governance_subject(
  uuid, uuid, uuid, text
) to mie_api_read, mie_migrator;
grant execute on function governance.read_credential_governance_subject(
  uuid, uuid, uuid, text
) to mie_api_read, mie_migrator;
grant execute on function governance.rotate_browser_session(
  uuid, uuid, uuid, text, text, text
) to mie_api_read, mie_migrator;
