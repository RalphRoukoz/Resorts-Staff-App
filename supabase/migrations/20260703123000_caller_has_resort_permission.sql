-- Missing dependency: feedback_fixes RPCs call caller_has_resort_permission,
-- but rpc_security_and_performance was never applied remotely.

CREATE OR REPLACE FUNCTION public.caller_has_resort_permission(
  p_resort_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_perms text[];
  v_is_owner boolean;
BEGIN
  IF v_uid IS NULL OR p_resort_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = v_uid) THEN
    RETURN true;
  END IF;

  SELECT rs.role, rr.permissions, coalesce(rr.is_owner, false)
    INTO v_role, v_perms, v_is_owner
    FROM public.resort_staff rs
    LEFT JOIN public.resort_roles rr ON rr.id = rs.resort_role_id
    WHERE rs.user_id = v_uid
      AND rs.resort_id = p_resort_id
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_is_owner OR v_role = 'admin' THEN
    RETURN true;
  END IF;

  IF v_perms IS NOT NULL AND p_permission = ANY (v_perms) THEN
    RETURN true;
  END IF;

  IF v_role = 'viewer' AND p_permission IN ('dashboard.read', 'analytics.read') THEN
    RETURN true;
  END IF;

  IF v_role = 'reception' AND p_permission = 'scanner' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Batch allowance RPC used by Units page (also from skipped security migration).
CREATE OR REPLACE FUNCTION public.asset_invite_allowances_batch(p_asset_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_id uuid;
  v_row jsonb;
  v_resort_id uuid;
  v_resort_count int;
BEGIN
  IF auth.uid() IS NULL OR p_asset_ids IS NULL OR cardinality(p_asset_ids) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT count(DISTINCT a.resort_id), min(a.resort_id)
    INTO v_resort_count, v_resort_id
    FROM public.assets a
   WHERE a.id = ANY (p_asset_ids);

  IF v_resort_count <> 1 OR v_resort_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ASSETS');
  END IF;

  IF NOT public.caller_has_resort_permission(v_resort_id, 'dashboard.read') THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  FOREACH v_id IN ARRAY p_asset_ids
  LOOP
    v_row := public.asset_invite_allowance(v_id);
    IF v_row ? 'error' THEN
      CONTINUE;
    END IF;
    v_result := v_result || jsonb_build_object(v_id::text, v_row);
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.asset_invite_allowances_batch(uuid[]) TO authenticated;
