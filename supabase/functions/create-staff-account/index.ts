// Creates a staff account (admin/reception/viewer) and links it to a resort.
// Reclaims orphaned auth users (deleted from resort_staff but still in auth.users)
// so the same username can be created again.
// Authorization:
//   super-admin  -> admin or reception for any resort (NOT viewer)
//   resort admin -> reception or viewer for own resort only

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOMAIN = 'staff.invite.app'

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

function isAlreadyRegistered(message: string) {
  return /already (been )?registered|already exists|duplicate/i.test(message)
}

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const { username, password, role, resort_id } = await req.json()
    if (!username || !password || !['admin', 'reception', 'viewer'].includes(role) || !resort_id)
      return json({ error: 'BAD_INPUT' }, 400)

    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const callerClient = createClient(url!, anonKey!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !user) return json({ error: 'NOT_AUTHENTICATED' }, 401)

    const admin = createClient(url!, serviceKey!)

    const { data: superRow } = await admin
      .from('super_admins').select('user_id').eq('user_id', user.id).maybeSingle()
    const isSuper = !!superRow
    const { data: adminRow } = await admin
      .from('resort_staff').select('id')
      .eq('resort_id', resort_id).eq('user_id', user.id).eq('role', 'admin').maybeSingle()
    const isResortAdmin = !!adminRow

    const allowed =
      (isSuper && (role === 'admin' || role === 'reception')) ||
      (isResortAdmin && (role === 'reception' || role === 'viewer'))

    if (!allowed) return json({ error: 'FORBIDDEN' }, 403)

    const uname = String(username).trim().toLowerCase()
    const email = `${uname}@${DOMAIN}`

    let userId: string | null = null

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: uname },
    })

    if (!createErr && created.user) {
      userId = created.user.id
    } else if (createErr && isAlreadyRegistered(createErr.message)) {
      // Auth user left behind after staff row delete — reclaim if unused.
      userId = await findUserIdByEmail(admin, email)
      if (!userId) return json({ error: createErr.message }, 400)

      const { data: links } = await admin
        .from('resort_staff')
        .select('id, resort_id')
        .eq('user_id', userId)

      const sameResort = (links ?? []).find((r: { resort_id: string }) => r.resort_id === resort_id)
      if (sameResort) {
        return json({ error: 'USERNAME_IN_USE' }, 400)
      }
      if ((links ?? []).length > 0) {
        return json({ error: 'USERNAME_IN_USE' }, 400)
      }

      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { username: uname },
      })
      if (updErr) return json({ error: updErr.message }, 400)
    } else if (createErr) {
      return json({ error: createErr.message }, 400)
    }

    if (!userId) return json({ error: 'USER_CREATE_FAILED' }, 500)

    const { error: linkErr } = await admin
      .from('resort_staff')
      .insert({ resort_id, user_id: userId, role, username: uname })
    if (linkErr) {
      // Only roll back auth user if we just created it (no prior staff links).
      const { data: remaining } = await admin
        .from('resort_staff')
        .select('id')
        .eq('user_id', userId)
      if (!remaining?.length && !createErr) {
        await admin.auth.admin.deleteUser(userId)
      }
      return json({ error: linkErr.message }, 400)
    }

    return json({ ok: true, username: uname, role, resort_id })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
