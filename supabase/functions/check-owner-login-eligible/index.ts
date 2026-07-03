import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = (await req.json()) as { phone?: string }
    const phone = body.phone?.trim()
    if (!phone) {
      return new Response(JSON.stringify({ error: 'BAD_INPUT' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const forwarded = req.headers.get('x-forwarded-for') ?? ''
    const clientIp = forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const ipHash = await sha256Hex(clientIp)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data, error } = await supabase.rpc('check_owner_login_eligible_rate_limited', {
      p_phone: phone,
      p_ip_hash: ipHash,
    })

    if (error) {
      console.error('check_owner_login_eligible_rate_limited', error.message)
      return new Response(JSON.stringify({ error: 'SERVER_ERROR' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const row = data as { eligible?: boolean; error?: string }
    if (row.error === 'RATE_LIMITED') {
      return new Response(JSON.stringify({ eligible: false, rate_limited: true }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ eligible: Boolean(row.eligible) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'SERVER_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
