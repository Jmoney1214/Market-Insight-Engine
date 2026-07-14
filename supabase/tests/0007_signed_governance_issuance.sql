begin;

set local search_path = public, extensions, pg_catalog;
select set_config('mie.credential_pepper_v1', 'test-credential-pepper-v1', true);
select set_config('mie.session_pepper_v1', 'test-session-pepper-v1', true);

select plan(24);

select has_table('governance', 'decision_attestations', 'signed decision table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'governance.decision_attestations'::regclass),
  'decision attestations have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'governance.decision_attestations'::regclass),
  'decision attestations force RLS'
);
select ok(
  pg_catalog.has_function_privilege(
    'mie_api_read',
    'governance.issue_principal_signed(uuid,text,text,text,text[],uuid,text,text,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'API capability can call the signed principal issuance boundary'
);
select ok(
  not pg_catalog.has_function_privilege(
    'mie_api_read',
    'governance.decide_principal(uuid,bigint,text,uuid,text,text)',
    'EXECUTE'
  ),
  'API capability cannot bypass attestation through the unsigned principal function'
);
select ok(
  not pg_catalog.has_function_privilege(
    'mie_api_read',
    'governance.decide_credential(uuid,bigint,text,uuid,text,text)',
    'EXECUTE'
  ),
  'API capability cannot bypass attestation through the unsigned credential function'
);

create temporary table task4_signed_ctx as
select
  bootstrap,
  '31000000-0000-4000-8000-000000000001'::uuid as service_principal_id,
  '31000000-0000-4000-8000-000000000002'::uuid as service_root_decision_id,
  '31000000-0000-4000-8000-000000000003'::uuid as service_credential_id,
  '31000000-0000-4000-8000-000000000004'::uuid as credential_root_decision_id,
  '31000000-0000-4000-8000-000000000005'::uuid as credential_revoke_decision_id,
  '31000000-0000-4000-8000-000000000006'::uuid as principal_revoke_decision_id,
  'mie_signedsvc0001.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh'::text as service_secret
from (
  select governance.bootstrap_human_principal(
    'desk-operator-signed-governance',
    'Desk Operator',
    array['desk:read', 'governance:credentials'],
    'mie_signedactor01.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh',
    'v1',
    'signed-governance-bootstrap'
  ) as bootstrap
) created;

select set_config('mie.principal_id', bootstrap->>'principal_id', true),
       set_config('mie.credential_id', bootstrap->>'credential_id', true),
       set_config('mie.request_id', 'signed-principal-issue', true)
from task4_signed_ctx;

alter table task4_signed_ctx
  add column service_principal_payload jsonb,
  add column service_credential_payload jsonb,
  add column credential_revoke_payload jsonb,
  add column principal_revoke_payload jsonb,
  add column browser_session jsonb,
  add column rotated_session jsonb;

update task4_signed_ctx
set service_principal_payload = pg_catalog.jsonb_build_object(
  'decisionType', 'PRINCIPAL',
  'decisionId', service_root_decision_id,
  'verdict', 'ACTIVATE',
  'rationale', 'issue research service principal',
  'subject', pg_catalog.jsonb_build_object(
    'subjectType', 'PRINCIPAL',
    'principalId', service_principal_id,
    'principalSha256', repeat('a', 64)
  ),
  'revision', 1,
  'supersedesDecisionId', null,
  'humanPrincipalId', bootstrap->>'principal_id',
  'credentialId', bootstrap->>'credential_id',
  'requestId', 'signed-principal-issue',
  'decidedAt', pg_catalog.clock_timestamp(),
  'nonce', 'principal-issue-nonce',
  'attestationKeyId', 'decision-test-v1',
  'attestationHmacSha256', repeat('b', 64)
);

select is(
  governance.issue_principal_signed(
    service_principal_id,
    'service',
    'research-service-signed',
    'Research Service',
    array['research:read', 'research:run'],
    null,
    null,
    null,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-principal-issue',
    service_principal_payload,
    repeat('c', 64)
  )->>'decisionId',
  service_root_decision_id::text,
  'service principal issuance returns its signed decision'
)
from task4_signed_ctx;

select is(
  (select count(*) from governance.decision_attestations
   where decision_id = service_root_decision_id),
  1::bigint,
  'principal issuance persists one immutable attestation'
)
from task4_signed_ctx;

select is(
  governance.read_principal_governance_subject(
    service_principal_id,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-principal-issue'
  )->>'principal_kind',
  'service',
  'signed principal is readable through the scoped governance projection'
)
from task4_signed_ctx;

select set_config('mie.request_id', 'signed-credential-issue', true);
update task4_signed_ctx
set service_credential_payload = pg_catalog.jsonb_build_object(
  'decisionType', 'CREDENTIAL',
  'decisionId', credential_root_decision_id,
  'verdict', 'ACTIVATE',
  'rationale', 'issue research service credential',
  'subject', pg_catalog.jsonb_build_object(
    'subjectType', 'CREDENTIAL',
    'credentialId', service_credential_id,
    'credentialSha256', repeat('d', 64)
  ),
  'revision', 1,
  'supersedesDecisionId', null,
  'humanPrincipalId', bootstrap->>'principal_id',
  'credentialId', bootstrap->>'credential_id',
  'requestId', 'signed-credential-issue',
  'decidedAt', pg_catalog.clock_timestamp(),
  'nonce', 'credential-issue-nonce',
  'attestationKeyId', 'decision-test-v1',
  'attestationHmacSha256', repeat('e', 64)
);

select is(
  governance.issue_api_credential_signed(
    service_credential_id,
    service_principal_id,
    service_secret,
    array['research:read', 'research:run'],
    null,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-credential-issue',
    service_credential_payload,
    repeat('f', 64)
  )->>'decisionId',
  credential_root_decision_id::text,
  'service credential issuance returns its signed decision'
)
from task4_signed_ctx;

select is(
  governance.verify_api_credential(service_secret)->>'authenticated',
  'true',
  'new permanent service credential verifies'
)
from task4_signed_ctx;

select is(
  governance.read_credential_governance_subject(
    service_credential_id,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-credential-issue'
  )->>'credential_prefix',
  'mie_signedsvc0001',
  'credential projection excludes the secret while retaining its prefix'
)
from task4_signed_ctx;

select set_config('mie.request_id', 'signed-credential-revoke', true);
update task4_signed_ctx
set credential_revoke_payload = pg_catalog.jsonb_build_object(
  'decisionType', 'CREDENTIAL',
  'decisionId', credential_revoke_decision_id,
  'verdict', 'REVOKE',
  'rationale', 'retire research service credential',
  'subject', pg_catalog.jsonb_build_object(
    'subjectType', 'CREDENTIAL',
    'credentialId', service_credential_id,
    'credentialSha256', repeat('d', 64)
  ),
  'revision', 2,
  'supersedesDecisionId', credential_root_decision_id,
  'humanPrincipalId', bootstrap->>'principal_id',
  'credentialId', bootstrap->>'credential_id',
  'requestId', 'signed-credential-revoke',
  'decidedAt', pg_catalog.clock_timestamp(),
  'nonce', 'credential-revoke-nonce',
  'attestationKeyId', 'decision-test-v1',
  'attestationHmacSha256', repeat('1', 64)
);

select is(
  governance.append_credential_revocation_signed(
    service_credential_id,
    1,
    credential_root_decision_id,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-credential-revoke',
    credential_revoke_payload,
    repeat('2', 64)
  )->>'verdict',
  'REVOKE',
  'credential revocation appends its signed decision'
)
from task4_signed_ctx;

select is(
  governance.verify_api_credential(service_secret)->>'authenticated',
  'false',
  'signed credential revocation takes effect immediately'
)
from task4_signed_ctx;

select set_config('mie.request_id', 'signed-principal-revoke', true);
update task4_signed_ctx
set principal_revoke_payload = pg_catalog.jsonb_build_object(
  'decisionType', 'PRINCIPAL',
  'decisionId', principal_revoke_decision_id,
  'verdict', 'REVOKE',
  'rationale', 'retire research service principal',
  'subject', pg_catalog.jsonb_build_object(
    'subjectType', 'PRINCIPAL',
    'principalId', service_principal_id,
    'principalSha256', repeat('a', 64)
  ),
  'revision', 2,
  'supersedesDecisionId', service_root_decision_id,
  'humanPrincipalId', bootstrap->>'principal_id',
  'credentialId', bootstrap->>'credential_id',
  'requestId', 'signed-principal-revoke',
  'decidedAt', pg_catalog.clock_timestamp(),
  'nonce', 'principal-revoke-nonce',
  'attestationKeyId', 'decision-test-v1',
  'attestationHmacSha256', repeat('3', 64)
);

select is(
  governance.append_principal_revocation_signed(
    service_principal_id,
    1,
    service_root_decision_id,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-principal-revoke',
    principal_revoke_payload,
    repeat('4', 64)
  )->>'verdict',
  'REVOKE',
  'principal revocation appends its signed decision'
)
from task4_signed_ctx;

select is(
  governance.read_principal_governance_subject(
    service_principal_id,
    (bootstrap->>'principal_id')::uuid,
    (bootstrap->>'credential_id')::uuid,
    'signed-principal-revoke'
  )->>'head_verdict',
  'REVOKED',
  'principal projection exposes the current immutable-chain head'
)
from task4_signed_ctx;

select set_config('mie.request_id', 'unsigned-principal-rejected', true);
select throws_ok(
  $$select governance.issue_principal_signed(
      '31000000-0000-4000-8000-000000000007'::uuid,
      'service', 'unsigned-service', 'Unsigned Service', array['research:read'],
      null, null, null,
      (bootstrap->>'principal_id')::uuid,
      (bootstrap->>'credential_id')::uuid,
      'unsigned-principal-rejected',
      (service_principal_payload
        || jsonb_build_object(
          'decisionId', '31000000-0000-4000-8000-000000000008'::uuid,
          'requestId', 'unsigned-principal-rejected',
          'subject', jsonb_build_object(
            'subjectType', 'PRINCIPAL',
            'principalId', '31000000-0000-4000-8000-000000000007'::uuid,
            'principalSha256', repeat('5', 64)
          )
        )) - 'attestationHmacSha256',
      repeat('6', 64)
    ) from task4_signed_ctx$$,
  '22023',
  'invalid_decision_attestation',
  'an unsigned principal decision is rejected before issuance'
);

select throws_ok(
  $$update governance.decision_attestations
      set attestation_hmac_sha256 = repeat('9', 64)$$,
  'P0001',
  'append_only_violation',
  'signed decision attestations cannot be altered'
);
select throws_ok(
  $$delete from governance.decision_attestations$$,
  'P0001',
  'append_only_violation',
  'signed decision attestations cannot be deleted'
);
select throws_ok(
  $$truncate table governance.decision_attestations$$,
  'P0001',
  'append_only_violation',
  'signed decision attestations cannot be truncated'
);

select set_config('mie.request_id', 'signed-session-create', true);
update task4_signed_ctx
set browser_session = governance.create_browser_session(
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'signed-old-session-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'signed-old-csrf-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
  'signed-session-create',
  null
);

select set_config('mie.request_id', 'signed-session-rotate', true);
update task4_signed_ctx
set rotated_session = governance.rotate_browser_session(
  (browser_session->>'session_id')::uuid,
  (bootstrap->>'principal_id')::uuid,
  (bootstrap->>'credential_id')::uuid,
  'signed-new-session-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'signed-new-csrf-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab',
  'signed-session-rotate'
);

select isnt(
  rotated_session->>'session_id',
  browser_session->>'session_id',
  'permanent-key step-up rotates to a new browser session'
)
from task4_signed_ctx;

select is(
  governance.verify_browser_session(
    'signed-old-session-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'signed-old-csrf-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'
  )->>'authenticated',
  'false',
  'step-up invalidates the replaced session and CSRF pair'
);

select is(
  governance.verify_browser_session(
    'signed-new-session-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'signed-new-csrf-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab'
  )->>'authenticated',
  'true',
  'step-up activates the rotated session and CSRF pair'
);

select is(
  (select count(*) from governance.decision_attestations
   where request_id like 'signed-%'),
  4::bigint,
  'every successful principal and credential decision has one attestation'
);

select * from finish();
rollback;
