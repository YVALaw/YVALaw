import { createClient } from '@supabase/supabase-js'
import { writeAwareFetch } from './readCache'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// Writes through this client clear the shared reads (lib/readCache.ts)
export const supabase = createClient(supabaseUrl, supabaseAnon, { global: { fetch: writeAwareFetch } })
