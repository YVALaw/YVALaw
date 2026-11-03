import { createClient } from '@supabase/supabase-js'
import { writeAwareFetch } from './readCache'
import { applyKeepSignedInOnStartup } from './keepSignedIn'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// "Keep me signed in" unticked + the browser/app was closed → forget the saved sign-in before Supabase reads it
applyKeepSignedInOnStartup()

// Writes through this client clear the shared reads (lib/readCache.ts)
export const supabase = createClient(supabaseUrl, supabaseAnon, { global: { fetch: writeAwareFetch } })
