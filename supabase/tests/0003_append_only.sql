begin;

set local search_path = public, extensions, pg_catalog;
select set_config('mie.credential_pepper_v1', 'test-credential-pepper-v1', true);
select set_config('mie.session_pepper_v1', 'test-session-pepper-v1', true);

select plan(25);

create temporary table task3_append_ctx as
select governance.bootstrap_human_principal(
  'desk-operator-append',
  'Desk Operator',
  array['desk:read', 'governance:credentials'],
  'mie_appendtest01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'v1',
  'append-only-test'
) as bootstrap;

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.credential_id', bootstrap->>'credential_id', true),
       set_config('mie.request_id', 'append-only-test', true)
from task3_append_ctx;

select governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'session-append-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'csrf-append-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'append-only-test',
  null
)
from task3_append_ctx;

select set_config('mie.request_id', 'append-audit', true);

select operations.record_api_request_start(
  'append-audit', 'POST', '/api/test', 'AUTHENTICATED',
  (bootstrap->>'credential_id')::uuid,
  (bootstrap->>'principal_id')::uuid,
  'human', array['desk:read', 'governance:credentials'], null
)
from task3_append_ctx;

select operations.claim_idempotency(
  (bootstrap->>'principal_id')::uuid,
  'append-only-operation',
  'append-only-key',
  repeat('a', 64)
)
from task3_append_ctx;

select throws_ok('update governance.principals set display_name = ''changed'' where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'principal updates fail');
select throws_ok('delete from governance.principals where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'principal deletes fail');
select throws_ok('update governance.principal_decisions set rationale = ''changed'' where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'principal decision updates fail');
select throws_ok('delete from governance.principal_decisions where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'principal decision deletes fail');
select throws_ok('update governance.api_credentials set credential_prefix = ''changed'' where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'credential updates fail');
select throws_ok('update governance.api_credentials set credential_prefix = credential_prefix where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'even no-op credential updates fail');
select throws_ok('delete from governance.api_credentials where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'credential deletes fail');
select throws_ok('update governance.credential_decisions set rationale = ''changed'' where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'credential decision updates fail');
select throws_ok('delete from governance.credential_decisions where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'credential decision deletes fail');
select throws_ok('update governance.browser_sessions set expires_at = now() where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'session updates fail');
select throws_ok('delete from governance.browser_sessions where created_request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'session deletes fail');
select throws_ok('update governance.browser_session_decisions set rationale = ''changed'' where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'session decision updates fail');
select throws_ok('delete from governance.browser_session_decisions where request_id = ''append-only-test''', 'P0001', 'append_only_violation', 'session decision deletes fail');
select throws_ok('update operations.api_request_audit set route = ''/changed'' where request_id = ''append-audit''', 'P0001', 'append_only_violation', 'request audit updates fail');
select throws_ok('delete from operations.api_request_audit where request_id = ''append-audit''', 'P0001', 'append_only_violation', 'request audit deletes fail');
select throws_ok('update operations.idempotency_records set canonical_input_hash = repeat(''b'', 64) where idempotency_key = ''append-only-key''', 'P0001', 'append_only_violation', 'idempotency updates fail');
select throws_ok('delete from operations.idempotency_records where idempotency_key = ''append-only-key''', 'P0001', 'append_only_violation', 'idempotency deletes fail');
select throws_ok('truncate table governance.principals cascade', 'P0001', 'append_only_violation', 'principal truncation fails');
select throws_ok('truncate table governance.principal_decisions cascade', 'P0001', 'append_only_violation', 'principal decision truncation fails');
select throws_ok('truncate table governance.api_credentials cascade', 'P0001', 'append_only_violation', 'credential truncation fails');
select throws_ok('truncate table governance.credential_decisions cascade', 'P0001', 'append_only_violation', 'credential decision truncation fails');
select throws_ok('truncate table governance.browser_sessions cascade', 'P0001', 'append_only_violation', 'session truncation fails');
select throws_ok('truncate table governance.browser_session_decisions cascade', 'P0001', 'append_only_violation', 'session decision truncation fails');
select throws_ok('truncate table operations.api_request_audit cascade', 'P0001', 'append_only_violation', 'request audit truncation fails');
select throws_ok('truncate table operations.idempotency_records cascade', 'P0001', 'append_only_violation', 'idempotency truncation fails');

select * from finish();
rollback;
