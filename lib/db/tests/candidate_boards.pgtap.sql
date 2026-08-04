BEGIN;
SELECT no_plan();

SELECT has_schema('private', 'private schema exists');
SELECT has_schema('app', 'app schema exists');
SELECT has_table('private', 'candidate_boards', 'private candidate board table exists');
SELECT has_table('private', 'candidate_board_entries', 'private candidate entry table exists');
SELECT has_view('app', 'pine_candidate_boards_v1', 'safe Pine view exists');
SELECT has_function('app', 'create_candidate_board_v1', ARRAY['uuid','text','text','text','date','text','timestamp with time zone','timestamp with time zone','timestamp with time zone','uuid'], 'create routine exists');
SELECT has_function('app', 'append_candidate_board_entry_v1', ARRAY['uuid','text','integer','double precision','uuid','timestamp with time zone','timestamp with time zone','text[]','text[]','text','text'], 'append routine exists');
SELECT has_function('app', 'freeze_candidate_board_v1', ARRAY['uuid','timestamp with time zone','timestamp with time zone','text'], 'freeze routine exists');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname='findesk_candidate_board_publisher'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls
), 'pre-existing hostile publisher role is hardened to the complete least-privilege attribute set');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname='pine_candidate_reader'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolbypassrls
), 'pre-existing hostile reader role is hardened to the complete least-privilege attribute set');
SELECT is(to_regclass('public.candidate_boards'), NULL::regclass, 'legacy public board table removed');
SELECT is(to_regclass('public.candidate_board_entries'), NULL::regclass, 'legacy public entry table removed');
SELECT is(to_regclass('public.pine_candidate_boards_v1'), NULL::regclass, 'legacy public view removed');
SELECT is(to_regprocedure('public.freeze_candidate_board(text)'), NULL::regprocedure, 'legacy public freeze routine removed');
SELECT is(to_regprocedure('public.prevent_frozen_candidate_board_mutation()'), NULL::regprocedure, 'legacy public trigger routine removed');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='private.candidate_boards'::regclass),'board table enables and forces RLS');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='private.candidate_board_entries'::regclass),'entry table enables and forces RLS');
SELECT ok((SELECT bool_and(prosecdef AND array_to_string(proconfig,',') LIKE '%search_path=pg_catalog, private%') FROM pg_proc WHERE oid IN (
  'app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid)'::regprocedure,
  'app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text)'::regprocedure,
  'app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text)'::regprocedure
)),'write routines are SECURITY DEFINER with fixed safe search_path');
SELECT ok((SELECT bool_and('extra_float_digits=3'=ANY(proconfig)) FROM pg_proc WHERE oid IN (
  'private.canonical_float8_v1(double precision)'::regprocedure,
  'private.canonical_candidate_entry_json_v1(jsonb)'::regprocedure,
  'private.compute_candidate_board_entry_hash_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text)'::regprocedure,
  'private.compute_candidate_board_payload_hash_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer,jsonb)'::regprocedure,
  'private.compute_candidate_board_hash_v1(uuid,timestamptz,timestamptz)'::regprocedure,
  'private.read_pine_candidate_boards_v1()'::regprocedure
)), 'every float8 formatting JSONB construction and output function pins extra_float_digits=3');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='app' AND table_name='pine_candidate_boards_v1'),
  ARRAY['schemaVersion','sourceBoardId','sourceProjectRef','sourceSystemVersion','sourceRunId','tradeDate','boardType','stageScheduledAt','startedAt','completedAt','decisionCutoffAt','frozenAt','status','exceptionCode','parentBoardId','boardHash','candidateCount','entries'],
  'view projection is exactly the safe Task 1 board shape');
SELECT ok((SELECT bool_and(has_schema_privilege(role_name,'app','USAGE') AND has_schema_privilege(role_name,'private','USAGE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'migration preserves pre-existing schema usage required by unrelated objects');
SELECT ok(has_schema_privilege('candidate_board_public_probe','app','USAGE')
    AND has_schema_privilege('candidate_board_public_probe','private','USAGE'),
  'migration preserves pre-existing PUBLIC schema usage');
SELECT ok(NOT has_schema_privilege('candidate_board_public_probe','app','CREATE')
    AND NOT has_schema_privilege('candidate_board_public_probe','private','CREATE'),
  'successful migration starts only when shared app/private schemas have no PUBLIC CREATE');
SELECT ok((SELECT bool_and(
    has_schema_privilege(role_name,'app','USAGE')
    AND NOT has_schema_privilege(role_name,'app','CREATE')
    AND has_schema_privilege(role_name,'private','USAGE')
    AND NOT has_schema_privilege(role_name,'private','CREATE')
  ) FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name),
  'dedicated roles have schema usage but cannot create objects in app or private');

SET LOCAL extra_float_digits = -3;
SELECT is(
  private.compute_candidate_board_entry_hash_v1(
    '11111111-1111-4111-8111-111111111111','AAPL',1,0.10000000000000002,NULL,NULL,
    '2026-07-15T13:27:00.000Z',ARRAY['evidence:001','evidence:002'],
    ARRAY['CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'],'Verified catalyst and liquidity evidence.'
  ),
  '2acb317c311517f2e490c510517a80489485724f66559251cb5b0967d68207a8',
  'PostgreSQL entry hash matches hard-coded Pine parity vector'
);

SELECT is(
  private.compute_candidate_board_payload_hash_v1(
    '11111111-1111-4111-8111-111111111111','ganihlwaijdxpigssyab','findesk-1.0.0','findesk-run-20260715-premarket',
    DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z',
    '2026-07-15T13:27:30.000Z','2026-07-15T13:28:00.000Z','2026-07-15T13:29:00.000Z',NULL,0,'[]'::jsonb
  ),
  '0f5dc6db6e6728f9a02cbcc9f84989d99bff29a5c25a04a7c93ed1005713994e',
  'empty board hash matches hard-coded Pine parity vector'
);

-- Caller-side jsonb construction precedes function-local GUCs, so keep this
-- direct JSONB fixture at the PostgreSQL default and exercise hostile output
-- through the real persisted create/append/freeze/view path below.
SET LOCAL extra_float_digits TO DEFAULT;
SELECT is(
  private.compute_candidate_board_payload_hash_v1(
    '11111111-1111-4111-8111-111111111111','ganihlwaijdxpigssyab','findesk-1.0.0','findesk-run-20260715-premarket',
    DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z',
    '2026-07-15T13:27:30.000Z','2026-07-15T13:28:00.000Z','2026-07-15T13:29:00.000Z',NULL,1,
    jsonb_build_array(jsonb_build_object(
      'schemaVersion',1,'sourceBoardId','11111111-1111-4111-8111-111111111111','symbol','AAPL','sourceRank',1,
      'sourceScore',0.10000000000000002,'firstSeenBoardId',NULL,'firstSeenAt',NULL,
      'evidenceCutoffAt','2026-07-15T13:27:00.000Z','evidenceReferenceIds',jsonb_build_array('evidence:001','evidence:002'),
      'reasonCodes',jsonb_build_array('CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'),
      'sourceReasonSummary','Verified catalyst and liquidity evidence.',
      'entryHash','2acb317c311517f2e490c510517a80489485724f66559251cb5b0967d68207a8'
    ))
  ),
  '7843ccea393cf8584b9dda72390453b089134fa923e5dcde637cf7b7156f7114',
  'nonempty board hash matches hard-coded Pine parity vector'
);
SET LOCAL extra_float_digits = -3;
SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '11111111-1111-4111-8111-111111111111','ganihlwaijdxpigssyab','findesk-1.0.0','findesk-run-20260715-premarket',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'hostile float setting accepts the exact persisted Pine parity board identity');
SELECT lives_ok($$SELECT app.append_candidate_board_entry_v1(
  '11111111-1111-4111-8111-111111111111','AAPL',1,0.10000000000000002,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001','evidence:002'],ARRAY['CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'],'Verified catalyst and liquidity evidence.',
  '2acb317c311517f2e490c510517a80489485724f66559251cb5b0967d68207a8')$$,
  'persisted entry hash remains byte-identical under hostile extra_float_digits');
SELECT lives_ok($$SELECT app.freeze_candidate_board_v1(
  '11111111-1111-4111-8111-111111111111','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  '7843ccea393cf8584b9dda72390453b089134fa923e5dcde637cf7b7156f7114')$$,
  'persisted board hash remains byte-identical under hostile extra_float_digits');
SELECT is((SELECT "boardHash" FROM app.pine_candidate_boards_v1 WHERE "sourceBoardId"='11111111-1111-4111-8111-111111111111'),
  '7843ccea393cf8584b9dda72390453b089134fa923e5dcde637cf7b7156f7114',
  'reader view returns the hard-coded Pine board hash under hostile extra_float_digits');
SELECT is((SELECT entries->0->>'entryHash' FROM app.pine_candidate_boards_v1 WHERE "sourceBoardId"='11111111-1111-4111-8111-111111111111'),
  '2acb317c311517f2e490c510517a80489485724f66559251cb5b0967d68207a8',
  'reader view returns the hard-coded Pine entry hash under hostile extra_float_digits');
SELECT is((SELECT entries->0->>'sourceScore' FROM app.pine_candidate_boards_v1 WHERE "sourceBoardId"='11111111-1111-4111-8111-111111111111'),
  '0.10000000000000002','reader view preserves the exact float8 value under hostile extra_float_digits');
SET LOCAL extra_float_digits TO DEFAULT;

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','test-project','findesk-1.0.0','empty-board',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'valid summer 09:28 board is created');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '44444444-4444-4444-8444-444444444444','test-project','findesk-1.0.0','opening-board',DATE '2026-07-15',
  'OPENING_MOVERS','2026-07-15T13:40:00.000Z','2026-07-15T13:35:00.000Z','2026-07-15T13:40:00.000Z',NULL)$$,
  'valid summer 09:40 board is created');

SELECT throws_like($$SELECT app.create_candidate_board_v1(
  '55555555-5555-4555-8555-555555555555','test-project','findesk-1.0.0','wrong-dst',DATE '2026-01-15',
  'PREMARKET_OFFICIAL','2026-01-15T13:28:00.000Z','2026-01-15T13:25:00.000Z','2026-01-15T13:28:00.000Z',NULL)$$,
  '%CANDIDATE_BOARD_SCHEDULE_MISMATCH%','winter schedule requires EST-correct UTC');
SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-project','findesk-1.0.0','winter-est',DATE '2026-01-15',
  'PREMARKET_OFFICIAL','2026-01-15T14:28:00.000Z','2026-01-15T14:25:00.000Z','2026-01-15T14:28:00.000Z',NULL)$$,
  'winter 09:28 board accepts EST-correct 14:28 UTC');
SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','test-project','findesk-1.0.0','delayed-start',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:28:30.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'contract-valid delayed start after the scheduled stage is accepted');
SELECT lives_ok($$SELECT app.freeze_candidate_board_v1(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-07-15T13:29:00.000Z','2026-07-15T13:29:01.000Z',
  private.compute_candidate_board_hash_v1('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-07-15T13:29:00.000Z','2026-07-15T13:29:01.000Z'))$$,
  'contract-valid delayed start board freezes after it starts');

SELECT throws_like($$SELECT private.canonical_timestamp_v1(TIMESTAMPTZ '10000-07-15 13:28:00+00')$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','canonical timestamp rejects year 10000 instead of emitting a five-digit year');
SELECT throws_like($$SELECT private.canonical_timestamp_v1(TIMESTAMPTZ '0001-07-15 13:28:00+00 BC')$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','canonical timestamp rejects BC instead of emitting an ambiguous four-digit year');
SELECT throws_like($$SELECT private.compute_candidate_board_payload_hash_v1(
  '27272727-2727-4727-8727-272727272727','test-project','findesk-1.0.0','direct-year-10000-payload',DATE '10000-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:27:30.000Z',
  '2026-07-15T13:28:00.000Z','2026-07-15T13:29:00.000Z',NULL,0,'[]'::jsonb)$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','payload hash helper rejects a year-10000 trade date');
SELECT throws_like($$SELECT private.compute_candidate_board_payload_hash_v1(
  '28282828-2828-4828-8828-282828282828','test-project','findesk-1.0.0','direct-bc-payload',DATE '0001-07-15 BC',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:27:30.000Z',
  '2026-07-15T13:28:00.000Z','2026-07-15T13:29:00.000Z',NULL,0,'[]'::jsonb)$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','payload hash helper rejects a BC trade date');
SELECT throws_like($$SELECT app.create_candidate_board_v1(
  '15151515-1515-4515-8515-151515151515','test-project','findesk-1.0.0','year-10000-board',DATE '10000-07-15',
  'PREMARKET_OFFICIAL',TIMESTAMPTZ '10000-07-15 13:28:00+00',TIMESTAMPTZ '10000-07-15 13:25:00+00',TIMESTAMPTZ '10000-07-15 13:28:00+00',NULL)$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','create rejects year-10000 trade date schedule start and cutoff');
SELECT throws_like($$SELECT app.create_candidate_board_v1(
  '16161616-1616-4616-8616-161616161616','test-project','findesk-1.0.0','bc-board',DATE '0001-07-15 BC',
  'PREMARKET_OFFICIAL',TIMESTAMPTZ '0001-07-15 13:28:00+00 BC',TIMESTAMPTZ '0001-07-15 13:25:00+00 BC',TIMESTAMPTZ '0001-07-15 13:28:00+00 BC',NULL)$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','create rejects BC trade date schedule start and cutoff');
SELECT throws_like($$INSERT INTO private.candidate_boards(
  source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at)
  VALUES('25252525-2525-4525-8525-252525252525','test-project','findesk-1.0.0','direct-year-10000',DATE '10000-07-15',
  'PREMARKET_OFFICIAL',TIMESTAMPTZ '10000-07-15 13:28:00+00',TIMESTAMPTZ '10000-07-15 13:25:00+00',TIMESTAMPTZ '10000-07-15 13:28:00+00')$$,
  '%candidate_boards_canonical_date_range_v1%','board table domain rejects year-10000 published dates and timestamps');
SELECT throws_like($$INSERT INTO private.candidate_boards(
  source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at)
  VALUES('26262626-2626-4626-8626-262626262626','test-project','findesk-1.0.0','direct-bc',DATE '0001-07-15 BC',
  'PREMARKET_OFFICIAL',TIMESTAMPTZ '0001-07-15 13:28:00+00 BC',TIMESTAMPTZ '0001-07-15 13:25:00+00 BC',TIMESTAMPTZ '0001-07-15 13:28:00+00 BC')$$,
  '%candidate_boards_canonical_date_range_v1%','board table domain rejects BC published dates and timestamps');
SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '17171717-1717-4717-8717-171717171717','test-project','findesk-1.0.0','freeze-date-range',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'freeze date range test board is created');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '17171717-1717-4717-8717-171717171717',TIMESTAMPTZ '10000-07-15 13:29:00+00',TIMESTAMPTZ '10000-07-15 13:29:01+00',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','freeze rejects year-10000 completion and frozen timestamps');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '17171717-1717-4717-8717-171717171717',TIMESTAMPTZ '0001-07-15 13:29:00+00 BC',TIMESTAMPTZ '0001-07-15 13:29:01+00 BC',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','freeze rejects BC completion and frozen timestamps');
SELECT throws_like($$INSERT INTO private.candidate_boards(
  source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,
  stage_scheduled_at,started_at,completed_at,decision_cutoff_at,frozen_at,status)
  VALUES('19191919-1919-4919-8919-191919191919','test-project','findesk-1.0.0','direct-completion-range',DATE '2026-07-15','PREMARKET_OFFICIAL',
  '2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z',TIMESTAMPTZ '10000-07-15 13:29:00+00',
  '2026-07-15T13:28:00.000Z',TIMESTAMPTZ '10000-07-15 13:29:01+00','DRAFT')$$,
  '%candidate_boards_canonical_date_range_v1%','board table domain rejects year-10000 completion and frozen timestamps');
SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '18181818-1818-4818-8818-181818181818','test-project','findesk-1.0.0','entry-date-range',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'entry date range test board is created');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '18181818-1818-4818-8818-181818181818','FUTUREEV',1,1.0,NULL,NULL,TIMESTAMPTZ '10000-07-15 13:27:00+00',
  ARRAY['evidence:date-1'],ARRAY['DATE_TEST'],'Year 10000 evidence cutoff.',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','append rejects year-10000 evidence cutoff');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '18181818-1818-4818-8818-181818181818','BCEV',2,1.0,NULL,NULL,TIMESTAMPTZ '0001-07-15 13:27:00+00 BC',
  ARRAY['evidence:date-2'],ARRAY['DATE_TEST'],'BC evidence cutoff.',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','append rejects BC evidence cutoff');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '18181818-1818-4818-8818-181818181818','FUTUREFS',3,1.0,'18181818-1818-4818-8818-181818181818',TIMESTAMPTZ '10000-07-15 13:26:00+00','2026-07-15T13:27:00.000Z',
  ARRAY['evidence:date-3'],ARRAY['DATE_TEST'],'Year 10000 first seen.',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','append rejects year-10000 first-seen timestamp');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '18181818-1818-4818-8818-181818181818','BCFS',4,1.0,'18181818-1818-4818-8818-181818181818',TIMESTAMPTZ '0001-07-15 13:26:00+00 BC','2026-07-15T13:27:00.000Z',
  ARRAY['evidence:date-4'],ARRAY['DATE_TEST'],'BC first seen.',repeat('0',64))$$,
  '%CANDIDATE_BOARD_CANONICAL_DATE_RANGE%','append rejects BC first-seen timestamp');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('18181818-1818-4818-8818-181818181818','DIRECTBC',5,1.0,'18181818-1818-4818-8818-181818181818',TIMESTAMPTZ '0001-07-15 13:26:00+00 BC',TIMESTAMPTZ '0001-07-15 13:27:00+00 BC',
  ARRAY['evidence:date-5'],ARRAY['DATE_TEST'],'Direct BC entry dates.',repeat('0',64))$$,
  '%candidate_board_entries_canonical_date_range_v1%','entry table domain rejects BC first-seen and evidence timestamps');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','test-project','findesk-1.0.0','array-domain',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'array domain test board is created');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','E2D',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY[['evidence:001','evidence:002']],ARRAY['ARRAY_TEST'],'Multidimensional evidence.',
  private.compute_candidate_board_entry_hash_v1('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','E2D',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY[['evidence:001','evidence:002']],ARRAY['ARRAY_TEST'],'Multidimensional evidence.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects multidimensional evidence arrays');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','R2D',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:002'],ARRAY[['ARRAY_A','ARRAY_B']],'Multidimensional reasons.',
  private.compute_candidate_board_entry_hash_v1('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','R2D',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:002'],ARRAY[['ARRAY_A','ARRAY_B']],'Multidimensional reasons.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects multidimensional reason arrays');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ELB',3,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  '[0:0]={evidence:003}'::text[],ARRAY['ARRAY_TEST'],'Non-one evidence lower bound.',
  private.compute_candidate_board_entry_hash_v1('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ELB',3,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z','[0:0]={evidence:003}'::text[],ARRAY['ARRAY_TEST'],'Non-one evidence lower bound.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects evidence arrays whose lower bound is not one');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','RLB',4,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:004'],'[0:0]={ARRAY_TEST}'::text[],'Non-one reason lower bound.',
  private.compute_candidate_board_entry_hash_v1('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','RLB',4,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:004'],'[0:0]={ARRAY_TEST}'::text[],'Non-one reason lower bound.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects reason arrays whose lower bound is not one');

SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DE2D',5,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY[['evidence:005']],ARRAY['ARRAY_TEST'],'Direct multidimensional evidence.',repeat('0',64))$$,
  '%violates check constraint%','table domain rejects multidimensional evidence arrays');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DR2D',6,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:006'],ARRAY[['ARRAY_TEST']],'Direct multidimensional reasons.',repeat('0',64))$$,
  '%violates check constraint%','table domain rejects multidimensional reason arrays');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DELB',7,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  '[0:0]={evidence:007}'::text[],ARRAY['ARRAY_TEST'],'Direct evidence lower bound.',repeat('0',64))$$,
  '%violates check constraint%','table domain rejects evidence arrays whose lower bound is not one');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DRLB',8,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:008'],'[0:0]={ARRAY_TEST}'::text[],'Direct reason lower bound.',repeat('0',64))$$,
  '%violates check constraint%','table domain rejects reason arrays whose lower bound is not one');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DECONTENT',9,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:009','bad value','evidence:009'],ARRAY['ARRAY_TEST'],'Direct invalid evidence content.',repeat('0',64))$$,
  '%candidate_board_entries_evidence_array_shape_v1%','table domain rejects duplicate unsorted or unsafe evidence content');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','DRCONTENT',10,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:010'],ARRAY['REASON_B','bad reason','REASON_B'],'Direct invalid reason content.',repeat('0',64))$$,
  '%candidate_board_entries_reason_array_shape_v1%','table domain rejects duplicate unsorted or unsafe reason content');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','test-project','findesk-1.0.0','summary-domain',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'summary domain test board is created');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','NBSP',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:101'],ARRAY['SUMMARY_TEST'],chr(160)||'NBSP boundary.',
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','NBSP',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:101'],ARRAY['SUMMARY_TEST'],chr(160)||'NBSP boundary.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects ECMAScript-trimmable NBSP at the summary boundary');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','BOM',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:102'],ARRAY['SUMMARY_TEST'],'BOM boundary.'||chr(65279),
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','BOM',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:102'],ARRAY['SUMMARY_TEST'],'BOM boundary.'||chr(65279)))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects ECMAScript-trimmable BOM at the summary boundary');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','TAB',3,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:103'],ARRAY['SUMMARY_TEST'],E'\tTab boundary.',
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','TAB',3,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:103'],ARRAY['SUMMARY_TEST'],E'\tTab boundary.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append rejects ECMAScript-trimmable tab at the summary boundary');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','UTF16MAX',4,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:104'],ARRAY['SUMMARY_TEST'],repeat('A',999)||chr(128512),
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','UTF16MAX',4,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:104'],ARRAY['SUMMARY_TEST'],repeat('A',999)||chr(128512)))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','append counts an astral character as two UTF-16 code units at the 1000-unit limit');
SELECT lives_ok($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','UTF16OK',5,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:105'],ARRAY['SUMMARY_TEST'],repeat(chr(128512),500),
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','UTF16OK',5,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:105'],ARRAY['SUMMARY_TEST'],repeat(chr(128512),500)))$$,
  'append accepts exactly 1000 UTF-16 code units made from 500 astral characters');
SELECT lives_ok($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','INTERNALWS',6,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:106'],ARRAY['SUMMARY_TEST'],'Internal'||chr(160)||E'\t'||chr(65279)||'content.',
  private.compute_candidate_board_entry_hash_v1('ffffffff-ffff-4fff-8fff-ffffffffffff','INTERNALWS',6,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:106'],ARRAY['SUMMARY_TEST'],'Internal'||chr(160)||E'\t'||chr(65279)||'content.'))$$,
  'append preserves ECMAScript whitespace inside a trimmed summary');
SET LOCAL statement_timeout = '750ms';
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','OVERSIZED',11,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:oversized'],ARRAY['SUMMARY_TEST'],repeat('A',50000),repeat('0',64))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','grossly oversized summaries fail at a bounded validation cost');
SET LOCAL statement_timeout TO DEFAULT;
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','DIRECTWS',7,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:107'],ARRAY['SUMMARY_TEST'],chr(65279)||'Direct BOM boundary.',repeat('0',64))$$,
  '%violates check constraint%','table summary domain rejects ECMAScript boundary whitespace');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','DIRECTLEN',8,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:108'],ARRAY['SUMMARY_TEST'],repeat('A',999)||chr(128512),repeat('0',64))$$,
  '%violates check constraint%','table summary domain enforces the exact 1000 UTF-16 code-unit maximum');

SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:28:00.001Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Future evidence.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_EVIDENCE_AFTER_CUTOFF%','after-cutoff evidence is rejected');

SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Bad hash.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_ENTRY_HASH_MISMATCH%','caller cannot assert a bad entry hash');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Null hash.',NULL)$$,
  '%CANDIDATE_BOARD_ENTRY_HASH_MISMATCH%','NULL expected entry hash fails closed');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:002','evidence:001'],ARRAY['CATALYST_VERIFIED'],'Unsorted evidence.',
  private.compute_candidate_board_entry_hash_v1('33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:002','evidence:001'],ARRAY['CATALYST_VERIFIED'],'Unsorted evidence.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','unsorted evidence references are rejected');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['LIQUIDITY_CONFIRMED','CATALYST_VERIFIED'],'Unsorted reasons.',
  private.compute_candidate_board_entry_hash_v1('33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001'],ARRAY['LIQUIDITY_CONFIRMED','CATALYST_VERIFIED'],'Unsorted reasons.'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','unsorted reason codes are rejected');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],' not trimmed',
  private.compute_candidate_board_entry_hash_v1('33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],' not trimmed'))$$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','untrimmed source summary is rejected');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,'44444444-4444-4444-8444-444444444444',NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Unpaired lineage.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_LINEAGE_INVALID%','unpaired first-seen lineage is rejected');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,'Infinity'::double precision,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Infinite score.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANONICAL_JSON_NONFINITE_NUMBER%','nonfinite source score is rejected');

SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',21,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Rank twenty one.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_ENTRY_LIMIT%','21st rank is rejected');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-project','findesk-1.0.0','entry-limit-board',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'entry limit test board is created');
SELECT lives_ok($test$
DO $body$
DECLARE
  i integer;
  symbol_value text;
  evidence_value text;
  summary_value text;
  expected_hash text;
BEGIN
  FOR i IN 1..20 LOOP
    symbol_value := 'T' || lpad(i::text, 2, '0');
    evidence_value := 'evidence:limit-' || lpad(i::text, 2, '0');
    summary_value := 'Limit entry ' || i || '.';
    expected_hash := private.compute_candidate_board_entry_hash_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', symbol_value, i, i::double precision,
      NULL, NULL, '2026-07-15T13:27:00.000Z', ARRAY[evidence_value], ARRAY['LIMIT_TEST'], summary_value
    );
    PERFORM app.append_candidate_board_entry_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', symbol_value, i, i::double precision,
      NULL, NULL, '2026-07-15T13:27:00.000Z', ARRAY[evidence_value], ARRAY['LIMIT_TEST'], summary_value, expected_hash
    );
  END LOOP;
END
$body$;
$test$, 'twenty valid unique ranked entries are appended');
SELECT is((SELECT count(*) FROM private.candidate_board_entries WHERE source_board_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),20::bigint,
  'entry limit board contains twenty durable entries');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','T21',20,21.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:limit-21'],ARRAY['LIMIT_TEST'],'Twenty first attempted entry.',
  private.compute_candidate_board_entry_hash_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','T21',20,21.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:limit-21'],ARRAY['LIMIT_TEST'],'Twenty first attempted entry.'))$$,
  '%CANDIDATE_BOARD_ENTRY_LIMIT%','true twenty-first entry is rejected by board count limit');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '66666666-6666-4666-8666-666666666666','test-project','findesk-1.0.0','duplicate-board',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'duplicate test board is created');
SELECT lives_ok($$SELECT app.append_candidate_board_entry_v1(
  '66666666-6666-4666-8666-666666666666','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'First entry.',
  private.compute_candidate_board_entry_hash_v1('66666666-6666-4666-8666-666666666666','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'First entry.'))$$,
  'first unique entry is appended');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '66666666-6666-4666-8666-666666666666','MSFT',1,2.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:002'],ARRAY['LIQUIDITY_CONFIRMED'],'Duplicate rank.',
  private.compute_candidate_board_entry_hash_v1('66666666-6666-4666-8666-666666666666','MSFT',1,2.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:002'],ARRAY['LIQUIDITY_CONFIRMED'],'Duplicate rank.'))$$,
  '%duplicate key%','duplicate rank is rejected');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '66666666-6666-4666-8666-666666666666','AAPL',2,2.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:002'],ARRAY['LIQUIDITY_CONFIRMED'],'Duplicate symbol.',
  private.compute_candidate_board_entry_hash_v1('66666666-6666-4666-8666-666666666666','AAPL',2,2.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:002'],ARRAY['LIQUIDITY_CONFIRMED'],'Duplicate symbol.'))$$,
  '%duplicate key%','duplicate symbol is rejected');
SELECT lives_ok($$SELECT app.freeze_candidate_board_v1(
  '66666666-6666-4666-8666-666666666666','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  private.compute_candidate_board_hash_v1('66666666-6666-4666-8666-666666666666','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z'))$$,
  'valid nonempty board freezes');
SELECT is((SELECT entries->0->>'symbol' FROM app.pine_candidate_boards_v1 WHERE "sourceBoardId"='66666666-6666-4666-8666-666666666666'),'AAPL','nonempty view preserves rank order and safe entry shape');
SELECT ok((SELECT bool_and(status='FROZEN' AND "boardType" IN ('PREMARKET_OFFICIAL','OPENING_MOVERS')) FROM app.pine_candidate_boards_v1),'view allowlist exposes only frozen actionable boards');

SELECT lives_ok($$SELECT app.create_candidate_board_v1(
  '77777777-7777-4777-8777-777777777777','test-project','findesk-1.0.0','gapped-board',DATE '2026-07-15',
  'PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'gapped rank board is created');
SELECT lives_ok($$SELECT app.append_candidate_board_entry_v1(
  '77777777-7777-4777-8777-777777777777','AAPL',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Gapped entry.',
  private.compute_candidate_board_entry_hash_v1('77777777-7777-4777-8777-777777777777','AAPL',2,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Gapped entry.'))$$,
  'rank two can be staged while DRAFT');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '77777777-7777-4777-8777-777777777777','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  private.compute_candidate_board_hash_v1('77777777-7777-4777-8777-777777777777','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z'))$$,
  '%CANDIDATE_BOARD_FREEZE_VALIDATION_FAILED%','gapped ranks block freeze');

SELECT lives_ok($$SELECT app.freeze_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  private.compute_candidate_board_hash_v1('33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z'))$$,
  'empty actionable board freezes');
SELECT is(app.freeze_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  (SELECT board_hash FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333')),
  (SELECT board_hash FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333'),
  'exact repeated freeze is idempotent');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','2026-07-15T13:27:31.000Z','2026-07-15T13:29:00.000Z',
  (SELECT board_hash FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333'))$$,
  '%CANDIDATE_BOARD_HASH_CONFLICT%','same hash with changed completion time conflicts');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:01.000Z',
  (SELECT board_hash FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333'))$$,
  '%CANDIDATE_BOARD_HASH_CONFLICT%','same hash with changed freeze time conflicts');
SELECT lives_ok($$SELECT app.freeze_candidate_board_v1(
  '44444444-4444-4444-8444-444444444444','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z',
  private.compute_candidate_board_hash_v1('44444444-4444-4444-8444-444444444444','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z'))$$,
  'separate valid 09:40 board freezes');
SELECT is((SELECT candidate_count FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333'),0,'empty frozen count is zero');
SELECT is(jsonb_array_length((SELECT entries FROM app.pine_candidate_boards_v1 WHERE "sourceBoardId"='33333333-3333-4333-8333-333333333333')),0,'empty frozen view emits entries []');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')$$,
  '%CANDIDATE_BOARD_HASH_CONFLICT%','changed hash conflicts with exact frozen identity');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1(
  '44444444-4444-4444-8444-444444444444','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z',NULL)$$,
  '%CANDIDATE_BOARD_HASH_CONFLICT%','NULL repeated freeze hash fails closed');

SELECT throws_like($$UPDATE private.candidate_boards SET source_run_id='mutated' WHERE source_board_id='33333333-3333-4333-8333-333333333333'$$,'%CANDIDATE_BOARD_IMMUTABLE%','frozen UPDATE fails');
SELECT throws_like($$DELETE FROM private.candidate_boards WHERE source_board_id='33333333-3333-4333-8333-333333333333'$$,'%CANDIDATE_BOARD_IMMUTABLE%','frozen DELETE fails');
SELECT throws_like($$TRUNCATE private.candidate_boards CASCADE$$,'%CANDIDATE_BOARD_TRUNCATE_FORBIDDEN%','TRUNCATE fails');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1(
  '33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Post freeze append.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_NOT_DRAFT%','post-freeze append routine fails');
SELECT throws_like($$INSERT INTO private.candidate_board_entries(
  source_board_id,symbol,source_rank,source_score,first_seen_board_id,first_seen_at,evidence_cutoff_at,
  evidence_reference_ids,reason_codes,source_reason_summary,entry_hash)
  VALUES('33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Direct frozen insert.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%CANDIDATE_BOARD_NOT_DRAFT%','post-freeze direct INSERT fails');
SELECT throws_like($$UPDATE private.candidate_board_entries SET source_reason_summary='Mutated.' WHERE source_board_id='66666666-6666-4666-8666-666666666666'$$,
  '%CANDIDATE_BOARD_ENTRY_IMMUTABLE%','entry UPDATE always fails');
SELECT throws_like($$DELETE FROM private.candidate_board_entries WHERE source_board_id='66666666-6666-4666-8666-666666666666'$$,
  '%CANDIDATE_BOARD_ENTRY_IMMUTABLE%','entry DELETE always fails');
SELECT throws_like($$TRUNCATE private.candidate_board_entries$$,'%CANDIDATE_BOARD_TRUNCATE_FORBIDDEN%','entry TRUNCATE fails');

SELECT ok(NOT has_table_privilege('pine_candidate_reader','private.candidate_boards','SELECT'),'reader has no direct board SELECT');
SELECT ok(NOT has_table_privilege('pine_candidate_reader','private.candidate_board_entries','SELECT'),'reader has no direct entry SELECT');
SELECT ok(has_table_privilege('pine_candidate_reader','app.pine_candidate_boards_v1','SELECT'),'reader can select safe view');
SELECT ok(NOT has_function_privilege('pine_candidate_reader','app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid)','EXECUTE'),'reader cannot create boards');
SELECT ok(NOT has_function_privilege('pine_candidate_reader','app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text)','EXECUTE'),'reader cannot append');
SELECT ok(NOT has_function_privilege('pine_candidate_reader','app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text)','EXECUTE'),'reader cannot freeze');
SELECT ok(NOT has_table_privilege('pine_candidate_reader','private.candidate_boards','INSERT,UPDATE,DELETE,TRUNCATE'),'reader has no direct board writes');
SELECT ok(NOT has_table_privilege('findesk_candidate_board_publisher','private.candidate_boards','INSERT,UPDATE,DELETE,TRUNCATE'),'publisher has no direct board DML');
SELECT ok((SELECT bool_and(
    has_function_privilege('findesk_candidate_board_publisher',pg_proc.oid,'EXECUTE') = (pg_proc.oid IN (
      'app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid)'::regprocedure,
      'app.append_candidate_board_entry_v1(uuid,text,integer,double precision,uuid,timestamptz,timestamptz,text[],text[],text,text)'::regprocedure,
      'app.freeze_candidate_board_v1(uuid,timestamptz,timestamptz,text)'::regprocedure
    ))
  ) FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pg_proc.pronamespace
  WHERE pg_namespace.nspname IN ('private','app')),
  'publisher executes exactly the three write routines and no read or helper routine');
SELECT ok((SELECT bool_and(
    has_function_privilege('pine_candidate_reader',pg_proc.oid,'EXECUTE') = (pg_proc.oid='private.read_pine_candidate_boards_v1()'::regprocedure)
  ) FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pg_proc.pronamespace
  WHERE pg_namespace.nspname IN ('private','app')),
  'reader executes exactly the safe read routine and no write or helper routine');
SELECT ok((SELECT bool_and(NOT has_table_privilege('findesk_candidate_board_publisher',pg_class.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  FROM pg_class JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace
  WHERE (pg_namespace.nspname,pg_class.relname) IN (
    ('private','candidate_boards'),('private','candidate_board_entries'),('app','pine_candidate_boards_v1')
  ) AND pg_class.relkind IN ('r','p','v','m')),
  'publisher receives no direct table or view privileges despite hostile defaults');
SELECT ok((SELECT bool_and(NOT has_table_privilege(role_name,'private.candidate_boards','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'sentinel Supabase roles receive no table privileges');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,'app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'sentinel Supabase roles receive no write routine execution');
SELECT ok((SELECT bool_and(NOT has_table_privilege(role_name,object_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
  CROSS JOIN (
    SELECT pg_class.oid object_oid FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid=pg_class.relnamespace
    WHERE (pg_namespace.nspname,pg_class.relname) IN (
      ('private','candidate_boards'),('private','candidate_board_entries'),('app','pine_candidate_boards_v1')
    ) AND pg_class.relkind IN ('r','p','v','m')
  ) objects), 'hostile table default privileges are explicitly revoked from every sentinel role and object');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,object_oid,'EXECUTE'))
  FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
  CROSS JOIN (
    SELECT pg_proc.oid object_oid FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid=pg_proc.pronamespace
    WHERE pg_namespace.nspname IN ('private','app')
      AND pg_proc.proname = ANY (ARRAY[
        'canonical_date_in_range_v1', 'canonical_date_v1',
        'canonical_timestamp_in_range_v1', 'canonical_timestamp_v1',
        'ecmascript_trim_v1', 'utf16_code_unit_length_v1',
        'text_array_is_canonical_v1', 'canonical_json_string_v1',
        'canonical_float8_v1', 'canonical_text_array_v1',
        'canonical_candidate_entry_json_v1',
        'compute_candidate_board_entry_hash_v1',
        'compute_candidate_board_payload_hash_v1',
        'compute_candidate_board_hash_v1',
        'guard_candidate_board_mutation_v1',
        'guard_candidate_board_entry_v1',
        'reject_candidate_board_truncate_v1',
        'read_pine_candidate_boards_v1',
        'create_candidate_board_v1',
        'append_candidate_board_entry_v1',
        'freeze_candidate_board_v1'
      ]::text[])
  ) objects), 'hostile routine default privileges are explicitly revoked from every sentinel role and object');
SELECT ok((SELECT bool_and(NOT has_table_privilege(role_name,object_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES
    ('app.unrelated_acl_probe'::regclass),
    ('private.unrelated_acl_probe'::regclass)
  ) objects(object_oid)), 'dedicated roles lose hostile privileges on every unrelated table');
SELECT ok((SELECT bool_and(NOT has_sequence_privilege(role_name,object_oid,'USAGE,SELECT,UPDATE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES
    ('app.unrelated_acl_probe_sequence'::regclass),
    ('private.unrelated_acl_probe_sequence'::regclass)
  ) objects(object_oid)), 'dedicated roles lose hostile privileges on every unrelated sequence');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,object_oid,'EXECUTE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES
    ('app.unrelated_acl_probe_function()'::regprocedure),
    ('private.unrelated_acl_probe_function()'::regprocedure)
  ) objects(object_oid)), 'dedicated roles lose hostile privileges on every unrelated routine');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,object_oid,'EXECUTE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES
    ('app.unrelated_acl_probe_procedure()'::regprocedure),
    ('private.unrelated_acl_probe_procedure()'::regprocedure)
  ) objects(object_oid)), 'dedicated roles lose hostile privileges on every unrelated procedure');

CREATE TABLE app.future_acl_probe (id integer PRIMARY KEY);
CREATE TABLE private.future_acl_probe (id integer PRIMARY KEY);
CREATE SEQUENCE app.future_acl_probe_sequence;
CREATE SEQUENCE private.future_acl_probe_sequence;
CREATE FUNCTION app.future_acl_probe_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE FUNCTION private.future_acl_probe_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE PROCEDURE app.future_acl_probe_procedure() LANGUAGE plpgsql AS 'BEGIN NULL; END';
CREATE PROCEDURE private.future_acl_probe_procedure() LANGUAGE plpgsql AS 'BEGIN NULL; END';
REVOKE EXECUTE ON FUNCTION app.future_acl_probe_function() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.future_acl_probe_function() FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE app.future_acl_probe_procedure() FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE private.future_acl_probe_procedure() FROM PUBLIC;
SELECT ok((SELECT bool_and(NOT has_table_privilege(role_name,object_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES ('app.future_acl_probe'::regclass),('private.future_acl_probe'::regclass)) objects(object_oid)),
  'dedicated roles receive no future table authority from hostile default ACLs');
SELECT ok((SELECT bool_and(NOT has_sequence_privilege(role_name,object_oid,'USAGE,SELECT,UPDATE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES ('app.future_acl_probe_sequence'::regclass),('private.future_acl_probe_sequence'::regclass)) objects(object_oid)),
  'dedicated roles receive no future sequence authority from hostile default ACLs');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,object_oid,'EXECUTE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES ('app.future_acl_probe_function()'::regprocedure),('private.future_acl_probe_function()'::regprocedure)) objects(object_oid)),
  'dedicated roles receive no future routine authority from hostile default ACLs');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,object_oid,'EXECUTE'))
  FROM unnest(ARRAY['findesk_candidate_board_publisher','pine_candidate_reader']) role_name
  CROSS JOIN (VALUES ('app.future_acl_probe_procedure()'::regprocedure),('private.future_acl_probe_procedure()'::regprocedure)) objects(object_oid)),
  'dedicated roles receive no future procedure authority from hostile default ACLs');
SET LOCAL ROLE anon;
SELECT lives_ok($$SELECT count(*) FROM app.unrelated_acl_probe$$,'anon retains legitimate access to an unrelated app object');
SELECT lives_ok($$SELECT count(*) FROM private.unrelated_acl_probe$$,'anon retains legitimate access to an unrelated private object');
SELECT lives_ok($$SELECT app.unrelated_acl_probe_function()$$,'anon retains legitimate access to an unrelated app function');
SELECT lives_ok($$SELECT private.unrelated_acl_probe_function()$$,'anon retains legitimate access to an unrelated private function');
SELECT lives_ok($$CALL app.unrelated_acl_probe_procedure()$$,'anon retains legitimate access to an unrelated app procedure');
SELECT lives_ok($$CALL private.unrelated_acl_probe_procedure()$$,'anon retains legitimate access to an unrelated private procedure');
SELECT throws_like($$SELECT count(*) FROM app.pine_candidate_boards_v1$$,'%permission denied%','anon cannot read the candidate-board view after hostile grants');
SELECT throws_like($$SELECT app.create_candidate_board_v1('12121212-1212-4212-8212-121212121212','anon','v1','anon-rpc',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  '%permission denied%','anon cannot execute candidate-board write routines after hostile grants');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT count(*) FROM app.unrelated_acl_probe$$,'authenticated retains legitimate access to an unrelated app object');
SELECT lives_ok($$SELECT count(*) FROM private.unrelated_acl_probe$$,'authenticated retains legitimate access to an unrelated private object');
SELECT lives_ok($$SELECT app.unrelated_acl_probe_function()$$,'authenticated retains legitimate access to an unrelated app function');
SELECT lives_ok($$SELECT private.unrelated_acl_probe_function()$$,'authenticated retains legitimate access to an unrelated private function');
SELECT lives_ok($$CALL app.unrelated_acl_probe_procedure()$$,'authenticated retains legitimate access to an unrelated app procedure');
SELECT lives_ok($$CALL private.unrelated_acl_probe_procedure()$$,'authenticated retains legitimate access to an unrelated private procedure');
SELECT throws_like($$SELECT count(*) FROM app.pine_candidate_boards_v1$$,'%permission denied%','authenticated cannot read the candidate-board view after hostile grants');
SELECT throws_like($$SELECT app.create_candidate_board_v1('13131313-1313-4313-8313-131313131313','authenticated','v1','authenticated-rpc',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  '%permission denied%','authenticated cannot execute candidate-board write routines after hostile grants');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT count(*) FROM app.unrelated_acl_probe$$,'service_role retains legitimate access to an unrelated app object');
SELECT lives_ok($$SELECT count(*) FROM private.unrelated_acl_probe$$,'service_role retains legitimate access to an unrelated private object');
SELECT lives_ok($$SELECT app.unrelated_acl_probe_function()$$,'service_role retains legitimate access to an unrelated app function');
SELECT lives_ok($$SELECT private.unrelated_acl_probe_function()$$,'service_role retains legitimate access to an unrelated private function');
SELECT lives_ok($$CALL app.unrelated_acl_probe_procedure()$$,'service_role retains legitimate access to an unrelated app procedure');
SELECT lives_ok($$CALL private.unrelated_acl_probe_procedure()$$,'service_role retains legitimate access to an unrelated private procedure');
SELECT throws_like($$SELECT count(*) FROM app.pine_candidate_boards_v1$$,'%permission denied%','service_role cannot read the candidate-board view after hostile grants');
SELECT throws_like($$SELECT app.create_candidate_board_v1('14141414-1414-4414-8414-141414141414','service-role','v1','service-role-rpc',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  '%permission denied%','service_role cannot execute candidate-board write routines after hostile grants');
RESET ROLE;
SET LOCAL ROLE pine_candidate_reader;
SELECT lives_ok($$SELECT count(*) FROM app.pine_candidate_boards_v1$$,'reader view succeeds');
SELECT throws_like($$SELECT count(*) FROM private.candidate_boards$$,'%permission denied%','reader direct table read fails');
SELECT throws_like($$INSERT INTO private.candidate_boards(source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at)
  VALUES('88888888-8888-4888-8888-888888888888','reader','v1','reader-write',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z')$$,
  '%permission denied%','reader direct write fails');
SELECT throws_like($$SELECT app.create_candidate_board_v1('88888888-8888-4888-8888-888888888888','reader','v1','reader-rpc',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  '%permission denied%','reader create RPC fails');
SELECT throws_like($$SELECT app.append_candidate_board_entry_v1('33333333-3333-4333-8333-333333333333','AAPL',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001'],ARRAY['CATALYST_VERIFIED'],'Reader RPC.','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%permission denied%','reader append RPC fails');
SELECT throws_like($$SELECT app.freeze_candidate_board_v1('33333333-3333-4333-8333-333333333333','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z','0000000000000000000000000000000000000000000000000000000000000000')$$,
  '%permission denied%','reader freeze RPC fails');
RESET ROLE;

SET LOCAL ROLE findesk_candidate_board_publisher;
SELECT lives_ok($$SELECT app.create_candidate_board_v1('99999999-9999-4999-8999-999999999999','publisher-project','v1','publisher-rpc',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)$$,
  'publisher can call narrow create routine');
SELECT throws_like($$SELECT count(*) FROM app.pine_candidate_boards_v1$$,'%permission denied%','publisher cannot read the Pine candidate-board view');
SELECT throws_like($$SELECT count(*) FROM private.read_pine_candidate_boards_v1()$$,'%permission denied%','publisher cannot execute the private read routine');
SELECT throws_like($$SELECT private.canonical_float8_v1(1.0)$$,'%permission denied%','publisher cannot execute private canonical helpers');
SELECT throws_like($$SELECT count(*) FROM private.candidate_boards$$,'%permission denied%','publisher cannot directly read tables');
SELECT throws_like($$INSERT INTO private.candidate_boards(source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at)
  VALUES('aaaaaaaa-9999-4999-8999-999999999999','publisher','v1','direct',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z')$$,
  '%permission denied%','publisher cannot directly insert tables');
RESET ROLE;

SET LOCAL statement_timeout = '750ms';
SELECT throws_like($test$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','BIGEVID',12,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY(SELECT 'evidence:'||lpad(i::text,6,'0') FROM generate_series(1,50000) AS generated(i)),
  ARRAY['SUMMARY_TEST'],'Oversized evidence array.',repeat('0',64))$test$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','50k evidence items fail before unbounded canonical-array work');
SELECT throws_like($test$SELECT app.append_candidate_board_entry_v1(
  'ffffffff-ffff-4fff-8fff-ffffffffffff','BIGREASON',13,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',
  ARRAY['evidence:bounded'],
  ARRAY(SELECT 'REASON_'||lpad(i::text,6,'0') FROM generate_series(1,100000) AS generated(i)),
  'Oversized reason array.',repeat('0',64))$test$,
  '%CANDIDATE_BOARD_ENTRY_PUBLICATION_INVALID%','100k reason items fail before unbounded canonical-array work');
SET LOCAL statement_timeout TO DEFAULT;

SELECT * FROM finish();
ROLLBACK;
