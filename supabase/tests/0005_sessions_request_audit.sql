begin;

set local search_path = public, extensions, pg_catalog;
select set_config('mie.credential_pepper_v1', 'test-credential-pepper-v1', true);
select set_config('mie.session_pepper_v1', 'test-session-pepper-v1', true);
create extension if not exists dblink with schema extensions;

select plan(34);

create temporary table task3_session_ctx as
select governance.bootstrap_human_principal(
  'desk-operator-session',
  'Desk Operator',
  array['desk:read', 'governance:credentials', 'research:run'],
  'mie_sessiontest01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'v1',
  'session-audit-test'
) as bootstrap;

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.credential_id', bootstrap->>'credential_id', true),
       set_config('mie.request_id', 'session-audit-test', true)
from task3_session_ctx;

alter table task3_session_ctx add column session jsonb;
alter table task3_session_ctx add column sibling_session jsonb;
update task3_session_ctx
set session = governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'session-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'csrf-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'session-audit-test',
  null
);
select set_config('mie.request_id', 'session-audit-sibling-test', true);
update task3_session_ctx
set sibling_session = governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'session-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'csrf-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'session-audit-sibling-test',
  null
);

insert into governance.api_credentials(
  credential_id, credential_prefix, credential_digest, pepper_version,
  principal_id, scopes, created_by_principal_id, created_request_id
)
select
  '32000000-0000-4000-8000-000000000001', 'mie_sessionnarrow1',
  governance.credential_digest(
    'mie_sessionnarrow1.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd', 'v1'
  ),
  'v1', (bootstrap->>'principal_id')::uuid, array['desk:read'],
  (bootstrap->>'principal_id')::uuid, 'narrow-session-credential'
from task3_session_ctx;

insert into governance.credential_decisions(
  credential_id, revision, verdict, actor_principal_id, request_id, rationale
)
select
  '32000000-0000-4000-8000-000000000001', 1, 'ACTIVE',
  (bootstrap->>'principal_id')::uuid, 'narrow-session-credential', 'created'
from task3_session_ctx;

select set_config('mie.credential_id', '32000000-0000-4000-8000-000000000001', true),
       set_config('mie.request_id', 'narrow-session', true);

create temporary table task3_narrow_session_ctx as
select governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  '32000000-0000-4000-8000-000000000001',
  'session-narrow-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'csrf-narrow-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'narrow-session',
  null
) as session
from task3_session_ctx;

select ok((governance.verify_api_credential('mie_sessiontest01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')->>'authenticated')::boolean, 'correct credential authenticates');
select is(governance.verify_api_credential('mie_sessiontest01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')->>'principal_id', bootstrap->>'principal_id', 'credential resolves its principal') from task3_session_ctx;
select is(governance.verify_api_credential('mie_sessiontest01.wrong-wrong-wrong-wrong-wrong-wrong-wrong'), jsonb_build_object('authenticated', false), 'wrong secret fails generically');
select is(governance.verify_api_credential('mie_unknownpref01.wrong-wrong-wrong-wrong-wrong-wrong-wrong'), jsonb_build_object('authenticated', false), 'unknown prefix fails generically');
select is(governance.verify_api_credential('mie_sessiontest01.wrong-wrong-wrong-wrong-wrong-wrong-wrong'), governance.verify_api_credential('mie_unknownpref01.wrong-wrong-wrong-wrong-wrong-wrong-wrong'), 'wrong and unknown prefixes are indistinguishable');
select is(governance.verify_api_credential('malformed'), jsonb_build_object('authenticated', false), 'malformed credential fails generically after a dummy comparison');
select is(governance.verify_api_credential('malformed'), governance.verify_api_credential('mie_unknownpref01.wrong-wrong-wrong-wrong-wrong-wrong-wrong'), 'malformed and unknown credentials are indistinguishable');
select doesnt_match(governance.verify_api_credential('mie_sessiontest01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')::text, 'digest|prefix|secret', 'credential verifier exposes no secret material');
select ok(governance.constant_time_equal(decode(repeat('aa', 32), 'hex'), decode(repeat('aa', 32), 'hex')), 'constant-time comparator accepts equal digests');
select ok(not governance.constant_time_equal(decode('bb' || repeat('aa', 31), 'hex'), decode(repeat('aa', 32), 'hex')), 'constant-time comparator rejects a first-byte mismatch');
select ok(not governance.constant_time_equal(decode(repeat('aa', 31) || 'bb', 'hex'), decode(repeat('aa', 32), 'hex')), 'constant-time comparator rejects a last-byte mismatch');

select ok((governance.verify_browser_session('session-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')->>'authenticated')::boolean, 'session and CSRF authenticate');
select is(governance.verify_browser_session('session-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-wrong-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd'), jsonb_build_object('authenticated', false), 'wrong CSRF fails generically');
select doesnt_match(governance.verify_browser_session('session-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')::text, 'digest|secret', 'session verifier exposes no token digests');
select is(
  governance.verify_browser_session(
    'session-narrow-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'csrf-narrow-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd'
  )->'scopes',
  to_jsonb(array['desk:read']::text[]),
  'session scopes remain narrowed to credential and principal intersection'
);
select set_config('mie.request_id', 'session-logout', true);
select is((governance.revoke_browser_session((session->>'session_id')::uuid, 1, (bootstrap->>'principal_id')::uuid, 'session-logout', 'logout')->>'revision')::bigint, 2::bigint, 'logout appends revocation') from task3_session_ctx;
select is(governance.verify_browser_session('session-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-verify-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd'), jsonb_build_object('authenticated', false), 'revoked session no longer authenticates');
select ok((governance.verify_browser_session('session-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd')->>'authenticated')::boolean, 'revoking one browser session does not revoke its sibling');
select set_config('mie.request_id', 'session-credential-revoke', true);
select is((governance.decide_credential((bootstrap->>'credential_id')::uuid, 1, 'REVOKED', (bootstrap->>'principal_id')::uuid, 'session-credential-revoke', 'compromised')->>'revision')::bigint, 2::bigint, 'credential revocation appends independently') from task3_session_ctx;
select is(governance.verify_browser_session('session-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'csrf-sibling-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd'), jsonb_build_object('authenticated', false), 'session verification rechecks the credential head');

select set_config('mie.credential_id', '32000000-0000-4000-8000-000000000001', true),
       set_config('mie.request_id', 'audit-wrong-kind', true)
from task3_session_ctx;
select throws_ok(
  format(
    'select operations.record_api_request_start(''audit-wrong-kind'', ''POST'', ''/api/research/runs'', ''AUTHENTICATED'', %L::uuid, %L::uuid, ''service'', array[''desk:read''], null)',
    '32000000-0000-4000-8000-000000000001', bootstrap->>'principal_id'
  ),
  'P0001', 'request_audit_identity_mismatch',
  'authenticated audit rejects a contradictory principal kind'
)
from task3_session_ctx;

select set_config('mie.request_id', 'audit-wrong-scopes', true);
select throws_ok(
  format(
    'select operations.record_api_request_start(''audit-wrong-scopes'', ''POST'', ''/api/research/runs'', ''AUTHENTICATED'', %L::uuid, %L::uuid, ''human'', array[''research:run''], null)',
    '32000000-0000-4000-8000-000000000001', bootstrap->>'principal_id'
  ),
  'P0001', 'request_audit_identity_mismatch',
  'authenticated audit rejects scopes that differ from the credential-principal intersection'
)
from task3_session_ctx;

select set_config('mie.credential_id', bootstrap->>'credential_id', true),
       set_config('mie.request_id', 'audit-credential-spoof', true)
from task3_session_ctx;
select throws_ok(
  format(
    'select operations.record_api_request_start(''audit-credential-spoof'', ''POST'', ''/api/research/runs'', ''AUTHENTICATED'', %L::uuid, %L::uuid, ''human'', array[''desk:read''], null)',
    '32000000-0000-4000-8000-000000000001', bootstrap->>'principal_id'
  ),
  '42501', 'verified_credential_context_required',
  'authenticated audit credential must match the verified credential context'
)
from task3_session_ctx;

select set_config('mie.credential_id', '32000000-0000-4000-8000-000000000001', true),
       set_config('mie.request_id', 'audit-request-1', true)
from task3_session_ctx;

create temporary table task3_audit_ctx as
select operations.record_api_request_start(
  'audit-request-1', 'POST', '/api/research/runs', 'AUTHENTICATED',
  '32000000-0000-4000-8000-000000000001', (bootstrap->>'principal_id')::uuid,
  'human', array['desk:read'], null
) as started
from task3_session_ctx;

select is(started->>'event_type', 'STARTED', 'request audit starts with a STARTED event') from task3_audit_ctx;
select is((select count(*) from operations.api_request_audit where request_id = 'audit-request-1' and event_type = 'STARTED'), 1::bigint, 'one STARTED event is durable');
select is(
  operations.record_api_request_start(
    'audit-request-1', 'POST', '/api/research/runs', 'AUTHENTICATED',
    '32000000-0000-4000-8000-000000000001', (bootstrap->>'principal_id')::uuid,
    'human', array['desk:read'], null
  )->>'audit_id',
  started->>'audit_id',
  'identical duplicate start returns the original event'
)
from task3_audit_ctx cross join task3_session_ctx;

create temporary table task3_completion_ctx as
select operations.record_api_request_completion('audit-request-1', 202, 41, null, null, null) as completed;

select is(completed->>'event_type', 'COMPLETED', 'request audit appends a COMPLETED event') from task3_completion_ctx;
select is((select count(*) from operations.api_request_audit where request_id = 'audit-request-1' and event_type = 'COMPLETED'), 1::bigint, 'one COMPLETED event is durable');
select throws_ok(
  $$select operations.record_api_request_completion('audit-request-1', 500, 42, 'CHANGED', 'changed', null)$$,
  'P0001', 'request_audit_conflict', 'conflicting completion is rejected'
);
select set_config('mie.request_id', 'missing-audit-request', true);
select throws_ok(
  $$select operations.record_api_request_completion('missing-audit-request', 200, 1, null, null, null)$$,
  'P0001', 'request_audit_start_missing', 'completion requires a durable STARTED event'
);
select throws_ok(
  $$insert into operations.api_request_audit(request_id, event_type, method, route, auth_outcome, occurred_at) values ('invalid-auth-shape', 'STARTED', 'GET', '/api/test', 'AUTHENTICATED', now())$$,
  'P0001', 'request_audit_identity_mismatch', 'authenticated STARTED rows require verified identity fields'
);
select ok(
  not exists(
    select 1
    from operations.api_request_audit
    where (event_type = 'STARTED' and (method is null or route is null or auth_outcome is null or response_status is not null or latency_ms is not null))
       or (event_type = 'COMPLETED' and (started_audit_id is null or method is not null or route is not null or auth_outcome is not null or response_status is null or latency_ms is null))
  ),
  'all request audit rows obey strict event-specific nullability'
);

create temporary table task3_session_race_ctx(
  principal_id uuid not null,
  credential_id uuid not null,
  credential_prefix text not null
);
insert into task3_session_race_ctx
select gen_random_uuid(), gen_random_uuid(), 'mie_race_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

do $session_race_setup$
declare
  race task3_session_race_ctx%rowtype;
begin
  select * into race from task3_session_race_ctx;
  perform extensions.dblink_connect('task3_session_setup', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec(
    'task3_session_setup',
    format(
      'insert into governance.principals(principal_id, principal_kind, subject, display_name, scopes, created_request_id) values (%L::uuid, ''human'', %L, ''Session Race Actor'', array[''governance:credentials''], %L)',
      race.principal_id, 'session-race-' || race.principal_id::text, 'session-race-' || race.principal_id::text
    )
  );
  perform extensions.dblink_exec(
    'task3_session_setup',
    format(
      'insert into governance.principal_decisions(principal_id, revision, verdict, actor_principal_id, request_id, rationale) values (%L::uuid, 1, ''ACTIVE'', %L::uuid, %L, ''created'')',
      race.principal_id, race.principal_id, 'session-race-' || race.principal_id::text
    )
  );
  perform extensions.dblink_exec(
    'task3_session_setup',
    format(
      'insert into governance.api_credentials(credential_id, credential_prefix, credential_digest, pepper_version, principal_id, scopes, created_by_principal_id, created_request_id) values (%L::uuid, %L, decode(repeat(''aa'', 32), ''hex''), ''v1'', %L::uuid, array[''governance:credentials''], %L::uuid, %L)',
      race.credential_id, race.credential_prefix, race.principal_id, race.principal_id, 'session-race-' || race.principal_id::text
    )
  );
  perform extensions.dblink_exec(
    'task3_session_setup',
    format(
      'insert into governance.credential_decisions(credential_id, revision, verdict, actor_principal_id, request_id, rationale) values (%L::uuid, 1, ''ACTIVE'', %L::uuid, %L, ''created'')',
      race.credential_id, race.principal_id, 'session-race-' || race.principal_id::text
    )
  );
  perform extensions.dblink_disconnect('task3_session_setup');
  perform extensions.dblink_connect('task3_session_revoke', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_connect('task3_session_create', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec('task3_session_create', $$set mie.session_pepper_v1 = 'test-session-pepper-v1'$$);
  perform extensions.dblink_exec('task3_session_revoke', 'begin');
  perform extensions.dblink_exec('task3_session_revoke', format('set local mie.principal_id = %L', race.principal_id::text));
  perform extensions.dblink_exec('task3_session_revoke', format('set local mie.request_id = %L', 'session-revoke-race-' || race.principal_id::text));
  perform extensions.dblink_exec('task3_session_create', format('set mie.principal_id = %L', race.principal_id::text));
  perform extensions.dblink_exec('task3_session_create', format('set mie.credential_id = %L', race.credential_id::text));
  perform extensions.dblink_exec('task3_session_create', format('set mie.request_id = %L', 'session-create-race-' || race.principal_id::text));
  perform * from extensions.dblink(
    'task3_session_revoke',
    format('select principal_id from governance.principals where principal_id = %L::uuid for update', race.principal_id)
  ) as locked(principal_id uuid);
  perform extensions.dblink_send_query(
    'task3_session_create',
    format(
      'select governance.create_browser_session(%L::uuid, %L::uuid, %L, %L, %L, null)',
      race.principal_id, race.credential_id,
      'session-race-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'csrf-race-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
      'session-create-race-' || race.principal_id::text
    )
  );
end
$session_race_setup$;

select is(extensions.dblink_is_busy('task3_session_create'), 1, 'session creation waits while credential revocation holds the principal-first lock hierarchy');

do $session_race_finish$
declare
  race task3_session_race_ctx%rowtype;
begin
  select * into race from task3_session_race_ctx;
  perform * from extensions.dblink(
    'task3_session_revoke',
    format(
      'select governance.decide_credential(%L::uuid, 1, ''REVOKED'', %L::uuid, %L, ''race revocation'')',
      race.credential_id, race.principal_id, 'session-revoke-race-' || race.principal_id::text
    )
  ) as result(payload jsonb);
  perform extensions.dblink_exec('task3_session_revoke', 'commit');
  while extensions.dblink_is_busy('task3_session_create') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  perform * from extensions.dblink_get_result('task3_session_create', false) as result(payload jsonb);
  perform extensions.dblink_disconnect('task3_session_revoke');
  perform extensions.dblink_disconnect('task3_session_create');
end
$session_race_finish$;

select is(
  (select count(*) from governance.browser_sessions where credential_id = (select credential_id from task3_session_race_ctx)),
  0::bigint,
  'a create-vs-revoke race cannot create a session after credential revocation'
);

select * from finish();
rollback;
