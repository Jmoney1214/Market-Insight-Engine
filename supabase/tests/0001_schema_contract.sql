begin;

set local search_path = public, extensions, pg_catalog;

select plan(8);

select has_schema('governance');
select has_schema('operations');
select has_table('governance'::name, 'principals'::name);
select has_table('governance'::name, 'api_credentials'::name);
select has_table('governance'::name, 'browser_sessions'::name);
select has_table('operations'::name, 'api_request_audit'::name);
select function_returns('governance', 'verify_api_credential', array['text'], 'jsonb');

insert into governance.principals(
  principal_id, principal_kind, subject, display_name, scopes, created_request_id
) values (
  '00000000-0000-4000-8000-000000000001', 'human', 'schema-contract-human',
  'Schema Contract Human', array['governance:credentials'], 'schema-contract'
);

insert into governance.api_credentials(
  credential_id, credential_prefix, credential_digest, pepper_version,
  principal_id, scopes, created_by_principal_id, created_request_id
) values (
  '00000000-0000-4000-8000-000000000002', 'mie_schemaContract123',
  decode(repeat('aa', 32), 'hex'), 'v1',
  '00000000-0000-4000-8000-000000000001', array['governance:credentials'],
  '00000000-0000-4000-8000-000000000001', 'schema-contract'
);

select throws_ok(
  'update governance.api_credentials set credential_prefix = ''x''',
  'P0001',
  'append_only_violation'
);

select * from finish();
rollback;
