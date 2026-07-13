create function governance.require_capability(p_allowed_roles name[])
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  allowed_role name;
begin
  if session_user = 'postgres' then
    return;
  end if;
  foreach allowed_role in array p_allowed_roles loop
    if pg_catalog.pg_has_role(session_user, allowed_role, 'MEMBER') then
      return;
    end if;
  end loop;
  raise exception using errcode = '42501', message = 'capability_required';
end
$function$;

create function governance.constant_time_equal(p_left bytea, p_right bytea)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  difference integer := pg_catalog.octet_length(p_left) # pg_catalog.octet_length(p_right);
  left_byte integer;
  right_byte integer;
begin
  for position in 0..31 loop
    left_byte := case
      when position < pg_catalog.octet_length(p_left) then pg_catalog.get_byte(p_left, position)
      else 0
    end;
    right_byte := case
      when position < pg_catalog.octet_length(p_right) then pg_catalog.get_byte(p_right, position)
      else 0
    end;
    difference := difference | (left_byte # right_byte);
  end loop;
  return difference = 0
    and pg_catalog.octet_length(p_left) = 32
    and pg_catalog.octet_length(p_right) = 32;
end
$function$;

create function governance.assert_verified_principal_context(p_principal_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  raw_context_principal text := nullif(pg_catalog.current_setting('mie.principal_id', true), '');
  context_principal_id uuid;
begin
  if raw_context_principal is null
    or nullif(pg_catalog.current_setting('mie.request_id', true), '') is null
  then
    raise exception using errcode = '42501', message = 'verified_principal_context_required';
  end if;

  begin
    context_principal_id := raw_context_principal::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '42501', message = 'verified_principal_context_required';
  end;

  if context_principal_id is distinct from p_principal_id then
    raise exception using errcode = '42501', message = 'verified_principal_context_required';
  end if;
end
$function$;

create function governance.assert_verified_request_context(
  p_principal_id uuid,
  p_request_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform governance.assert_verified_principal_context(p_principal_id);
  if nullif(p_request_id, '') is null
    or pg_catalog.current_setting('mie.request_id', true) is distinct from p_request_id
  then
    raise exception using errcode = '42501', message = 'verified_request_context_required';
  end if;
end
$function$;

create function governance.assert_request_id_context(p_request_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if nullif(p_request_id, '') is null
    or pg_catalog.current_setting('mie.request_id', true) is distinct from p_request_id
  then
    raise exception using errcode = '42501', message = 'verified_request_context_required';
  end if;
end
$function$;

create function governance.assert_verified_credential_context(
  p_principal_id uuid,
  p_credential_id uuid,
  p_request_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  raw_context_credential text := nullif(pg_catalog.current_setting('mie.credential_id', true), '');
  context_credential_id uuid;
begin
  perform governance.assert_verified_request_context(p_principal_id, p_request_id);
  if raw_context_credential is null then
    raise exception using errcode = '42501', message = 'verified_credential_context_required';
  end if;

  begin
    context_credential_id := raw_context_credential::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '42501', message = 'verified_credential_context_required';
  end;

  if context_credential_id is distinct from p_credential_id then
    raise exception using errcode = '42501', message = 'verified_credential_context_required';
  end if;
end
$function$;

create function governance.credential_digest(p_raw_secret text, p_pepper_version text)
returns bytea
language plpgsql
stable
strict
security invoker
set search_path = ''
as $function$
declare
  pepper text;
begin
  pepper := pg_catalog.current_setting('mie.credential_pepper_' || p_pepper_version, true);
  if pepper is null or pepper = '' then
    raise exception using errcode = 'P0001', message = 'credential_pepper_unavailable';
  end if;
  return extensions.hmac(
    pg_catalog.convert_to(p_raw_secret, 'UTF8'),
    pg_catalog.convert_to(pepper, 'UTF8'),
    'sha256'
  );
end
$function$;

create function governance.session_token_digest(p_raw_token text, p_pepper_version text)
returns bytea
language plpgsql
stable
strict
security invoker
set search_path = ''
as $function$
declare
  pepper text;
begin
  pepper := pg_catalog.current_setting('mie.session_pepper_' || p_pepper_version, true);
  if pepper is null or pepper = '' then
    raise exception using errcode = 'P0001', message = 'session_pepper_unavailable';
  end if;
  return extensions.hmac(
    pg_catalog.convert_to(p_raw_token, 'UTF8'),
    pg_catalog.convert_to(pepper, 'UTF8'),
    'sha256'
  );
end
$function$;

create function governance.assert_active_governance_actor(p_actor_principal_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_kind text;
  actor_scopes text[];
  actor_verdict text;
begin
  select principal.principal_kind, principal.scopes, head.verdict
  into actor_kind, actor_scopes, actor_verdict
  from governance.principals principal
  join lateral (
    select decision.verdict
    from governance.principal_decisions decision
    where decision.principal_id = principal.principal_id
    order by decision.revision desc
    limit 1
  ) head on true
  where principal.principal_id = p_actor_principal_id;

  if not found
    or actor_kind <> 'human'
    or actor_verdict <> 'ACTIVE'
    or not ('governance:credentials' = any(actor_scopes))
  then
    raise exception using errcode = '42501', message = 'governance_actor_required';
  end if;
end
$function$;

create function governance.bootstrap_human_principal(
  p_subject text,
  p_display_name text,
  p_scopes text[],
  p_raw_secret text,
  p_pepper_version text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_principal_id uuid := pg_catalog.gen_random_uuid();
  new_credential_id uuid := pg_catalog.gen_random_uuid();
  prefix text;
  secret_digest bytea;
begin
  perform governance.require_capability(array['mie_migrator']::name[]);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mie.bootstrap_human', 0));

  if nullif(p_subject, '') is null
    or nullif(p_display_name, '') is null
    or p_scopes is null
    or cardinality(p_scopes) = 0
    or nullif(p_request_id, '') is null
    or p_pepper_version !~ '^v[1-9][0-9]*$'
    or p_raw_secret !~ '^mie_[A-Za-z0-9_-]{12,64}\..{32,}$'
    or not ('governance:credentials' = any(p_scopes))
  then
    raise exception using errcode = '22023', message = 'invalid_bootstrap_input';
  end if;

  if exists(
    select 1
    from governance.principals principal
    join lateral (
      select decision.verdict
      from governance.principal_decisions decision
      where decision.principal_id = principal.principal_id
      order by decision.revision desc
      limit 1
    ) principal_head on principal_head.verdict = 'ACTIVE'
    join governance.api_credentials credential on credential.principal_id = principal.principal_id
    join lateral (
      select decision.verdict
      from governance.credential_decisions decision
      where decision.credential_id = credential.credential_id
      order by decision.revision desc
      limit 1
    ) credential_head on credential_head.verdict = 'ACTIVE'
    where principal.principal_kind = 'human'
      and (credential.expires_at is null or credential.expires_at > pg_catalog.clock_timestamp())
  ) then
    raise exception using errcode = 'P0001', message = 'human_bootstrap_exists';
  end if;

  prefix := pg_catalog.split_part(p_raw_secret, '.', 1);
  secret_digest := governance.credential_digest(p_raw_secret, p_pepper_version);

  insert into governance.principals(
    principal_id, principal_kind, subject, display_name, scopes,
    created_by_principal_id, created_request_id
  ) values (
    new_principal_id, 'human', p_subject, p_display_name, p_scopes,
    null, p_request_id
  );

  insert into governance.principal_decisions(
    principal_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    new_principal_id, 1, 'ACTIVE', null,
    new_principal_id, p_request_id, 'initial human bootstrap'
  );

  insert into governance.api_credentials(
    credential_id, credential_prefix, credential_digest, pepper_version,
    principal_id, scopes, expires_at, created_by_principal_id, created_request_id
  ) values (
    new_credential_id, prefix, secret_digest, p_pepper_version,
    new_principal_id, p_scopes, null, new_principal_id, p_request_id
  );

  insert into governance.credential_decisions(
    credential_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    new_credential_id, 1, 'ACTIVE', null,
    new_principal_id, p_request_id, 'initial human bootstrap'
  );

  return pg_catalog.jsonb_build_object(
    'principal_id', new_principal_id,
    'credential_id', new_credential_id,
    'principal_kind', 'human'
  );
end
$function$;

create function governance.verify_api_credential(p_raw_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parsed_prefix text := '__invalid__';
  candidate governance.api_credentials%rowtype;
  stored_digest bytea := extensions.digest('mie-dummy-credential-digest', 'sha256');
  digest_version text := 'v1';
  presented_digest bytea;
  matched boolean;
  principal governance.principals%rowtype;
  credential_verdict text;
  principal_verdict text;
  effective_scopes text[];
begin
  perform governance.require_capability(
    array['mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator']::name[]
  );

  if p_raw_secret is not null
    and p_raw_secret ~ '^mie_[A-Za-z0-9_-]{12,64}\..{32,}$'
  then
    parsed_prefix := pg_catalog.split_part(p_raw_secret, '.', 1);
  end if;

  select * into candidate
  from governance.api_credentials
  where credential_prefix = parsed_prefix;

  if found then
    stored_digest := candidate.credential_digest;
    digest_version := candidate.pepper_version;
  end if;

  presented_digest := governance.credential_digest(coalesce(p_raw_secret, ''), digest_version);
  matched := governance.constant_time_equal(presented_digest, stored_digest);

  if candidate.credential_id is null or not matched then
    return pg_catalog.jsonb_build_object('authenticated', false);
  end if;

  select decision.verdict into credential_verdict
  from governance.credential_decisions decision
  where decision.credential_id = candidate.credential_id
  order by decision.revision desc
  limit 1;

  select * into principal
  from governance.principals
  where principal_id = candidate.principal_id;

  select decision.verdict into principal_verdict
  from governance.principal_decisions decision
  where decision.principal_id = principal.principal_id
  order by decision.revision desc
  limit 1;

  if credential_verdict <> 'ACTIVE'
    or principal_verdict <> 'ACTIVE'
    or (candidate.expires_at is not null and candidate.expires_at <= pg_catalog.clock_timestamp())
  then
    return pg_catalog.jsonb_build_object('authenticated', false);
  end if;

  select coalesce(pg_catalog.array_agg(scope order by scope), array[]::text[])
  into effective_scopes
  from (
    select pg_catalog.unnest(candidate.scopes) as scope
    intersect
    select pg_catalog.unnest(principal.scopes) as scope
  ) intersection;

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'authenticated', true,
    'principal_id', principal.principal_id,
    'credential_id', candidate.credential_id,
    'principal_kind', principal.principal_kind,
    'subject', principal.subject,
    'scopes', to_jsonb(effective_scopes),
    'service_principal_id', principal.service_principal_id,
    'manifest_id', candidate.manifest_id,
    'manifest_version', candidate.manifest_version
  ));
end
$function$;

create function governance.decide_principal(
  p_principal_id uuid,
  p_expected_revision bigint,
  p_verdict text,
  p_actor_principal_id uuid,
  p_request_id text,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  head governance.principal_decisions%rowtype;
  new_decision_id uuid;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  if p_expected_revision < 1
    or p_verdict not in ('ACTIVE', 'SUSPENDED', 'REVOKED')
    or nullif(p_request_id, '') is null
    or nullif(p_rationale, '') is null
  then
    raise exception using errcode = '22023', message = 'invalid_principal_decision';
  end if;
  perform governance.assert_verified_request_context(p_actor_principal_id, p_request_id);
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  perform 1
  from governance.principals
  where principal_id = p_principal_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'principal_not_found';
  end if;

  select * into head
  from governance.principal_decisions
  where principal_id = p_principal_id
  order by revision desc
  limit 1;

  if head.revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'governance_revision_conflict';
  end if;
  if head.verdict = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'principal_decision_terminal';
  end if;

  insert into governance.principal_decisions(
    principal_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    p_principal_id, head.revision + 1, p_verdict, head.decision_id,
    p_actor_principal_id, p_request_id, p_rationale
  ) returning decision_id into new_decision_id;

  return pg_catalog.jsonb_build_object(
    'decision_id', new_decision_id,
    'principal_id', p_principal_id,
    'revision', head.revision + 1,
    'verdict', p_verdict,
    'supersedes_decision_id', head.decision_id
  );
end
$function$;

create function governance.decide_credential(
  p_credential_id uuid,
  p_expected_revision bigint,
  p_verdict text,
  p_actor_principal_id uuid,
  p_request_id text,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  credential_principal_id uuid;
  head governance.credential_decisions%rowtype;
  new_decision_id uuid;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  if p_expected_revision < 1
    or p_verdict not in ('ACTIVE', 'REVOKED')
    or nullif(p_request_id, '') is null
    or nullif(p_rationale, '') is null
  then
    raise exception using errcode = '22023', message = 'invalid_credential_decision';
  end if;
  perform governance.assert_verified_request_context(p_actor_principal_id, p_request_id);
  perform governance.assert_active_governance_actor(p_actor_principal_id);

  -- Browser-session creation locks principal then credential. Use the same
  -- hierarchy here so a create-vs-revoke race serializes without deadlocking.
  select credential.principal_id into credential_principal_id
  from governance.api_credentials credential
  where credential.credential_id = p_credential_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'credential_not_found';
  end if;

  perform 1
  from governance.principals principal
  where principal.principal_id = credential_principal_id
  for update;

  perform 1
  from governance.api_credentials
  where credential_id = p_credential_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'credential_not_found';
  end if;

  select * into head
  from governance.credential_decisions
  where credential_id = p_credential_id
  order by revision desc
  limit 1;

  if head.revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'governance_revision_conflict';
  end if;
  if head.verdict = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'credential_decision_terminal';
  end if;

  insert into governance.credential_decisions(
    credential_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    p_credential_id, head.revision + 1, p_verdict, head.decision_id,
    p_actor_principal_id, p_request_id, p_rationale
  ) returning decision_id into new_decision_id;

  return pg_catalog.jsonb_build_object(
    'decision_id', new_decision_id,
    'credential_id', p_credential_id,
    'revision', head.revision + 1,
    'verdict', p_verdict,
    'supersedes_decision_id', head.decision_id
  );
end
$function$;

create function governance.create_browser_session(
  p_principal_id uuid,
  p_credential_id uuid,
  p_raw_session_token text,
  p_raw_csrf_token text,
  p_request_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  principal governance.principals%rowtype;
  credential governance.api_credentials%rowtype;
  principal_verdict text;
  credential_verdict text;
  new_session_id uuid := pg_catalog.gen_random_uuid();
  new_decision_id uuid;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  if pg_catalog.length(coalesce(p_raw_session_token, '')) < 32
    or pg_catalog.length(coalesce(p_raw_csrf_token, '')) < 32
    or nullif(p_request_id, '') is null
    or (p_expires_at is not null and p_expires_at <= pg_catalog.clock_timestamp())
  then
    raise exception using errcode = '22023', message = 'invalid_browser_session_input';
  end if;
  perform governance.assert_verified_credential_context(
    p_principal_id,
    p_credential_id,
    p_request_id
  );

  select * into principal
  from governance.principals
  where principal_id = p_principal_id
  for update;
  if not found or principal.principal_kind <> 'human' then
    raise exception using errcode = '42501', message = 'human_principal_required';
  end if;

  select * into credential
  from governance.api_credentials
  where credential_id = p_credential_id
  for update;
  if not found or credential.principal_id <> p_principal_id then
    raise exception using errcode = '42501', message = 'credential_principal_mismatch';
  end if;

  select verdict into principal_verdict
  from governance.principal_decisions
  where principal_id = p_principal_id
  order by revision desc
  limit 1;
  select verdict into credential_verdict
  from governance.credential_decisions
  where credential_id = p_credential_id
  order by revision desc
  limit 1;

  if principal_verdict <> 'ACTIVE' then
    raise exception using errcode = '42501', message = 'principal_inactive';
  end if;
  if credential_verdict <> 'ACTIVE'
    or (credential.expires_at is not null and credential.expires_at <= pg_catalog.clock_timestamp())
  then
    raise exception using errcode = '42501', message = 'credential_inactive';
  end if;

  insert into governance.browser_sessions(
    session_id, principal_id, credential_id, session_digest, csrf_digest,
    pepper_version, expires_at, created_request_id
  ) values (
    new_session_id, p_principal_id, p_credential_id,
    governance.session_token_digest(p_raw_session_token, 'v1'),
    governance.session_token_digest(p_raw_csrf_token, 'v1'),
    'v1', p_expires_at, p_request_id
  );

  insert into governance.browser_session_decisions(
    session_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    new_session_id, 1, 'ACTIVE', null,
    p_principal_id, p_request_id, 'browser session created'
  ) returning decision_id into new_decision_id;

  return pg_catalog.jsonb_build_object(
    'session_id', new_session_id,
    'decision_id', new_decision_id,
    'revision', 1,
    'verdict', 'ACTIVE'
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'browser_session_conflict';
end
$function$;

create function governance.verify_browser_session(p_raw_session_token text, p_raw_csrf_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  lookup_digest bytea;
  presented_csrf_digest bytea;
  stored_csrf_digest bytea := extensions.digest('mie-dummy-csrf-digest', 'sha256');
  session governance.browser_sessions%rowtype;
  session_verdict text;
  credential_verdict text;
  principal_verdict text;
  principal governance.principals%rowtype;
  credential governance.api_credentials%rowtype;
  effective_scopes text[];
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  lookup_digest := governance.session_token_digest(coalesce(p_raw_session_token, ''), 'v1');
  presented_csrf_digest := governance.session_token_digest(coalesce(p_raw_csrf_token, ''), 'v1');

  select * into session
  from governance.browser_sessions
  where session_digest = lookup_digest;
  if found then
    stored_csrf_digest := session.csrf_digest;
  end if;

  if session.session_id is null
    or not governance.constant_time_equal(presented_csrf_digest, stored_csrf_digest)
  then
    return pg_catalog.jsonb_build_object('authenticated', false);
  end if;

  select verdict into session_verdict
  from governance.browser_session_decisions
  where session_id = session.session_id
  order by revision desc
  limit 1;
  select verdict into credential_verdict
  from governance.credential_decisions
  where credential_id = session.credential_id
  order by revision desc
  limit 1;
  select * into credential
  from governance.api_credentials
  where credential_id = session.credential_id;
  select * into principal
  from governance.principals
  where principal_id = session.principal_id;
  select verdict into principal_verdict
  from governance.principal_decisions
  where principal_id = session.principal_id
  order by revision desc
  limit 1;

  if session_verdict <> 'ACTIVE'
    or credential_verdict <> 'ACTIVE'
    or principal_verdict <> 'ACTIVE'
    or (session.expires_at is not null and session.expires_at <= pg_catalog.clock_timestamp())
    or (credential.expires_at is not null and credential.expires_at <= pg_catalog.clock_timestamp())
  then
    return pg_catalog.jsonb_build_object('authenticated', false);
  end if;

  select coalesce(pg_catalog.array_agg(scope order by scope), array[]::text[])
  into effective_scopes
  from (
    select pg_catalog.unnest(credential.scopes) as scope
    intersect
    select pg_catalog.unnest(principal.scopes) as scope
  ) intersection;

  return pg_catalog.jsonb_build_object(
    'authenticated', true,
    'session_id', session.session_id,
    'credential_id', session.credential_id,
    'principal_id', principal.principal_id,
    'principal_kind', principal.principal_kind,
    'subject', principal.subject,
    'scopes', to_jsonb(effective_scopes)
  );
end
$function$;

create function governance.revoke_browser_session(
  p_session_id uuid,
  p_expected_revision bigint,
  p_actor_principal_id uuid,
  p_request_id text,
  p_rationale text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  subject governance.browser_sessions%rowtype;
  head governance.browser_session_decisions%rowtype;
  actor_kind text;
  actor_verdict text;
  new_decision_id uuid;
begin
  perform governance.require_capability(array['mie_api_read', 'mie_migrator']::name[]);
  if p_expected_revision < 1 or nullif(p_request_id, '') is null or nullif(p_rationale, '') is null then
    raise exception using errcode = '22023', message = 'invalid_session_decision';
  end if;
  perform governance.assert_verified_request_context(p_actor_principal_id, p_request_id);

  select * into subject
  from governance.browser_sessions
  where session_id = p_session_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'browser_session_not_found';
  end if;

  if p_actor_principal_id = subject.principal_id then
    select principal.principal_kind, decision.verdict
    into actor_kind, actor_verdict
    from governance.principals principal
    join lateral (
      select verdict
      from governance.principal_decisions
      where principal_id = principal.principal_id
      order by revision desc
      limit 1
    ) decision on true
    where principal.principal_id = p_actor_principal_id;
    if actor_kind <> 'human' or actor_verdict <> 'ACTIVE' then
      raise exception using errcode = '42501', message = 'active_session_owner_required';
    end if;
  else
    perform governance.assert_active_governance_actor(p_actor_principal_id);
  end if;

  select * into head
  from governance.browser_session_decisions
  where session_id = p_session_id
  order by revision desc
  limit 1;
  if head.revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'governance_revision_conflict';
  end if;
  if head.verdict = 'REVOKED' then
    raise exception using errcode = 'P0001', message = 'browser_session_decision_terminal';
  end if;

  insert into governance.browser_session_decisions(
    session_id, revision, verdict, supersedes_decision_id,
    actor_principal_id, request_id, rationale
  ) values (
    p_session_id, head.revision + 1, 'REVOKED', head.decision_id,
    p_actor_principal_id, p_request_id, p_rationale
  ) returning decision_id into new_decision_id;

  return pg_catalog.jsonb_build_object(
    'decision_id', new_decision_id,
    'session_id', p_session_id,
    'revision', head.revision + 1,
    'verdict', 'REVOKED',
    'supersedes_decision_id', head.decision_id
  );
end
$function$;

revoke execute on all functions in schema governance from public, anon, authenticated, service_role, mie_catalog_inspector;

grant usage on schema governance to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function governance.bootstrap_human_principal(text, text, text[], text, text, text) to mie_migrator;
grant execute on function governance.verify_api_credential(text) to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function governance.decide_principal(uuid, bigint, text, uuid, text, text) to mie_api_read, mie_migrator;
grant execute on function governance.decide_credential(uuid, bigint, text, uuid, text, text) to mie_api_read, mie_migrator;
grant execute on function governance.create_browser_session(uuid, uuid, text, text, text, timestamptz) to mie_api_read, mie_migrator;
grant execute on function governance.verify_browser_session(text, text) to mie_api_read, mie_migrator;
grant execute on function governance.revoke_browser_session(uuid, bigint, uuid, text, text) to mie_api_read, mie_migrator;
