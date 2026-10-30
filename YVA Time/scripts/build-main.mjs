// Bundles the Electron main process and the preload script (Supabase client included),
// so the installed app needs no node_modules.
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'warning',
}

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs' })
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs' })
