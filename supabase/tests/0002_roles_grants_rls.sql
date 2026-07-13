begin;

set local search_path = public, extensions, pg_catalog;

select plan(29);

select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_api_read'), 'mie_api_read exists');
select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_research_worker'), 'mie_research_worker exists');
select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_eval_runner'), 'mie_eval_runner exists');
select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_reviewer'), 'mie_reviewer exists');
select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_migrator'), 'mie_migrator exists');
select ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'mie_catalog_inspector'), 'mie_catalog_inspector exists');

select ok(
  not exists(
    select 1
    from pg_catalog.pg_roles
    where rolname in ('mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator', 'mie_catalog_inspector')
      and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)
  ),
  'all application roles are NOLOGIN, non-superuser, non-bypass, and non-administrative'
);

select ok(
  not pg_catalog.pg_has_role('mie_research_worker', 'mie_reviewer', 'MEMBER')
  and not pg_catalog.pg_has_role('mie_reviewer', 'mie_research_worker', 'MEMBER'),
  'worker and reviewer capabilities do not inherit one another'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    where member_role.rolname like 'mie\_%' escape '\'
      and granted_role.rolname like 'mie\_%' escape '\'
  ),
  'application capabilities have zero cross-membership'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    where member_role.rolname like 'mie\_%' escape '\'
      and granted_role.rolname in ('pg_read_all_data', 'pg_write_all_data')
  ),
  'application roles do not inherit broad built-in data roles'
);

select ok(
  not exists(
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) as denied(role_name)
    cross join (values ('governance'), ('operations')) as app_schema(schema_name)
    where pg_catalog.has_schema_privilege(denied.role_name, app_schema.schema_name, 'USAGE')
  ),
  'Supabase Data API roles have no private-schema usage'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as denied(role_name)
    where n.nspname in ('governance', 'operations')
      and pg_catalog.has_function_privilege(denied.role_name, p.oid, 'EXECUTE')
  ),
  'Supabase Data API roles cannot execute private functions, including through PUBLIC'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as denied(role_name)
    where n.nspname in ('governance', 'operations')
      and c.relkind in ('r', 'p', 'v', 'm')
      and pg_catalog.has_table_privilege(denied.role_name, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ),
  'Supabase Data API roles have no private table privileges'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as denied(role_name)
    where n.nspname in ('governance', 'operations')
      and c.relkind = 'S'
      and pg_catalog.has_sequence_privilege(denied.role_name, c.oid, 'USAGE,SELECT,UPDATE')
  ),
  'Supabase Data API roles have no private sequence privileges'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('governance', 'operations')
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  'RLS is enabled on every private application table'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('governance', 'operations')
      and c.relkind in ('r', 'p')
      and not c.relforcerowsecurity
  ),
  'RLS is forced on every private application table'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('mie_api_read'), ('mie_research_worker'), ('mie_eval_runner'), ('mie_reviewer')) as runtime(role_name)
    where n.nspname in ('governance', 'operations')
      and c.relkind in ('r', 'p')
      and pg_catalog.has_table_privilege(runtime.role_name, c.oid, 'UPDATE,DELETE')
  ),
  'runtime capabilities have no direct update or delete privilege'
);

select ok(
  pg_catalog.has_database_privilege('mie_catalog_inspector', current_database(), 'CONNECT'),
  'catalog inspector can connect'
);

select ok(
  not pg_catalog.has_schema_privilege('mie_catalog_inspector', 'governance', 'USAGE')
  and not pg_catalog.has_schema_privilege('mie_catalog_inspector', 'operations', 'USAGE'),
  'catalog inspector has no private-schema usage'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('governance', 'operations')
      and c.relkind in ('r', 'p', 'v', 'm')
      and pg_catalog.has_table_privilege('mie_catalog_inspector', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ),
  'catalog inspector cannot read or mutate application rows'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('governance', 'operations')
      and pg_catalog.has_function_privilege('mie_catalog_inspector', p.oid, 'EXECUTE')
  ),
  'catalog inspector cannot execute application functions'
);

select ok(
  pg_catalog.has_table_privilege('mie_catalog_inspector', 'pg_catalog.pg_class', 'SELECT')
  and pg_catalog.has_table_privilege('mie_catalog_inspector', 'pg_catalog.pg_namespace', 'SELECT'),
  'catalog inspector can read catalog metadata'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('governance', 'operations')
      and p.prosecdef
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ),
  'every SECURITY DEFINER function fixes an empty search_path'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    where n.nspname in ('governance', 'operations')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any private function'
);

select ok(
  not exists(
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname in ('governance', 'operations')
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <> p.proowner
      and coalesce(grantee.rolname, 'PUBLIC') not in (
        'mie_api_read', 'mie_research_worker', 'mie_eval_runner', 'mie_reviewer', 'mie_migrator'
      )
  ),
  'private function execute ACLs contain only exact capability roles'
);

select ok(
  not exists(
    with owner_role(oid) as (
      select oid from pg_catalog.pg_roles where rolname = 'postgres'
    ),
    target_defaults(objtype) as (
      values ('f'::"char"), ('r'::"char"), ('S'::"char")
    ),
    effective_global_acl as (
      select acl.grantee
      from target_defaults target
      cross join owner_role owner
      left join pg_catalog.pg_default_acl defaults
        on defaults.defaclnamespace = 0
       and defaults.defaclrole = owner.oid
       and defaults.defaclobjtype = target.objtype
      cross join lateral pg_catalog.aclexplode(
        coalesce(defaults.defaclacl, pg_catalog.acldefault(target.objtype, owner.oid))
      ) acl
    ),
    additive_schema_acl as (
      select acl.grantee
      from pg_catalog.pg_namespace n
      cross join owner_role owner
      join pg_catalog.pg_default_acl defaults
        on defaults.defaclnamespace = n.oid
       and defaults.defaclrole = owner.oid
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
      where n.nspname in ('governance', 'operations')
    )
    select 1
    from (
      select grantee from effective_global_acl
      union all
      select grantee from additive_schema_acl
    ) acl
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where acl.grantee = 0
       or grantee.rolname in ('anon', 'authenticated', 'service_role', 'mie_catalog_inspector')
  ),
  'private-schema default privileges deny PUBLIC, Data API roles, and catalog inspector'
);

select ok(
  pg_catalog.has_function_privilege(
    'mie_migrator',
    'governance.bootstrap_human_principal(text,text,text[],text,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'migrator may execute the one-time bootstrap'
);

select ok(
  not pg_catalog.has_function_privilege(
    'mie_research_worker',
    'governance.bootstrap_human_principal(text,text,text[],text,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'research worker cannot bootstrap credentials'
);

select ok(
  not pg_catalog.has_function_privilege(
    'mie_reviewer',
    'governance.bootstrap_human_principal(text,text,text[],text,text,text)'::regprocedure,
    'EXECUTE'
  ),
  'reviewer cannot bootstrap credentials'
);

select * from finish();
rollback;
