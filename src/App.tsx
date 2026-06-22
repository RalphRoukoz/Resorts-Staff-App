import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [connectionStatus, setConnectionStatus] = useState<
    'checking' | 'connected' | 'error'
  >('checking')

  useEffect(() => {
    let cancelled = false

    async function checkConnection() {
      const { error } = await supabase.auth.getSession()

      if (cancelled) return
      setConnectionStatus(error ? 'error' : 'connected')
    }

    void checkConnection()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-400">
          Resorts Staff App
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Vite + React + Tailwind + Supabase
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
          Your frontend is scaffolded and connected to Supabase. Start building
          staff workflows from <code className="rounded bg-slate-900 px-2 py-1 text-sm text-sky-300">src/App.tsx</code>.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <p className="text-sm font-medium text-slate-400">Supabase connection</p>
          <p className="mt-2 text-lg font-medium">
            {connectionStatus === 'checking' && (
              <span className="text-amber-300">Checking connection...</span>
            )}
            {connectionStatus === 'connected' && (
              <span className="text-emerald-400">Connected</span>
            )}
            {connectionStatus === 'error' && (
              <span className="text-rose-400">Connection failed</span>
            )}
          </p>
          <p className="mt-2 break-all text-sm text-slate-400">
            {import.meta.env.VITE_SUPABASE_URL}
          </p>
        </div>
      </main>
    </div>
  )
}

export default App
