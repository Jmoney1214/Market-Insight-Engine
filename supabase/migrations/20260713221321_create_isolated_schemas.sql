create extension if not exists pgcrypto with schema extensions;

create schema governance authorization postgres;
create schema operations authorization postgres;

do $roles$
declare
  role_name text;
  role_state record;
begin
  foreach role_name in array array[
    'mie_api_read',
    'mie_research_worker',
    'mie_eval_runner',
    'mie_reviewer',
    'mie_migrator',
    'mie_catalog_inspector'
  ] loop
    if not exists(select 1 from pg_catalog.pg_roles where rolname = role_name) then
      execute format(
        'create role %I nologin noinherit nocreatedb nocreaterole',
        role_name
      );
    end if;

    select
      rolcanlogin,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolreplication,
      rolbypassrls,
      rolinherit
    into strict role_state
    from pg_catalog.pg_roles
    where rolname = role_name;

    if role_state.rolcanlogin
      or role_state.rolsuper
      or role_state.rolcreatedb
      or role_state.rolcreaterole
      or role_state.rolreplication
      or role_state.rolbypassrls
      or role_state.rolinherit
    then
      raise exception using
        errcode = 'P0001',
        message = format('unsafe_preexisting_capability_role:%s', role_name);
    end if;

    if exists(
      select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = role_name
    ) then
      raise exception using
        errcode = 'P0001',
        message = format('unsafe_preexisting_capability_membership:%s', role_name);
    end if;
  end loop;
end
$roles$;

revoke all on schema governance from public, anon, authenticated, service_role, mie_catalog_inspector;
revoke all on schema operations from public, anon, authenticated, service_role, mie_catalog_inspector;

do $catalog_connect$
begin
  execute format('grant connect on database %I to mie_catalog_inspector', current_database());
end
$catalog_connect$;

grant usage on schema pg_catalog, information_schema to mie_catalog_inspector;

-- Per-schema defaults can add privileges but cannot remove PostgreSQL's global
-- default PUBLIC execute grant. Remove that global default before any private
-- schema functions are created; every callable function is granted explicitly.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role, mie_catalog_inspector;

alter default privileges for role postgres in schema governance
  revoke all privileges on tables from public, anon, authenticated, service_role, mie_catalog_inspector;
alter default privileges for role postgres in schema operations
  revoke all privileges on tables from public, anon, authenticated, service_role, mie_catalog_inspector;
alter default privileges for role postgres in schema governance
  revoke all privileges on sequences from public, anon, authenticated, service_role, mie_catalog_inspector;
alter default privileges for role postgres in schema operations
  revoke all privileges on sequences from public, anon, authenticated, service_role, mie_catalog_inspector;
alter default privileges for role postgres in schema governance
  revoke execute on functions from public, anon, authenticated, service_role, mie_catalog_inspector;
alter default privileges for role postgres in schema operations
  revoke execute on functions from public, anon, authenticated, service_role, mie_catalog_inspector;

create function governance.reject_immutable_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = 'P0001', message = 'append_only_violation';
end
$function$;

revoke execute on function governance.reject_immutable_mutation() from public, anon, authenticated, service_role, mie_catalog_inspector;
