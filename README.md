# Resorts Staff App

Vite + React + TypeScript + Tailwind CSS frontend connected to Supabase, ready for Vercel deployment.

## Stack

- [Vite](https://vite.dev/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Supabase JS](https://supabase.com/docs/reference/javascript/introduction)

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   Fill in your Supabase project URL and anon/publishable key from the [Supabase dashboard](https://supabase.com/dashboard/project/_/settings/api).

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Build for production:

   ```bash
   npm run build
   ```

## Supabase

The Supabase client lives in `src/lib/supabase.ts` and reads:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Use the publishable key from your Supabase project settings when available.

## Deploy to Vercel

### Option A: Vercel Dashboard

1. Push this repo to GitHub.
2. Import the repository in [Vercel](https://vercel.com/new).
3. Vercel auto-detects Vite. Use these settings if needed:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Add environment variables in **Project Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

When prompted, add the same environment variables for Production, Preview, and Development.

`vercel.json` includes SPA rewrites so client-side routes fall back to `index.html`.

## Project structure

```text
src/
  lib/
    supabase.ts   # Supabase client
  App.tsx         # Root component
  main.tsx        # App entry
  index.css       # Tailwind import
```
