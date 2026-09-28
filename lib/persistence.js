/**
 * Session-persistence write adapter across DSH releases.
 *
 * The durable-session contract changed shape twice, and the plugin has to
 * speak whichever one the running build offers:
 *
 * - **handle era** (format v2+): `create(header)` returns a write handle whose
 *   `append(events)` / `flush()` / `close()` carry the batch, and the backend
 *   validates the header version against its own format catalog.
 * - **legacy era** (format v0/v1): `create(meta)` records metadata and
 *   `append(id, events)` writes the batch; there is no handle, no flush and no
 *   version error to learn from.
 *
 * Both eras are addressed through one small writer object, so the import path
 * never branches on the release it happens to run on.
 *
 * @module deepseek-web-import/persistence
 */
import { DEFAULT_FORMAT_VERSION, formatProfile, sessionHeader } from './formats.js'

/** The header version a refusal names, or null when the failure is something else. */
export function requiredFormatVersion(error) {
  const match = /requires Session format v(\d+)/.exec(String((error && error.message) || error || ''))
  if (match === null) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) && version >= 0 ? version : null
}

/**
 * Whether one persistence service speaks the legacy (v0/v1) contract.
 * Used only to pick the first guess; the shape `create` returns decides.
 * @param {object} persistence - the `sessionPersistence` service.
 * @returns {boolean} true when the service has no handle-based surface.
 */
export function isLegacyPersistence(persistence) {
  return typeof persistence.open !== 'function' && typeof persistence.append === 'function'
}

/**
 * The Session format version this build writes. Stored sessions are the
 * authoritative witness whenever the profile has any — `list()` answers with
 * plain headers in the legacy era and with `{header}` snapshots in the handle
 * era, so both shapes are read. Without a stored session the guess is the
 * era's default, and the handle era corrects it from the backend's refusal.
 * @param {object} persistence - the `sessionPersistence` service.
 * @returns {Promise<number>} the version to stamp.
 */
export async function resolveFormatVersion(persistence) {
  try {
    const listed = await persistence.list()
    for (const item of Array.isArray(listed) ? listed : []) {
      const version = item && item.header ? item.header.version : item ? item.version : undefined
      if (Number.isSafeInteger(version) && version >= 0) return version
    }
  } catch { /* listing is a hint, never a hard dependency */ }
  return isLegacyPersistence(persistence) ? 0 : DEFAULT_FORMAT_VERSION
}

/**
 * One open writer: versions resolved, storage claimed, events ready to stream.
 * @typedef {object} SessionWriter
 * @property {number} version - the format version being written.
 * @property {import('./formats.js').FormatProfile} profile - its shape profile.
 * @property {(events: object[]) => Promise<void>} append - write one contiguous batch.
 * @property {() => Promise<void>} finish - durability barrier for this session.
 * @property {() => Promise<void>} close - release the writer (idempotent).
 */

/**
 * Create one stored session and return the writer that fills it, adapting to
 * both the persistence contract and the format version of the running build.
 * A handle-era backend that refuses the guessed version names the one it needs;
 * that version is retried instead of failing the import.
 * @param {object} persistence - the `sessionPersistence` service.
 * @param {{id: string, createdAt: number, cwd: string}} base - identity facts.
 * @returns {Promise<SessionWriter>} the open writer.
 */
export async function openSessionWriter(persistence, base) {
  let version = await resolveFormatVersion(persistence)
  const tried = new Set()
  let lastError = null
  while (!tried.has(version)) {
    tried.add(version)
    const profile = formatProfile(version)
    let created
    try {
      created = await persistence.create(sessionHeader(profile, base))
    } catch (error) {
      const required = requiredFormatVersion(error)
      if (required === null) throw error
      lastError = error
      version = required
      continue
    }
    const handle = created !== null && typeof created === 'object' && typeof created.append === 'function' ? created : null
    if (handle !== null) {
      return {
        version,
        profile,
        append: (events) => handle.append(events),
        finish: async () => { if (typeof handle.flush === 'function') await handle.flush() },
        close: async () => { if (typeof handle.close === 'function') await handle.close() },
      }
    }
    if (typeof persistence.append === 'function') {
      return {
        version,
        profile,
        append: (events) => persistence.append(base.id, events),
        finish: async () => {},
        close: async () => {},
      }
    }
    throw new Error('sessionPersistence 既没有返回可写句柄，也没有 append 方法')
  }
  throw lastError || new Error('无法确定本版本 DSH 写入的 Session 格式版本')
}

/**
 * Write one whole imported log, closing the writer whatever happens.
 * @param {object} persistence - the `sessionPersistence` service.
 * @param {{id: string, createdAt: number, cwd: string}} base - identity facts.
 * @param {(profile: import('./formats.js').FormatProfile) => object[]} buildEvents - log builder.
 * @returns {Promise<{version: number, eventCount: number}>} what was written.
 */
export async function writeStoredSession(persistence, base, buildEvents) {
  const writer = await openSessionWriter(persistence, base)
  try {
    const events = buildEvents(writer.profile)
    await writer.append(events)
    await writer.finish()
    return { version: writer.version, eventCount: events.length }
  } finally {
    try { await writer.close() } catch { /* the import result already carries the real failure */ }
  }
}
