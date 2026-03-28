import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = (import.meta.env.VITE_SUPABASE_URL  as string) || 'https://rwgteyixmbpaxfebwznb.supabase.co'
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3Z3RleWl4bWJwYXhmZWJ3em5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NTA1NjUsImV4cCI6MjA5MDIyNjU2NX0.sk7sS69bSRoGN8yjX6Jx4cAZ5el0udIRUIxO_e-6Chs'

export const supabase = createClient(supabaseUrl, supabaseAnon)
