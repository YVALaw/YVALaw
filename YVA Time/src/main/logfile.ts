// Keeps a small log file (userData/logs/yva-time.log) so problems can be looked at later:
// console.warn / console.error from the main process are also written there.
// Rotates at 1 MB (the previous file is kept as yva-time.old.log). Menu → "Open log file".
import fs from 'node:fs'
import path from 'node:path'
import { dataPath } from './store'

const MAX_BYTES = 1_000_000

export function logFilePath(): string {
  return dataPath('logs', 'yva-time.log')
}

function write(level: string, args: unknown[]) {
  try {
    const file = logFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'))
    } catch { /* no file yet */ }
    const text = args.map(a => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`)
  } catch { /* logging must never break the app */ }
}

/** Mirror warnings and errors into the log file (call once at startup) */
export function startLogFile(appVersion: string) {
  const original = { warn: console.warn.bind(console), error: console.error.bind(console) }
  console.warn = (...args: unknown[]) => { original.warn(...args); write('WARN', args) }
  console.error = (...args: unknown[]) => { original.error(...args); write('ERROR', args) }
  write('INFO', [`YVA Time ${appVersion} started`])
}

export function logInfo(...args: unknown[]) { write('INFO', args) }
