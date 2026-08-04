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
SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname='findesk_candidate_board_publisher' AND NOT rolcanlogin), 'publisher is NOLOGIN');
SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pine_candidate_reader' AND NOT rolcanlogin), 'reader is NOLOGIN');
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
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='app' AND table_name='pine_candidate_boards_v1'),
  ARRAY['schemaVersion','sourceBoardId','sourceProjectRef','sourceSystemVersion','sourceRunId','tradeDate','boardType','stageScheduledAt','startedAt','completedAt','decisionCutoffAt','frozenAt','status','exceptionCode','parentBoardId','boardHash','candidateCount','entries'],
  'view projection is exactly the safe Task 1 board shape');
SELECT ok((SELECT bool_and(NOT has_schema_privilege(role_name,'app','USAGE') AND NOT has_schema_privilege(role_name,'private','USAGE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'anon authenticated and service_role receive no candidate-board schema privileges');

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
SELECT ok((SELECT bool_and(NOT has_table_privilege(role_name,'private.candidate_boards','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'sentinel Supabase roles receive no table privileges');
SELECT ok((SELECT bool_and(NOT has_function_privilege(role_name,'app.create_candidate_board_v1(uuid,text,text,text,date,text,timestamptz,timestamptz,timestamptz,uuid)','EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) role_name),
  'sentinel Supabase roles receive no write routine execution');
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
SELECT throws_like($$SELECT count(*) FROM private.candidate_boards$$,'%permission denied%','publisher cannot directly read tables');
SELECT throws_like($$INSERT INTO private.candidate_boards(source_board_id,source_project_ref,source_system_version,source_run_id,trade_date,board_type,stage_scheduled_at,started_at,decision_cutoff_at)
  VALUES('aaaaaaaa-9999-4999-8999-999999999999','publisher','v1','direct',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z')$$,
  '%permission denied%','publisher cannot directly insert tables');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
