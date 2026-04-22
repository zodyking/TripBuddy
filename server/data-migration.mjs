import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const USERS = path.join(LOCAL_DIR, 'users')
const LEGACY_ASSIGNMENT = path.join(LOCAL_DIR, 'assignment.json')
const LEGACY_CRED = path.join(LOCAL_DIR, 'credentials.json')
const LEGACY_DIR = path.join(LOCAL_DIR, 'locations-directory.json')

async function fileExists(f) {
  try {
    await fs.access(f)
    return true
  } catch {
    return false
  }
}

async function copyFileIfTargetMissing(src, dest) {
  if (!(await fileExists(src)) || (await fileExists(dest))) return false
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.copyFile(src, dest)
  return true
}

/**
 * One-time / idempotent: for each account directory, copy legacy global JSON into that account
 * only when the scoped file is missing (preserves per-user data on upgrades).
 */
export async function runDataMigrationOnStartup() {
  if (!(await fileExists(USERS))) return
  const names = await fs.readdir(USERS, { withFileTypes: true })
  for (const d of names) {
    if (!d.isDirectory()) continue
    const accountKey = d.name
    const udir = path.join(USERS, accountKey)
    const scoped = {
      assignment: path.join(udir, 'assignment.json'),
      credentials: path.join(udir, 'credentials.json'),
      directory: path.join(udir, 'locations-directory.json'),
    }
    if (accountKey.length >= 32) {
      await copyFileIfTargetMissing(LEGACY_ASSIGNMENT, scoped.assignment)
      await copyFileIfTargetMissing(LEGACY_CRED, scoped.credentials)
      await copyFileIfTargetMissing(LEGACY_DIR, scoped.directory)
    }
  }
}
