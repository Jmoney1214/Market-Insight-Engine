create table operations.api_request_audit (
  audit_id uuid primary key default gen_random_uuid(),
  request_id text not null check (request_id <> ''),
  event_type text not null check (event_type in ('STARTED', 'COMPLETED')),
  started_audit_id uuid references operations.api_request_audit(audit_id),
  method text,
  route text,
  auth_outcome text check (auth_outcome in ('AUTHENTICATED', 'UNAUTHENTICATED', 'REJECTED')),
  credential_id uuid references governance.api_credentials(credential_id),
  principal_id uuid references governance.principals(principal_id),
  principal_kind text check (principal_kind in ('human', 'service', 'agent')),
  effective_scopes text[],
  response_status integer check (response_status between 100 and 599),
  latency_ms bigint check (latency_ms >= 0),
  error_code text,
  error_message text,
  run_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (request_id, event_type),
  constraint api_request_audit_event_shape check (
    (
      event_type = 'STARTED'
      and started_audit_id is null
      and method is not null
      and method = upper(method)
      and route is not null
      and route like '/%'
      and auth_outcome is not null
      and response_status is null
      and latency_ms is null
      and error_code is null
      and error_message is null
      and (
        (
          auth_outcome = 'AUTHENTICATED'
          and credential_id is not null
          and principal_id is not null
          and principal_kind is not null
          and effective_scopes is not null
        )
        or
        (
          auth_outcome in ('UNAUTHENTICATED', 'REJECTED')
          and credential_id is null
          and principal_id is null
          and principal_kind is null
          and effective_scopes is null
        )
      )
    )
    or
    (
      event_type = 'COMPLETED'
      and started_audit_id is not null
      and method is null
      and route is null
      and auth_outcome is null
      and credential_id is null
      and principal_id is null
      and principal_kind is null
      and effective_scopes is null
      and response_status is not null
      and latency_ms is not null
    )
  )
);

create unique index api_request_audit_one_completion
  on operations.api_request_audit(started_audit_id)
  where event_type = 'COMPLETED';
create index api_request_audit_principal_time
  on operations.api_request_audit(principal_id, occurred_at desc);
create index api_request_audit_run_time
  on operations.api_request_audit(run_id, occurred_at desc)
  where run_id is not null;

create table operations.idempotency_records (
  idempotency_record_id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references governance.principals(principal_id),
  operation_id text not null check (operation_id <> ''),
  idempotency_key text not null check (idempotency_key <> '' and length(idempotency_key) <= 255),
  canonical_input_hash text not null check (canonical_input_hash ~ '^[0-9a-f]{64}$'),
  record_kind text not null check (record_kind in ('CLAIMED', 'COMPLETED')),
  supersedes_record_id uuid unique references operations.idempotency_records(idempotency_record_id),
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint idempotency_record_shape check (
    (
      record_kind = 'CLAIMED'
      and supersedes_record_id is null
      and response_status is null
      and response_body is null
    )
    or
    (
      record_kind = 'COMPLETED'
      and supersedes_record_id is not null
      and response_status is not null
      and response_body is not null
    )
  )
);

create unique index idempotency_one_claim
  on operations.idempotency_records(principal_id, operation_id, idempotency_key)
  where record_kind = 'CLAIMED';
create unique index idempotency_one_completion
  on operations.idempotency_records(principal_id, operation_id, idempotency_key)
  where record_kind = 'COMPLETED';
create index idempotency_lookup
  on operations.idempotency_records(principal_id, operation_id, idempotency_key, created_at desc);

create function operations.validate_api_request_audit_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  started operations.api_request_audit%rowtype;
  credential governance.api_credentials%rowtype;
  principal governance.principals%rowtype;
  credential_verdict text;
  principal_verdict text;
  expected_scopes text[];
begin
  if new.event_type = 'STARTED' and new.auth_outcome = 'AUTHENTICATED' then
    select * into credential
    from governance.api_credentials
    where credential_id = new.credential_id;
    if not found or credential.principal_id <> new.principal_id then
      raise exception using errcode = 'P0001', message = 'request_audit_identity_mismatch';
    end if;

    select * into principal
    from governance.principals
    where principal_id = new.principal_id;
    if not found or principal.principal_kind <> new.principal_kind then
      raise exception using errcode = 'P0001', message = 'request_audit_identity_mismatch';
    end if;

    select decision.verdict into credential_verdict
    from governance.credential_decisions decision
    where decision.credential_id = credential.credential_id
    order by decision.revision desc
    limit 1;
    select decision.verdict into principal_verdict
    from governance.principal_decisions decision
    where decision.principal_id = principal.principal_id
    order by decision.revision desc
    limit 1;

    select coalesce(pg_catalog.array_agg(scope order by scope), array[]::text[])
    into expected_scopes
    from (
      select pg_catalog.unnest(credential.scopes) as scope
      intersect
      select pg_catalog.unnest(principal.scopes) as scope
    ) intersection;

    if credential_verdict is distinct from 'ACTIVE'
      or principal_verdict is distinct from 'ACTIVE'
      or (credential.expires_at is not null and credential.expires_at <= pg_catalog.clock_timestamp())
      or new.effective_scopes is distinct from expected_scopes
    then
      raise exception using errcode = 'P0001', message = 'request_audit_identity_mismatch';
    end if;
  end if;

  if new.event_type = 'COMPLETED' then
    select * into started
    from operations.api_request_audit
    where audit_id = new.started_audit_id;
    if not found or started.event_type <> 'STARTED' or started.request_id <> new.request_id then
      raise exception using errcode = 'P0001', message = 'request_audit_start_missing';
    end if;
  end if;
  return new;
end
$function$;

create function operations.validate_idempotency_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  claim operations.idempotency_records%rowtype;
begin
  if new.record_kind = 'COMPLETED' then
    select * into claim
    from operations.idempotency_records
    where idempotency_record_id = new.supersedes_record_id;
    if not found
      or claim.record_kind <> 'CLAIMED'
      or claim.principal_id <> new.principal_id
      or claim.operation_id <> new.operation_id
      or claim.idempotency_key <> new.idempotency_key
      or claim.canonical_input_hash <> new.canonical_input_hash
      or exists(
        select 1
        from operations.idempotency_records completion
        where completion.supersedes_record_id = claim.idempotency_record_id
      )
    then
      raise exception using errcode = 'P0001', message = 'idempotency_chain_violation';
    end if;
  end if;
  return new;
end
$function$;

create trigger api_request_audit_validate_insert
before insert on operations.api_request_audit
for each row execute function operations.validate_api_request_audit_insert();
create trigger idempotency_records_validate_insert
before insert on operations.idempotency_records
for each row execute function operations.validate_idempotency_insert();

do $immutable_triggers$
declare
  table_name text;
begin
  foreach table_name in array array['api_request_audit', 'idempotency_records'] loop
    execute format(
      'create trigger %I before update or delete on operations.%I for each row execute function governance.reject_immutable_mutation()',
      table_name || '_reject_update_delete',
      table_name
    );
    execute format(
      'create trigger %I before truncate on operations.%I for each statement execute function governance.reject_immutable_mutation()',
      table_name || '_reject_truncate',
      table_name
    );
    execute format('alter table operations.%I enable row level security', table_name);
    execute format('alter table operations.%I force row level security', table_name);
  end loop;
end
$immutable_triggers$;

create function operations.record_api_request_start(
  p_request_id text,
  p_method text,
  p_route text,
  p_auth_outcome text,
  p_credential_id uuid,
  p_principal_id uuid,
  p_principal_kind text,
  p_effective_scopes text[],
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing operations.api_request_audit%rowtype;
  new_audit_id uuid;
begin
  perform governance.require_capability(
    array['mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator']::name[]
  );

  if nullif(p_request_id, '') is null
    or p_method is null
    or p_method <> upper(p_method)
    or p_route is null
    or p_route not like '/%'
    or p_auth_outcome not in ('AUTHENTICATED', 'UNAUTHENTICATED', 'REJECTED')
    or (
      p_auth_outcome = 'AUTHENTICATED'
      and (p_credential_id is null or p_principal_id is null or p_principal_kind is null or p_effective_scopes is null)
    )
    or (
      p_auth_outcome in ('UNAUTHENTICATED', 'REJECTED')
      and (p_credential_id is not null or p_principal_id is not null or p_principal_kind is not null or p_effective_scopes is not null)
    )
  then
    raise exception using errcode = '22023', message = 'invalid_request_audit_start';
  end if;

  if p_auth_outcome = 'AUTHENTICATED' then
    perform governance.assert_verified_credential_context(
      p_principal_id,
      p_credential_id,
      p_request_id
    );
  else
    perform governance.assert_request_id_context(p_request_id);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('audit:' || p_request_id, 0));
  select * into existing
  from operations.api_request_audit
  where request_id = p_request_id and event_type = 'STARTED';

  if found then
    if existing.method is distinct from p_method
      or existing.route is distinct from p_route
      or existing.auth_outcome is distinct from p_auth_outcome
      or existing.credential_id is distinct from p_credential_id
      or existing.principal_id is distinct from p_principal_id
      or existing.principal_kind is distinct from p_principal_kind
      or existing.effective_scopes is distinct from p_effective_scopes
      or existing.run_id is distinct from p_run_id
    then
      raise exception using errcode = 'P0001', message = 'request_audit_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'audit_id', existing.audit_id,
      'request_id', existing.request_id,
      'event_type', existing.event_type
    );
  end if;

  insert into operations.api_request_audit(
    request_id, event_type, method, route, auth_outcome,
    credential_id, principal_id, principal_kind, effective_scopes, run_id
  ) values (
    p_request_id, 'STARTED', p_method, p_route, p_auth_outcome,
    p_credential_id, p_principal_id, p_principal_kind, p_effective_scopes, p_run_id
  ) returning audit_id into new_audit_id;

  return pg_catalog.jsonb_build_object(
    'audit_id', new_audit_id,
    'request_id', p_request_id,
    'event_type', 'STARTED'
  );
end
$function$;

create function operations.record_api_request_completion(
  p_request_id text,
  p_response_status integer,
  p_latency_ms bigint,
  p_error_code text,
  p_error_message text,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  started operations.api_request_audit%rowtype;
  existing operations.api_request_audit%rowtype;
  new_audit_id uuid;
begin
  perform governance.require_capability(
    array['mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator']::name[]
  );
  if nullif(p_request_id, '') is null
    or p_response_status not between 100 and 599
    or p_latency_ms < 0
  then
    raise exception using errcode = '22023', message = 'invalid_request_audit_completion';
  end if;
  perform governance.assert_request_id_context(p_request_id);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('audit:' || p_request_id, 0));
  select * into started
  from operations.api_request_audit
  where request_id = p_request_id and event_type = 'STARTED'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'request_audit_start_missing';
  end if;

  select * into existing
  from operations.api_request_audit
  where request_id = p_request_id and event_type = 'COMPLETED';
  if found then
    if existing.response_status is distinct from p_response_status
      or existing.latency_ms is distinct from p_latency_ms
      or existing.error_code is distinct from p_error_code
      or existing.error_message is distinct from p_error_message
      or existing.run_id is distinct from coalesce(p_run_id, started.run_id)
    then
      raise exception using errcode = 'P0001', message = 'request_audit_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'audit_id', existing.audit_id,
      'request_id', existing.request_id,
      'event_type', existing.event_type
    );
  end if;

  insert into operations.api_request_audit(
    request_id, event_type, started_audit_id,
    response_status, latency_ms, error_code, error_message, run_id
  ) values (
    p_request_id, 'COMPLETED', started.audit_id,
    p_response_status, p_latency_ms, p_error_code, p_error_message,
    coalesce(p_run_id, started.run_id)
  ) returning audit_id into new_audit_id;

  return pg_catalog.jsonb_build_object(
    'audit_id', new_audit_id,
    'started_audit_id', started.audit_id,
    'request_id', p_request_id,
    'event_type', 'COMPLETED'
  );
end
$function$;

create function operations.claim_idempotency(
  p_principal_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_canonical_input_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claim operations.idempotency_records%rowtype;
  completion operations.idempotency_records%rowtype;
  principal_verdict text;
begin
  perform governance.require_capability(
    array['mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator']::name[]
  );
  if nullif(p_operation_id, '') is null
    or nullif(p_idempotency_key, '') is null
    or length(p_idempotency_key) > 255
    or p_canonical_input_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_idempotency_input';
  end if;
  perform governance.assert_verified_principal_context(p_principal_id);

  select verdict into principal_verdict
  from governance.principal_decisions
  where principal_id = p_principal_id
  order by revision desc
  limit 1;
  if principal_verdict is distinct from 'ACTIVE' then
    raise exception using errcode = '42501', message = 'active_principal_required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_principal_id::text || chr(31) || p_operation_id || chr(31) || p_idempotency_key,
      0
    )
  );

  select * into claim
  from operations.idempotency_records
  where principal_id = p_principal_id
    and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key
    and record_kind = 'CLAIMED';

  if not found then
    insert into operations.idempotency_records(
      principal_id, operation_id, idempotency_key,
      canonical_input_hash, record_kind
    ) values (
      p_principal_id, p_operation_id, p_idempotency_key,
      p_canonical_input_hash, 'CLAIMED'
    ) returning * into claim;
    return pg_catalog.jsonb_build_object(
      'status', 'CLAIMED',
      'idempotency_record_id', claim.idempotency_record_id
    );
  end if;

  if claim.canonical_input_hash <> p_canonical_input_hash then
    raise exception using errcode = 'P0001', message = 'idempotency_conflict';
  end if;

  select * into completion
  from operations.idempotency_records
  where supersedes_record_id = claim.idempotency_record_id
    and record_kind = 'COMPLETED';
  if found then
    return pg_catalog.jsonb_build_object(
      'status', 'REPLAY',
      'idempotency_record_id', claim.idempotency_record_id,
      'completion_record_id', completion.idempotency_record_id,
      'response_status', completion.response_status,
      'response_body', completion.response_body
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'IN_PROGRESS',
    'idempotency_record_id', claim.idempotency_record_id
  );
end
$function$;

create function operations.terminalize_idempotency(
  p_principal_id uuid,
  p_operation_id text,
  p_idempotency_key text,
  p_canonical_input_hash text,
  p_response_status integer,
  p_response_body jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claim operations.idempotency_records%rowtype;
  completion operations.idempotency_records%rowtype;
begin
  perform governance.require_capability(
    array['mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator']::name[]
  );
  if nullif(p_operation_id, '') is null
    or nullif(p_idempotency_key, '') is null
    or length(p_idempotency_key) > 255
    or p_canonical_input_hash !~ '^[0-9a-f]{64}$'
    or p_response_status not between 100 and 599
    or p_response_body is null
  then
    raise exception using errcode = '22023', message = 'invalid_idempotency_terminal';
  end if;
  perform governance.assert_verified_principal_context(p_principal_id);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_principal_id::text || chr(31) || p_operation_id || chr(31) || p_idempotency_key,
      0
    )
  );

  select * into claim
  from operations.idempotency_records
  where principal_id = p_principal_id
    and operation_id = p_operation_id
    and idempotency_key = p_idempotency_key
    and record_kind = 'CLAIMED'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'idempotency_claim_missing';
  end if;
  if claim.canonical_input_hash <> p_canonical_input_hash then
    raise exception using errcode = 'P0001', message = 'idempotency_conflict';
  end if;

  select * into completion
  from operations.idempotency_records
  where supersedes_record_id = claim.idempotency_record_id
    and record_kind = 'COMPLETED';
  if found then
    if completion.response_status is distinct from p_response_status
      or completion.response_body is distinct from p_response_body
    then
      raise exception using errcode = 'P0001', message = 'idempotency_terminal_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'COMPLETED',
      'idempotency_record_id', claim.idempotency_record_id,
      'completion_record_id', completion.idempotency_record_id,
      'response_status', completion.response_status,
      'response_body', completion.response_body
    );
  end if;

  insert into operations.idempotency_records(
    principal_id, operation_id, idempotency_key, canonical_input_hash,
    record_kind, supersedes_record_id, response_status, response_body
  ) values (
    p_principal_id, p_operation_id, p_idempotency_key, p_canonical_input_hash,
    'COMPLETED', claim.idempotency_record_id, p_response_status, p_response_body
  ) returning * into completion;

  return pg_catalog.jsonb_build_object(
    'status', 'COMPLETED',
    'idempotency_record_id', claim.idempotency_record_id,
    'completion_record_id', completion.idempotency_record_id,
    'response_status', completion.response_status,
    'response_body', completion.response_body
  );
end
$function$;

revoke all on all tables in schema operations from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke all on all sequences in schema operations from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on all functions in schema operations from public, anon, authenticated, service_role, mie_catalog_inspector;

grant usage on schema operations to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function operations.record_api_request_start(text, text, text, text, uuid, uuid, text, text[], uuid)
  to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function operations.record_api_request_completion(text, integer, bigint, text, text, uuid)
  to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function operations.claim_idempotency(uuid, text, text, text)
  to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
grant execute on function operations.terminalize_idempotency(uuid, text, text, text, integer, jsonb)
  to mie_api_read, mie_research_worker, mie_eval_runner, mie_reviewer, mie_migrator;
