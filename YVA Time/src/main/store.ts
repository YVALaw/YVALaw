// Files in the app's data folder (%APPDATA%\YVA Time on Windows).
// Secrets (the login session) are encrypted with Windows DPAPI via Electron safeStorage.
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function dataPath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomic write: a crash mid-write never leaves a half-written file */
export function writeJson(name: string, data: unknown) {
  const file = dataPath(name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data))
  fs.renameSync(`${file}.tmp`, file)
}

export function removeFile(name: string) {
  fs.rmSync(dataPath(name), { force: true })
}

export function readSecret(name: string): string | null {
  try {
    const raw = fs.readFileSync(dataPath(name))
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw)
    return raw.toString('utf8')
  } catch {
    return null
  }
}

export function writeSecret(name: string, value: string | null) {
  if (value === null) { removeFile(name); return }
  const file = dataPath(name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8')
  fs.writeFileSync(`${file}.tmp`, data)
  fs.renameSync(`${file}.tmp`, file)
}
