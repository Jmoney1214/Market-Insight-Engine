begin;

set local search_path = public, extensions, pg_catalog;
select set_config('mie.credential_pepper_v1', 'test-credential-pepper-v1', true);
create extension if not exists dblink with schema extensions;

select plan(21);

create temporary table task3_idempotency_ctx as
select governance.bootstrap_human_principal(
  'desk-operator-idempotency',
  'Desk Operator',
  array['desk:read', 'governance:credentials'],
  'mie_idempotency1.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
  'v1',
  'idempotency-test'
) as bootstrap;

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.request_id', 'idempotency-test', true)
from task3_idempotency_ctx;

insert into governance.principals(
  principal_id, principal_kind, subject, display_name, scopes, created_request_id
) values (
  '30000000-0000-4000-8000-000000000001', 'service', 'idempotency-test-service',
  'Idempotency Test Service', array['research:run'], 'idempotency-test-service'
);

insert into governance.principal_decisions(
  principal_id, revision, verdict, actor_principal_id, request_id, rationale
)
select
  '30000000-0000-4000-8000-000000000001', 1, 'ACTIVE',
  (bootstrap->>'principal_id')::uuid, 'idempotency-test-service', 'created'
from task3_idempotency_ctx;

create temporary table task3_claim_ctx as
select operations.claim_idempotency(
  (bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64)
) as claim
from task3_idempotency_ctx;

select is(claim->>'status', 'CLAIMED', 'first request claims the logical operation') from task3_claim_ctx;
select is(operations.claim_idempotency((bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64))->>'status', 'IN_PROGRESS', 'duplicate in-progress request does not replay') from task3_idempotency_ctx;
select ok(not (operations.claim_idempotency((bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64)) ? 'response_body'), 'in-progress response leaks no terminal body') from task3_idempotency_ctx;
select throws_ok(
  format('select operations.claim_idempotency(%L::uuid, ''research.run.create'', ''same-key'', %L)', bootstrap->>'principal_id', repeat('b', 64)),
  'P0001', 'idempotency_conflict', 'same key with a different canonical hash conflicts'
)
from task3_idempotency_ctx;

create temporary table task3_terminal_ctx as
select operations.terminalize_idempotency(
  (bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64),
  201, jsonb_build_object('run_id', 'run-one')
) as terminal
from task3_idempotency_ctx;

select is(terminal->>'status', 'COMPLETED', 'terminalization completes the logical request') from task3_terminal_ctx;
select is(operations.terminalize_idempotency((bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64), 201, jsonb_build_object('run_id', 'run-one'))->>'status', 'COMPLETED', 'identical terminalization is idempotent') from task3_idempotency_ctx;
select throws_ok(
  format('select operations.terminalize_idempotency(%L::uuid, ''research.run.create'', ''same-key'', %L, 500, ''{"error":"changed"}''::jsonb)', bootstrap->>'principal_id', repeat('a', 64)),
  'P0001', 'idempotency_terminal_conflict', 'a different terminal response cannot overwrite history'
)
from task3_idempotency_ctx;

create temporary table task3_replay_ctx as
select operations.claim_idempotency(
  (bootstrap->>'principal_id')::uuid, 'research.run.create', 'same-key', repeat('a', 64)
) as replay
from task3_idempotency_ctx;

select is(replay->>'status', 'REPLAY', 'completed request is replayable') from task3_replay_ctx;
select is((replay->>'response_status')::integer, 201, 'replay carries the original status') from task3_replay_ctx;
select is(replay->'response_body', jsonb_build_object('run_id', 'run-one'), 'replay carries the original response body') from task3_replay_ctx;
select throws_ok(
  $$select operations.claim_idempotency('30000000-0000-4000-8000-000000000001', 'research.run.create', 'same-key', repeat('b', 64))$$,
  '42501', 'verified_principal_context_required',
  'a caller cannot claim or replay another principal idempotency key'
);
select set_config('mie.principal_id', '30000000-0000-4000-8000-000000000001', true),
       set_config('mie.request_id', 'idempotency-service-test', true);
select is(operations.claim_idempotency('30000000-0000-4000-8000-000000000001', 'research.run.create', 'same-key', repeat('b', 64))->>'status', 'CLAIMED', 'another principal may independently use the same key');
select ok(not (operations.claim_idempotency('30000000-0000-4000-8000-000000000001', 'research.run.create', 'same-key', repeat('b', 64)) ? 'response_body'), 'another principal cannot see the first principal response');
select throws_ok(
  format(
    'select operations.terminalize_idempotency(%L::uuid, ''research.run.create'', ''same-key'', %L, 201, ''{"run_id":"run-one"}''::jsonb)',
    bootstrap->>'principal_id', repeat('a', 64)
  ),
  '42501', 'verified_principal_context_required',
  'a caller cannot terminalize another principal idempotency claim'
)
from task3_idempotency_ctx;
select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.request_id', 'idempotency-test', true)
from task3_idempotency_ctx;
select is(operations.claim_idempotency((bootstrap->>'principal_id')::uuid, 'research.run.retry', 'same-key', repeat('c', 64))->>'status', 'CLAIMED', 'the same principal and key are isolated by operation') from task3_idempotency_ctx;
select ok(not (operations.claim_idempotency((bootstrap->>'principal_id')::uuid, 'research.run.retry', 'same-key', repeat('c', 64)) ? 'response_body'), 'another operation cannot see the completed response') from task3_idempotency_ctx;
select is((select count(*) from operations.idempotency_records where principal_id = (bootstrap->>'principal_id')::uuid and operation_id = 'research.run.create' and idempotency_key = 'same-key'), 2::bigint, 'claim and completion are both retained') from task3_idempotency_ctx;
select throws_ok(
  format('select operations.terminalize_idempotency(%L::uuid, ''research.run.create'', ''missing-key'', %L, 200, ''{}''::jsonb)', bootstrap->>'principal_id', repeat('c', 64)),
  'P0001', 'idempotency_claim_missing', 'terminalization without a claim fails'
)
from task3_idempotency_ctx;

create temporary table task3_idempotency_race_ctx(principal_id uuid not null);
insert into task3_idempotency_race_ctx values (gen_random_uuid());
create temporary table task3_idempotency_race_result(payload jsonb);

do $idempotency_race_setup$
declare
  race_id uuid;
begin
  select principal_id into race_id from task3_idempotency_race_ctx;
  perform extensions.dblink_connect('task3_idempotency_setup', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec(
    'task3_idempotency_setup',
    format(
      'insert into governance.principals(principal_id, principal_kind, subject, display_name, scopes, created_request_id) values (%L::uuid, ''service'', %L, ''Idempotency Race Service'', array[''research:run''], %L)',
      race_id, 'idempotency-race-' || race_id::text, 'idempotency-race-' || race_id::text
    )
  );
  perform extensions.dblink_exec(
    'task3_idempotency_setup',
    format(
      'insert into governance.principal_decisions(principal_id, revision, verdict, actor_principal_id, request_id, rationale) values (%L::uuid, 1, ''ACTIVE'', %L::uuid, %L, ''created'')',
      race_id, race_id, 'idempotency-race-' || race_id::text
    )
  );
  perform extensions.dblink_disconnect('task3_idempotency_setup');
  perform extensions.dblink_connect('task3_idempotency_one', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_connect('task3_idempotency_two', 'host=db.supabase.internal port=5432 dbname=' || current_database() || ' user=postgres password=postgres sslmode=disable gssencmode=disable require_auth=scram-sha-256 options=-csearch_path= connect_timeout=5');
  perform extensions.dblink_exec('task3_idempotency_one', 'begin');
  perform extensions.dblink_exec('task3_idempotency_one', format('set local mie.principal_id = %L', race_id::text));
  perform extensions.dblink_exec('task3_idempotency_one', format('set local mie.request_id = %L', 'idempotency-race-one-' || race_id::text));
  perform extensions.dblink_exec('task3_idempotency_two', format('set mie.principal_id = %L', race_id::text));
  perform extensions.dblink_exec('task3_idempotency_two', format('set mie.request_id = %L', 'idempotency-race-two-' || race_id::text));
  perform * from extensions.dblink(
    'task3_idempotency_one',
    format(
      'select operations.claim_idempotency(%L::uuid, ''race.operation'', ''race-key'', %L)',
      race_id, repeat('d', 64)
    )
  ) as result(payload jsonb);
  perform extensions.dblink_send_query(
    'task3_idempotency_two',
    format(
      'select operations.claim_idempotency(%L::uuid, ''race.operation'', ''race-key'', %L)',
      race_id, repeat('d', 64)
    )
  );
end
$idempotency_race_setup$;

select is(extensions.dblink_is_busy('task3_idempotency_two'), 1, 'second claim waits while the first logical request is uncommitted');

do $idempotency_race_finish$
begin
  perform extensions.dblink_exec('task3_idempotency_one', 'commit');
  while extensions.dblink_is_busy('task3_idempotency_two') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  insert into task3_idempotency_race_result(payload)
  select payload
  from extensions.dblink_get_result('task3_idempotency_two', false) as result(payload jsonb);
  perform extensions.dblink_disconnect('task3_idempotency_one');
  perform extensions.dblink_disconnect('task3_idempotency_two');
end
$idempotency_race_finish$;

select is((select payload->>'status' from task3_idempotency_race_result), 'IN_PROGRESS', 'losing concurrent claim observes the durable in-progress claim');
select is(
  (select count(*) from operations.idempotency_records where principal_id = (select principal_id from task3_idempotency_race_ctx) and operation_id = 'race.operation' and idempotency_key = 'race-key' and record_kind = 'CLAIMED'),
  1::bigint,
  'two-connection claim race creates exactly one claim row'
);

select * from finish();
rollback;
