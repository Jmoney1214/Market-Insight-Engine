#!/usr/bin/env bash
set -euo pipefail

export PGOPTIONS="-c statement_timeout=12000"
psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
logs=(/tmp/append-before.log /tmp/freeze-behind.log /tmp/freeze-holder.log /tmp/append-behind.log /tmp/freeze-exact.log /tmp/freeze-divergent.log)

dump_logs() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    for log in "${logs[@]}"; do
      [[ -f "$log" ]] && { echo "--- $log ---" >&2; cat "$log" >&2; }
    done
  fi
  exit "$status"
}
trap dump_logs EXIT

wait_for_file() {
  local path=$1
  for _ in $(seq 1 200); do
    [[ -e "$path" ]] && return 0
    sleep 0.05
  done
  echo "Timed out waiting for barrier $path" >&2
  return 1
}

wait_for_lock() {
  local app_name=$1
  for _ in $(seq 1 200); do
    [[ $("${psql_base[@]}" -At -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='$app_name' AND wait_event_type='Lock'") == 1 ]] && return 0
    sleep 0.05
  done
  echo "Timed out waiting for $app_name to block on the board row" >&2
  return 1
}

# Append obtains the row lock first. Freeze must wait, then include the committed entry.
board_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
"${psql_base[@]}" -c "SELECT app.create_candidate_board_v1('$board_id','concurrency-project','findesk-1.0.0','append-before-freeze',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)" >/dev/null
entry_hash="$("${psql_base[@]}" -At -c "SELECT private.compute_candidate_board_entry_hash_v1('$board_id','AAPL',1,0.10000000000000002,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001','evidence:002'],ARRAY['CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'],'Verified catalyst and liquidity evidence.')")"
board_hash="$("${psql_base[@]}" -At -c "SELECT private.compute_candidate_board_payload_hash_v1('$board_id','concurrency-project','findesk-1.0.0','append-before-freeze',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:27:30.000Z','2026-07-15T13:28:00.000Z','2026-07-15T13:29:00.000Z',NULL,1,jsonb_build_array(jsonb_build_object('schemaVersion',1,'sourceBoardId','$board_id','symbol','AAPL','sourceRank',1,'sourceScore',0.10000000000000002,'firstSeenBoardId',NULL,'firstSeenAt',NULL,'evidenceCutoffAt','2026-07-15T13:27:00.000Z','evidenceReferenceIds',jsonb_build_array('evidence:001','evidence:002'),'reasonCodes',jsonb_build_array('CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'),'sourceReasonSummary','Verified catalyst and liquidity evidence.','entryHash','$entry_hash'))) ")"
rm -f /tmp/append-ready /tmp/append-release
mkfifo /tmp/append-release
PGAPPNAME=append-holder "${psql_base[@]}" >/tmp/append-before.log 2>&1 <<SQL &
BEGIN;
SELECT app.append_candidate_board_entry_v1('$board_id','AAPL',1,0.10000000000000002,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:001','evidence:002'],ARRAY['CATALYST_VERIFIED','LIQUIDITY_CONFIRMED'],'Verified catalyst and liquidity evidence.','$entry_hash');
\! touch /tmp/append-ready
\! read ignored < /tmp/append-release
COMMIT;
SQL
append_pid=$!
wait_for_file /tmp/append-ready
PGAPPNAME=freeze-behind-append "${psql_base[@]}" -c "SELECT app.freeze_candidate_board_v1('$board_id','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z','$board_hash')" >/tmp/freeze-behind.log 2>&1 & freeze_pid=$!
wait_for_lock freeze-behind-append
echo release > /tmp/append-release
wait "$append_pid"
wait "$freeze_pid"
"${psql_base[@]}" -At -c "SELECT status||':'||candidate_count||':'||board_hash FROM private.candidate_boards WHERE source_board_id='$board_id'" | grep -qx "FROZEN:1:$board_hash"

# Freeze obtains the row lock first. An append started behind it must block and then fail.
board_three="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
"${psql_base[@]}" -c "SELECT app.create_candidate_board_v1('$board_three','concurrency-project','findesk-1.0.0','append-after-freeze',DATE '2026-07-15','PREMARKET_OFFICIAL','2026-07-15T13:28:00.000Z','2026-07-15T13:25:00.000Z','2026-07-15T13:28:00.000Z',NULL)" >/dev/null
hash_three="$("${psql_base[@]}" -At -c "SELECT private.compute_candidate_board_hash_v1('$board_three','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z')")"
entry_three="$("${psql_base[@]}" -At -c "SELECT private.compute_candidate_board_entry_hash_v1('$board_three','MSFT',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:003'],ARRAY['LIQUIDITY_CONFIRMED'],'Blocked append.')")"
rm -f /tmp/freeze-ready /tmp/freeze-release
mkfifo /tmp/freeze-release
PGAPPNAME=freeze-holder "${psql_base[@]}" >/tmp/freeze-holder.log 2>&1 <<SQL &
BEGIN;
SELECT app.freeze_candidate_board_v1('$board_three','2026-07-15T13:27:30.000Z','2026-07-15T13:29:00.000Z','$hash_three');
\! touch /tmp/freeze-ready
\! read ignored < /tmp/freeze-release
COMMIT;
SQL
holder_pid=$!
wait_for_file /tmp/freeze-ready
PGAPPNAME=append-behind-freeze "${psql_base[@]}" -c "SELECT app.append_candidate_board_entry_v1('$board_three','MSFT',1,1.0,NULL,NULL,'2026-07-15T13:27:00.000Z',ARRAY['evidence:003'],ARRAY['LIQUIDITY_CONFIRMED'],'Blocked append.','$entry_three')" >/tmp/append-behind.log 2>&1 & behind_pid=$!
wait_for_lock append-behind-freeze
echo release > /tmp/freeze-release
wait "$holder_pid"
set +e
wait "$behind_pid"
behind_status=$?
set -e
[[ $behind_status -ne 0 ]]
grep -q CANDIDATE_BOARD_NOT_DRAFT /tmp/append-behind.log
"${psql_base[@]}" -At -c "SELECT status||':'||candidate_count FROM private.candidate_boards WHERE source_board_id='$board_three'" | grep -qx 'FROZEN:0'

# One freeze wins; an exact concurrent replay converges and a divergent hash conflicts.
board_two="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
"${psql_base[@]}" -c "SELECT app.create_candidate_board_v1('$board_two','concurrency-project','findesk-1.0.0','concurrent-freeze',DATE '2026-07-15','OPENING_MOVERS','2026-07-15T13:40:00.000Z','2026-07-15T13:35:00.000Z','2026-07-15T13:40:00.000Z',NULL)" >/dev/null
hash_two="$("${psql_base[@]}" -At -c "SELECT private.compute_candidate_board_hash_v1('$board_two','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z')")"
rm -f /tmp/winner-ready /tmp/winner-release
mkfifo /tmp/winner-release
PGAPPNAME=freeze-winner "${psql_base[@]}" >/tmp/freeze-holder.log 2>&1 <<SQL &
BEGIN;
SELECT app.freeze_candidate_board_v1('$board_two','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z','$hash_two');
\! touch /tmp/winner-ready
\! read ignored < /tmp/winner-release
COMMIT;
SQL
winner_pid=$!
wait_for_file /tmp/winner-ready
PGAPPNAME=freeze-exact "${psql_base[@]}" -c "SELECT app.freeze_candidate_board_v1('$board_two','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z','$hash_two')" >/tmp/freeze-exact.log 2>&1 & exact_pid=$!
PGAPPNAME=freeze-divergent "${psql_base[@]}" -c "SELECT app.freeze_candidate_board_v1('$board_two','2026-07-15T13:39:00.000Z','2026-07-15T13:41:00.000Z','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')" >/tmp/freeze-divergent.log 2>&1 & divergent_pid=$!
wait_for_lock freeze-exact
wait_for_lock freeze-divergent
echo release > /tmp/winner-release
wait "$winner_pid"
wait "$exact_pid"
set +e
wait "$divergent_pid"
divergent_status=$?
set -e
[[ $divergent_status -ne 0 ]]
grep -q CANDIDATE_BOARD_HASH_CONFLICT /tmp/freeze-divergent.log
"${psql_base[@]}" -At -c "SELECT count(*)||':'||min(board_hash)||':'||max(board_hash) FROM private.candidate_boards WHERE source_board_id='$board_two'" | grep -qx "1:$hash_two:$hash_two"

trap - EXIT
echo "candidate-board concurrency proof passed"
