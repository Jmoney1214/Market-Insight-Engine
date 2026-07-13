create table governance.principals (
  principal_id uuid primary key default gen_random_uuid(),
  principal_kind text not null check (principal_kind in ('human', 'service', 'agent')),
  subject text not null unique check (subject <> ''),
  display_name text not null check (display_name <> ''),
  scopes text[] not null check (cardinality(scopes) > 0),
  service_principal_id uuid references governance.principals(principal_id),
  manifest_id text,
  manifest_version text,
  created_by_principal_id uuid references governance.principals(principal_id),
  created_request_id text not null check (created_request_id <> ''),
  created_at timestamptz not null default clock_timestamp(),
  constraint principals_typed_binding check (
    (
      principal_kind = 'agent'
      and service_principal_id is not null
      and nullif(manifest_id, '') is not null
      and nullif(manifest_version, '') is not null
    )
    or
    (
      principal_kind in ('human', 'service')
      and service_principal_id is null
      and manifest_id is null
      and manifest_version is null
    )
  )
);

create table governance.principal_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references governance.principals(principal_id),
  revision bigint not null check (revision > 0),
  verdict text not null check (verdict in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  supersedes_decision_id uuid unique references governance.principal_decisions(decision_id),
  actor_principal_id uuid not null references governance.principals(principal_id),
  request_id text not null check (request_id <> ''),
  rationale text not null check (rationale <> ''),
  decided_at timestamptz not null default clock_timestamp(),
  unique (principal_id, revision)
);

create unique index principal_decisions_one_root
  on governance.principal_decisions(principal_id)
  where supersedes_decision_id is null;
create index principal_decisions_subject_revision
  on governance.principal_decisions(principal_id, revision desc);

create table governance.api_credentials (
  credential_id uuid primary key default gen_random_uuid(),
  credential_prefix text not null unique
    check (credential_prefix ~ '^mie_[A-Za-z0-9_-]{12,64}$'),
  credential_digest bytea not null check (octet_length(credential_digest) = 32),
  digest_algorithm text not null default 'HMAC-SHA-256'
    check (digest_algorithm = 'HMAC-SHA-256'),
  pepper_version text not null check (pepper_version ~ '^v[1-9][0-9]*$'),
  principal_id uuid not null references governance.principals(principal_id),
  scopes text[] not null check (cardinality(scopes) > 0),
  expires_at timestamptz,
  owning_service_principal_id uuid references governance.principals(principal_id),
  manifest_id text,
  manifest_version text,
  created_by_principal_id uuid not null references governance.principals(principal_id),
  created_request_id text not null check (created_request_id <> ''),
  created_at timestamptz not null default clock_timestamp(),
  constraint credentials_typed_binding check (
    (
      owning_service_principal_id is null
      and manifest_id is null
      and manifest_version is null
    )
    or
    (
      owning_service_principal_id is not null
      and nullif(manifest_id, '') is not null
      and nullif(manifest_version, '') is not null
    )
  ),
  constraint credentials_expiry_after_issue check (expires_at is null or expires_at > created_at)
);

create index api_credentials_principal on governance.api_credentials(principal_id);

create table governance.credential_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references governance.api_credentials(credential_id),
  revision bigint not null check (revision > 0),
  verdict text not null check (verdict in ('ACTIVE', 'REVOKED')),
  supersedes_decision_id uuid unique references governance.credential_decisions(decision_id),
  actor_principal_id uuid not null references governance.principals(principal_id),
  request_id text not null check (request_id <> ''),
  rationale text not null check (rationale <> ''),
  decided_at timestamptz not null default clock_timestamp(),
  unique (credential_id, revision)
);

create unique index credential_decisions_one_root
  on governance.credential_decisions(credential_id)
  where supersedes_decision_id is null;
create index credential_decisions_subject_revision
  on governance.credential_decisions(credential_id, revision desc);

create table governance.browser_sessions (
  session_id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references governance.principals(principal_id),
  credential_id uuid not null references governance.api_credentials(credential_id),
  session_digest bytea not null unique check (octet_length(session_digest) = 32),
  csrf_digest bytea not null check (octet_length(csrf_digest) = 32),
  pepper_version text not null default 'v1' check (pepper_version ~ '^v[1-9][0-9]*$'),
  expires_at timestamptz,
  created_request_id text not null check (created_request_id <> ''),
  created_at timestamptz not null default clock_timestamp(),
  constraint sessions_expiry_after_issue check (expires_at is null or expires_at > created_at)
);

create index browser_sessions_principal on governance.browser_sessions(principal_id);
create index browser_sessions_credential on governance.browser_sessions(credential_id);

create function governance.validate_principal_typed_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  owner_kind text;
begin
  if new.principal_kind = 'agent' then
    select principal_kind into owner_kind
    from governance.principals
    where principal_id = new.service_principal_id;

    if owner_kind is distinct from 'service' then
      raise exception using errcode = 'P0001', message = 'agent_service_binding_violation';
    end if;
  end if;
  return new;
end
$function$;

create function governance.validate_credential_typed_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  principal governance.principals%rowtype;
begin
  select * into principal
  from governance.principals
  where principal_id = new.principal_id;

  if not found then
    -- The foreign key will report the missing principal. Keep this trigger
    -- focused on typed ownership and manifest invariants.
    return new;
  end if;

  if principal.principal_kind = 'agent' then
    if new.owning_service_principal_id is distinct from principal.service_principal_id
      or new.manifest_id is distinct from principal.manifest_id
      or new.manifest_version is distinct from principal.manifest_version
    then
      raise exception using errcode = 'P0001', message = 'credential_binding_violation';
    end if;
  elsif new.owning_service_principal_id is not null
    or new.manifest_id is not null
    or new.manifest_version is not null
  then
    raise exception using errcode = 'P0001', message = 'credential_binding_violation';
  end if;

  return new;
end
$function$;

create trigger principals_validate_typed_binding
before insert on governance.principals
for each row execute function governance.validate_principal_typed_binding();

create trigger api_credentials_validate_typed_binding
before insert on governance.api_credentials
for each row execute function governance.validate_credential_typed_binding();

create table governance.browser_session_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references governance.browser_sessions(session_id),
  revision bigint not null check (revision > 0),
  verdict text not null check (verdict in ('ACTIVE', 'REVOKED')),
  supersedes_decision_id uuid unique references governance.browser_session_decisions(decision_id),
  actor_principal_id uuid not null references governance.principals(principal_id),
  request_id text not null check (request_id <> ''),
  rationale text not null check (rationale <> ''),
  decided_at timestamptz not null default clock_timestamp(),
  unique (session_id, revision)
);

create unique index browser_session_decisions_one_root
  on governance.browser_session_decisions(session_id)
  where supersedes_decision_id is null;
create index browser_session_decisions_subject_revision
  on governance.browser_session_decisions(session_id, revision desc);

create function governance.validate_principal_decision_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  predecessor governance.principal_decisions%rowtype;
begin
  if new.revision = 1 then
    if new.supersedes_decision_id is not null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  else
    if new.supersedes_decision_id is null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
    select * into predecessor
    from governance.principal_decisions
    where decision_id = new.supersedes_decision_id;
    if not found
      or predecessor.principal_id <> new.principal_id
      or predecessor.revision + 1 <> new.revision
      or exists(
        select 1 from governance.principal_decisions child
        where child.supersedes_decision_id = predecessor.decision_id
      )
    then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  end if;
  return new;
end
$function$;

create function governance.validate_credential_decision_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  predecessor governance.credential_decisions%rowtype;
begin
  if new.revision = 1 then
    if new.supersedes_decision_id is not null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  else
    if new.supersedes_decision_id is null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
    select * into predecessor
    from governance.credential_decisions
    where decision_id = new.supersedes_decision_id;
    if not found
      or predecessor.credential_id <> new.credential_id
      or predecessor.revision + 1 <> new.revision
      or exists(
        select 1 from governance.credential_decisions child
        where child.supersedes_decision_id = predecessor.decision_id
      )
    then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  end if;
  return new;
end
$function$;

create function governance.validate_browser_session_decision_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  predecessor governance.browser_session_decisions%rowtype;
begin
  if new.revision = 1 then
    if new.supersedes_decision_id is not null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  else
    if new.supersedes_decision_id is null then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
    select * into predecessor
    from governance.browser_session_decisions
    where decision_id = new.supersedes_decision_id;
    if not found
      or predecessor.session_id <> new.session_id
      or predecessor.revision + 1 <> new.revision
      or exists(
        select 1 from governance.browser_session_decisions child
        where child.supersedes_decision_id = predecessor.decision_id
      )
    then
      raise exception using errcode = 'P0001', message = 'decision_chain_violation';
    end if;
  end if;
  return new;
end
$function$;

create trigger principal_decisions_validate_chain
before insert on governance.principal_decisions
for each row execute function governance.validate_principal_decision_chain();
create trigger credential_decisions_validate_chain
before insert on governance.credential_decisions
for each row execute function governance.validate_credential_decision_chain();
create trigger browser_session_decisions_validate_chain
before insert on governance.browser_session_decisions
for each row execute function governance.validate_browser_session_decision_chain();

do $immutable_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'principals',
    'principal_decisions',
    'api_credentials',
    'credential_decisions',
    'browser_sessions',
    'browser_session_decisions'
  ] loop
    execute format(
      'create trigger %I before update or delete on governance.%I for each row execute function governance.reject_immutable_mutation()',
      table_name || '_reject_update_delete',
      table_name
    );
    execute format(
      'create trigger %I before truncate on governance.%I for each statement execute function governance.reject_immutable_mutation()',
      table_name || '_reject_truncate',
      table_name
    );
    execute format('alter table governance.%I enable row level security', table_name);
    execute format('alter table governance.%I force row level security', table_name);
  end loop;
end
$immutable_triggers$;

revoke all on all tables in schema governance from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke all on all sequences in schema governance from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on function governance.validate_principal_decision_chain() from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on function governance.validate_credential_decision_chain() from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on function governance.validate_browser_session_decision_chain() from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on function governance.validate_principal_typed_binding() from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke execute on function governance.validate_credential_typed_binding() from public, anon, authenticated, service_role, mie_catalog_inspector;
