import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as jose from 'https://deno.land/x/jose@v5.9.6/index.ts'

const ALLOWED_ORIGINS = new Set([
  'https://resortly.roukify.com',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  'https://127.0.0.1',
  'http://127.0.0.1',
])

type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
}

type PushBody = {
  resort_id?: string
  title?: string
  body?: string
  data?: Record<string, string>
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowOrigin = isAllowedOrigin(origin) ? origin : 'https://resortly.roukify.com'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(headers: Record<string, string>, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? ''
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as ServiceAccount
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null
    return parsed
  } catch {
    return null
  }
}

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const key = await jose.importPKCS8(sa.private_key.replace(/\\n/g, '\n'), 'RS256')
  const assertion = await new jose.SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || 'FCM_TOKEN_FAILED')
  }
  return data.access_token
}

async function sendFcm(
  sa: ServiceAccount,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; stale?: boolean }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          apns: {
            payload: {
              aps: { sound: 'default' },
            },
          },
          android: {
            priority: 'HIGH',
            notification: {
              sound: 'default',
              channelId: 'resortly_alerts',
            },
          },
        },
      }),
    },
  )

  if (res.ok) return { ok: true }

  const errText = await res.text()
  const stale =
    /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(errText) ||
    res.status === 404
  return { ok: false, stale }
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers })
  }

  if (req.method !== 'POST') {
    return json(headers, 405, { error: 'METHOD_NOT_ALLOWED' })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json(headers, 401, { error: 'NOT_AUTHENTICATED' })
    }

    const payload = (await req.json()) as PushBody
    const resortId = payload.resort_id?.trim()
    const title = payload.title?.trim()
    const body = (payload.body ?? '').trim()
    const data = payload.data ?? {}

    if (!resortId || !title) {
      return json(headers, 400, { error: 'BAD_INPUT' })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser()

    if (userError || !user) {
      return json(headers, 401, { error: 'NOT_AUTHENTICATED' })
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Allow resort admin/reception for this resort, or any superadmin.
    const { data: superRow } = await admin
      .from('super_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let canSend = !!superRow
    if (!canSend) {
      const { data: staffRow, error: staffError } = await admin
        .from('resort_staff')
        .select('role')
        .eq('user_id', user.id)
        .eq('resort_id', resortId)
        .in('role', ['admin', 'reception'])
        .maybeSingle()

      if (staffError) {
        return json(headers, 500, { error: 'STAFF_LOOKUP_FAILED', detail: staffError.message })
      }
      canSend = !!staffRow
    }

    if (!canSend) {
      return json(headers, 403, { error: 'FORBIDDEN' })
    }

    const sa = parseServiceAccount()
    if (!sa) {
      return json(headers, 500, { error: 'FCM_NOT_CONFIGURED' })
    }

    const { data: tokens, error: tokenError } = await admin
      .from('device_push_tokens')
      .select('id, token')
      .eq('resort_id', resortId)

    if (tokenError) {
      return json(headers, 500, { error: 'TOKEN_QUERY_FAILED', detail: tokenError.message })
    }

    if (!tokens?.length) {
      return json(headers, 200, { ok: true, sent: 0, stale: 0 })
    }

    const accessToken = await getFcmAccessToken(sa)
    const stringData: Record<string, string> = {}
    for (const [k, v] of Object.entries(data)) {
      stringData[k] = String(v)
    }

    let sent = 0
    const staleIds: string[] = []
    const chunkSize = 25

    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize)
      const results = await Promise.all(
        chunk.map(async (row) => {
          const result = await sendFcm(sa, accessToken, row.token, title, body, stringData)
          return { id: row.id, ...result }
        }),
      )
      for (const r of results) {
        if (r.ok) sent++
        else if (r.stale) staleIds.push(r.id)
      }
    }

    if (staleIds.length) {
      await admin.from('device_push_tokens').delete().in('id', staleIds)
    }

    return json(headers, 200, { ok: true, sent, stale: staleIds.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN'
    return json(headers, 500, { error: 'PUSH_FAILED', detail: message })
  }
})
