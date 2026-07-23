// Removes a staff membership. If the auth user has no remaining resort_staff
// rows (and is not a super_admin), deletes the auth user so the username/email
// can be reused.
//
// Body: { staff_id: uuid }  — resort_staff.id
//
// Authorization:
//   - super-admin -> any non-owner staff row
//   - resort admin -> reception/viewer (or custom non-owner) in their resort

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { staff_id } = await req.json()
    if (!staff_id) return json({ error: 'BAD_INPUT' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !user) return json({ error: 'NOT_AUTHENTICATED' }, 401)

    const admin = createClient(url, serviceKey)

    const { data: target, error: targetErr } = await admin
      .from('resort_staff')
      .select('id, resort_id, user_id, role, username, resort_roles(is_owner)')
      .eq('id', staff_id)
      .maybeSingle()

    if (targetErr || !target) return json({ error: 'NOT_FOUND' }, 404)

    const roleJoin = target.resort_roles as { is_owner?: boolean } | { is_owner?: boolean }[] | null
    const ownerFlag = Array.isArray(roleJoin) ? roleJoin[0]?.is_owner : roleJoin?.is_owner
    if (ownerFlag) return json({ error: 'FORBIDDEN' }, 403)

    const { data: superRow } = await admin
      .from('super_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const isSuper = !!superRow

    let allowed = isSuper
    if (!allowed) {
      const { data: callerAdmin } = await admin
        .from('resort_staff')
        .select('id')
        .eq('resort_id', target.resort_id)
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle()
      // Resort admins may remove non-admin staff in their resort.
      allowed = !!callerAdmin && target.role !== 'admin' && target.user_id !== user.id
    }

    if (!allowed) return json({ error: 'FORBIDDEN' }, 403)

    const staffUserId = target.user_id as string

    const { error: delErr } = await admin.from('resort_staff').delete().eq('id', staff_id)
    if (delErr) return json({ error: delErr.message }, 400)

    const { data: remaining } = await admin
      .from('resort_staff')
      .select('id')
      .eq('user_id', staffUserId)
      .limit(1)

    const { data: stillSuper } = await admin
      .from('super_admins')
      .select('user_id')
      .eq('user_id', staffUserId)
      .maybeSingle()

    if (!(remaining ?? []).length && !stillSuper) {
      const { error: authDelErr } = await admin.auth.admin.deleteUser(staffUserId)
      if (authDelErr) {
        // Membership already removed; surface warning but succeed for UI.
        return json({ ok: true, auth_deleted: false, warning: authDelErr.message })
      }
      return json({ ok: true, auth_deleted: true })
    }

    return json({ ok: true, auth_deleted: false })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
