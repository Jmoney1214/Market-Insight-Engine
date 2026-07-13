begin;

set local search_path = public, extensions, pg_catalog;
select set_config('mie.credential_pepper_v1', 'test-credential-pepper-v1', true);
select set_config('mie.session_pepper_v1', 'test-session-pepper-v1', true);
create extension if not exists dblink with schema extensions;

select plan(23);

create temporary table task3_decision_ctx as
select governance.bootstrap_human_principal(
  'desk-operator-decisions',
  'Desk Operator',
  array['desk:read', 'governance:credentials'],
  'mie_decisiontest1.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'v1',
  'decision-chain-test'
) as bootstrap;

select throws_ok(
  $$select governance.bootstrap_human_principal(
      'scope-lockout', 'Scope Lockout', array['desk:read'],
      'mie_scopelockout1.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
      'v1', 'scope-lockout'
    )$$,
  '22023', 'invalid_bootstrap_input',
  'bootstrap cannot create a principal that lacks credential-governance scope'
);

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.credential_id', bootstrap->>'credential_id', true),
       set_config('mie.request_id', 'decision-chain-test', true)
from task3_decision_ctx;

alter table task3_decision_ctx add column session jsonb;
update task3_decision_ctx
set session = governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'session-decision-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'csrf-decision-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'decision-chain-test',
  null
);

insert into governance.principals(
  principal_id, principal_kind, subject, display_name, scopes, created_request_id
) values (
  '21000000-0000-4000-8000-000000000001', 'human', 'decision-test-actor',
  'Decision Test Actor', array['governance:credentials'], 'decision-chain-test-actor'
);

insert into governance.principal_decisions(
  principal_id, revision, verdict, actor_principal_id, request_id, rationale
) values (
  '21000000-0000-4000-8000-000000000001', 1, 'ACTIVE',
  '21000000-0000-4000-8000-000000000001', 'decision-chain-test-actor', 'created'
);

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.request_id', 'principal-impersonation', true)
from task3_decision_ctx;
select throws_ok(
  format(
    'select governance.decide_principal(%L::uuid, 1, ''SUSPENDED'', %L::uuid, ''principal-impersonation'', ''spoofed actor'')',
    bootstrap->>'principal_id', '21000000-0000-4000-8000-000000000001'
  ),
  '42501', 'verified_principal_context_required',
  'a capability caller cannot impersonate another governance actor'
)
from task3_decision_ctx;

select set_config('mie.principal_id', '21000000-0000-4000-8000-000000000001', true),
       set_config('mie.request_id', 'different-request', true);
select throws_ok(
  format(
    'select governance.decide_principal(%L::uuid, 1, ''SUSPENDED'', %L::uuid, ''principal-request-spoof'', ''spoofed request'')',
    bootstrap->>'principal_id', '21000000-0000-4000-8000-000000000001'
  ),
  '42501', 'verified_request_context_required',
  'a governance decision must match the verified request context'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'principal-suspend', true);

select is(
  (governance.decide_principal(
    (bootstrap->>'principal_id')::uuid, 1, 'SUSPENDED',
    '21000000-0000-4000-8000-000000000001', 'principal-suspend', 'maintenance'
  )->>'revision')::bigint,
  2::bigint,
  'principal decision appends revision two'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'stale-principal', true);

select throws_ok(
  format(
    'select governance.decide_principal(%L::uuid, 1, ''REVOKED'', %L::uuid, ''stale-principal'', ''stale'')',
    bootstrap->>'principal_id', '21000000-0000-4000-8000-000000000001'
  ),
  'P0001', 'governance_revision_conflict', 'stale principal decision is rejected'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'principal-revoke', true);

select is(
  (governance.decide_principal(
    (bootstrap->>'principal_id')::uuid, 2, 'REVOKED',
    '21000000-0000-4000-8000-000000000001', 'principal-revoke', 'retired'
  )->>'revision')::bigint,
  3::bigint,
  'principal decision appends revision three'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'credential-revoke', true);

select is(
  (select count(*) from governance.principal_decisions d
   where d.principal_id = (bootstrap->>'principal_id')::uuid
     and not exists(select 1 from governance.principal_decisions child where child.supersedes_decision_id = d.decision_id)),
  1::bigint,
  'principal chain has exactly one head'
)
from task3_decision_ctx;

select is(
  (governance.decide_credential(
    (bootstrap->>'credential_id')::uuid, 1, 'REVOKED',
    '21000000-0000-4000-8000-000000000001', 'credential-revoke', 'compromised'
  )->>'revision')::bigint,
  2::bigint,
  'credential revocation appends revision two'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'stale-credential', true);

select throws_ok(
  format(
    'select governance.decide_credential(%L::uuid, 1, ''REVOKED'', %L::uuid, ''stale-credential'', ''stale'')',
    bootstrap->>'credential_id', '21000000-0000-4000-8000-000000000001'
  ),
  'P0001', 'governance_revision_conflict', 'stale credential decision is rejected'
)
from task3_decision_ctx;

select is((session->>'revision')::bigint, 1::bigint, 'session creation writes revision one')
from task3_decision_ctx;

select set_config('mie.request_id', 'session-revoke', true);

select is(
  (governance.revoke_browser_session(
    (session->>'session_id')::uuid, 1,
    '21000000-0000-4000-8000-000000000001', 'session-revoke', 'logout'
  )->>'revision')::bigint,
  2::bigint,
  'session revocation appends revision two'
)
from task3_decision_ctx;

select set_config('mie.request_id', 'stale-session', true);

select throws_ok(
  format(
    'select governance.revoke_browser_session(%L::uuid, 1, %L::uuid, ''stale-session'', ''stale'')',
    session->>'session_id', '21000000-0000-4000-8000-000000000001'
  ),
  'P0001', 'governance_revision_conflict', 'stale session decision is rejected'
)
from task3_decision_ctx;

insert into governance.principals(
  principal_id, principal_kind, subject, display_name, scopes, created_request_id
) values (
  '20000000-0000-4000-8000-000000000001', 'service', 'decision-test-service',
  'Decision Test Service', array['research:run'], 'decision-chain-test-service'
);

insert into governance.principal_decisions(
  principal_id, revision, verdict, actor_principal_id, request_id, rationale
)
select
  '20000000-0000-4000-8000-000000000001', 1, 'ACTIVE',
  '21000000-0000-4000-8000-000000000001', 'decision-chain-test-service', 'created'
from task3_decision_ctx;

select throws_ok(
  $$insert into governance.principals(
      principal_id, principal_kind, subject, display_name, scopes,
      service_principal_id, manifest_id, manifest_version, created_request_id
    ) values (
      '22000000-0000-4000-8000-000000000001', 'agent', 'wrong-owner-agent',
      'Wrong Owner Agent', array['tool:market-data'],
      '21000000-0000-4000-8000-000000000001', 'market-research-lead', 'v1',
      'wrong-owner-agent'
    )$$,
  'P0001', 'agent_service_binding_violation',
  'an agent principal must be owned by a service principal'
);

insert into governance.principals(
  principal_id, principal_kind, subject, display_name, scopes,
  service_principal_id, manifest_id, manifest_version, created_request_id
) values (
  '22000000-0000-4000-8000-000000000002', 'agent', 'valid-owner-agent',
  'Valid Owner Agent', array['tool:market-data'],
  '20000000-0000-4000-8000-000000000001', 'market-research-lead', 'v1',
  'valid-owner-agent'
);

select throws_ok(
  $$insert into governance.api_credentials(
      credential_id, credential_prefix, credential_digest, pepper_version,
      principal_id, scopes, owning_service_principal_id, manifest_id, manifest_version,
      created_by_principal_id, created_request_id
    ) values (
      '22000000-0000-4000-8000-000000000003', 'mie_wrongBinding12',
      decode(repeat('bb', 32), 'hex'), 'v1',
      '22000000-0000-4000-8000-000000000002', array['tool:market-data'],
      '21000000-0000-4000-8000-000000000001', 'other-manifest', 'v2',
      '21000000-0000-4000-8000-000000000001', 'wrong-agent-credential'
    )$$,
  'P0001', 'credential_binding_violation',
  'an agent credential must match its owning service and exact manifest version'
);

select throws_ok(
  $$insert into governance.api_credentials(
      credential_id, credential_prefix, credential_digest, pepper_version,
      principal_id, scopes, created_by_principal_id, created_request_id
    ) values (
      '22000000-0000-4000-8000-000000000004', 'mie_missingBind12',
      decode(repeat('cc', 32), 'hex'), 'v1',
      '22000000-0000-4000-8000-000000000002', array['tool:market-data'],
      '21000000-0000-4000-8000-000000000001', 'missing-agent-binding'
    )$$,
  'P0001', 'credential_binding_violation',
  'an agent credential cannot omit its service and manifest binding'
);

select throws_ok(
  $$insert into governance.api_credentials(
      credential_id, credential_prefix, credential_digest, pepper_version,
      principal_id, scopes, owning_service_principal_id, manifest_id, manifest_version,
      created_by_principal_id, created_request_id
    ) values (
      '22000000-0000-4000-8000-000000000005', 'mie_humanBound123',
      decode(repeat('dd', 32), 'hex'), 'v1',
      '21000000-0000-4000-8000-000000000001', array['governance:credentials'],
      '20000000-0000-4000-8000-000000000001', 'not-an-agent', 'v1',
      '21000000-0000-4000-8000-000000000001', 'bound-human-credential'
    )$$,
  'P0001', 'credential_binding_violation',
  'a non-agent credential cannot claim an agent manifest binding'
);

select throws_ok(
  format(
    'insert into governance.principal_decisions(principal_id, revision, verdict, supersedes_decision_id, actor_principal_id, request_id, rationale) values (%L::uuid, 2, ''REVOKED'', %L::uuid, %L::uuid, ''wrong-subject'', ''invalid predecessor'')',
    '20000000-0000-4000-8000-000000000001',
    (select decision_id::text from governance.principal_decisions where request_id = 'principal-suspend'),
    '21000000-0000-4000-8000-000000000001'
  ),
  'P0001', 'decision_chain_violation', 'a predecessor from another subject is rejected'
)
from task3_decision_ctx;

select is(
  (select count(*) from pg_catalog.pg_constraint c
   join pg_catalog.pg_class t on t.oid = c.conrelid
   join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'governance'
     and t.relname in ('principal_decisions', 'credential_decisions', 'browser_session_decisions')
     and c.contype = 'u'
     and pg_catalog.pg_get_constraintdef(c.oid) like 'UNIQUE (supersedes_decision_id)%'),
  3::bigint,
  'all typed chains enforce one successor per predecessor'
);

select is(
  (select count(*) from pg_catalog.pg_constraint c
   join pg_catalog.pg_class t on t.oid = c.conrelid
   join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'governance'
     and t.relname in ('principal_decisions', 'credential_decisions', 'browser_session_decisions')
     and c.contype = 'u'
     and pg_catalog.pg_get_constraintdef(c.oid) like 'UNIQUE (%revision)%'),
  3::bigint,
  'all typed chains enforce one revision per subject'
);

select is(
  (select count(*)
   from pg_catalog.pg_indexes
   where schemaname = 'governance'
     and tablename in ('principal_decisions', 'credential_decisions', 'browser_session_decisions')
     and indexdef like '%UNIQUE%WHERE (supersedes_decision_id IS NULL)%'),
  3::bigint,
  'all typed chains enforce exactly one root per subject'
);

create temporary table task3_race_ctx(race_principal_id uuid not null);
insert into task3_race_ctx values (gen_random_uuid());

do $race_setup$
declare
  race_id uuid;
begin
  select race_principal_id into race_id from task3_race_ctx;
  perform extensions.dblink_connect('task3_race_setup', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec(
    'task3_race_setup',
    format(
      'insert into governance.principals(principal_id, principal_kind, subject, display_name, scopes, created_request_id) values (%L::uuid, ''human'', %L, ''Race Actor'', array[''governance:credentials''], %L)',
      race_id, 'race-' || race_id::text, 'race-' || race_id::text
    )
  );
  perform extensions.dblink_exec(
    'task3_race_setup',
    format(
      'insert into governance.principal_decisions(principal_id, revision, verdict, actor_principal_id, request_id, rationale) values (%L::uuid, 1, ''ACTIVE'', %L::uuid, %L, ''created'')',
      race_id, race_id, 'race-' || race_id::text
    )
  );
  perform extensions.dblink_disconnect('task3_race_setup');
  perform extensions.dblink_connect('task3_race_one', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_connect('task3_race_two', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec('task3_race_one', 'begin');
  perform extensions.dblink_exec('task3_race_one', format('set local mie.principal_id = %L', race_id::text));
  perform extensions.dblink_exec('task3_race_one', format('set local mie.request_id = %L', 'race-one-' || race_id::text));
  perform extensions.dblink_exec('task3_race_two', format('set mie.principal_id = %L', race_id::text));
  perform extensions.dblink_exec('task3_race_two', format('set mie.request_id = %L', 'race-two-' || race_id::text));
  perform * from extensions.dblink(
    'task3_race_one',
    format('select principal_id from governance.principals where principal_id = %L::uuid for update', race_id)
  ) as locked(principal_id uuid);
  perform extensions.dblink_send_query(
    'task3_race_two',
    format(
      'select governance.decide_principal(%L::uuid, 1, ''SUSPENDED'', %L::uuid, %L, ''racing successor'')',
      race_id, race_id, 'race-two-' || race_id::text
    )
  );
end
$race_setup$;

select is(extensions.dblink_is_busy('task3_race_two'), 1, 'second connection waits on the locked decision subject');

do $race_finish$
declare
  race_id uuid;
begin
  select race_principal_id into race_id from task3_race_ctx;
  perform * from extensions.dblink(
    'task3_race_one',
    format(
      'select governance.decide_principal(%L::uuid, 1, ''SUSPENDED'', %L::uuid, %L, ''winning successor'')',
      race_id, race_id, 'race-one-' || race_id::text
    )
  ) as result(payload jsonb);
  perform extensions.dblink_exec('task3_race_one', 'commit');
  while extensions.dblink_is_busy('task3_race_two') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  perform * from extensions.dblink_get_result('task3_race_two', false) as result(payload jsonb);
  perform extensions.dblink_disconnect('task3_race_one');
  perform extensions.dblink_disconnect('task3_race_two');
end
$race_finish$;

select is(
  (select count(*) from governance.principal_decisions where principal_id = (select race_principal_id from task3_race_ctx) and revision = 2),
  1::bigint,
  'two-connection race commits only one revision-two successor'
);

select is(
  (select count(*) from governance.principal_decisions d
   where d.principal_id = (select race_principal_id from task3_race_ctx)
     and not exists(select 1 from governance.principal_decisions child where child.supersedes_decision_id = d.decision_id)),
  1::bigint,
  'two-connection race leaves exactly one decision head'
);

select * from finish();
rollback;
