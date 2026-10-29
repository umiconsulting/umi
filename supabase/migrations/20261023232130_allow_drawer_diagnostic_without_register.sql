DO $drawer_hotfix$
DECLARE
  v_definition text;
  v_original_md5 constant text := '17dfc967c76a16f5cdfe72ee5f8975f5';
  v_old_guard constant text := $old_guard$  if nullif(p_command->>'registerId','') is null
    and p_command->>'commandType' in ('open_drawer','test_drawer')
  then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;$old_guard$;
  v_new_guard constant text := $new_guard$  if nullif(p_command->>'registerId','') is null
    and p_command->>'commandType' in ('open_drawer','test_drawer')
    and not (
      p_command->>'commandType' is not distinct from 'test_drawer'
      and p_command->>'sourceAggregateType' is not distinct from 'hardware_diagnostic'
      and p_command->'safePayload'->'drawer'->>'reason' is not distinct from 'manager_test'
    )
  then raise exception 'HARDWARE_REGISTER_SCOPE'; end if;$new_guard$;
  v_old_count integer;
  v_new_count integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'merchant.create_hardware_command(jsonb)'::pg_catalog.regprocedure
  ) INTO STRICT v_definition;

  v_old_count := (length(v_definition) - length(replace(v_definition, v_old_guard, '')))
    / length(v_old_guard);
  v_new_count := (length(v_definition) - length(replace(v_definition, v_new_guard, '')))
    / length(v_new_guard);

  IF v_new_count = 1 AND v_old_count = 0 THEN
    RETURN;
  END IF;

  IF pg_catalog.md5(v_definition) IS DISTINCT FROM v_original_md5 THEN
    RAISE EXCEPTION 'DRAWER_HOTFIX_FUNCTION_CHANGED';
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'DRAWER_HOTFIX_GUARD_MISMATCH';
  END IF;

  EXECUTE replace(v_definition, v_old_guard, v_new_guard);
END
$drawer_hotfix$;
