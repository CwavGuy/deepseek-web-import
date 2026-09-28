/**
 * Session-format knowledge across DSH releases.
 *
 * A DSH build writes exactly one Session format version, and this plugin has to
 * write what that build accepts: both the header fields and the event fields a
 * build understands differ per generation. Everything version-dependent lives
 * in this file, so supporting a future v5 is one table entry plus the shape
 * deltas it introduces.
 *
 * Evidence for every row (checked against the published packages of the
 * releases named beside it, see `docs/COMPATIBILITY.md`):
 *
 * | format | released by                      | header                                        | `assistant/message` | persistence API |
 * |--------|----------------------------------|-----------------------------------------------|---------------------|-----------------|
 * | v0     | 0.1.1-rc.2 … 0.1.2-rc.1          | `version,id,createdAt,cwd,seedLength?`        | no `stream`         | legacy          |
 * | v1     | no published build found         | modeled on v0                                 | no `stream`         | legacy          |
 * | v2     | 0.1.3-alpha.2                    | `…,isSeeded` (`seedLength` rejected)          | `stream` required   | handle          |
 * | v3     | 0.1.5-rc.2 … 0.1.6-alpha.2       | as v2                                         | `stream` required   | handle          |
 * | v4     | 0.1.7-rc.2+                      | `…,delegationDepth` required                  | `stream` required   | handle          |
 *
 * @module deepseek-web-import/formats
 */

/** Format versions this plugin knows how to write, oldest first. */
export const KNOWN_FORMAT_VERSIONS = Object.freeze([0, 1, 2, 3, 4])

/**
 * One format profile: everything the writer must know about a generation.
 * @typedef {object} FormatProfile
 * @property {number} version - the format version to stamp.
 * @property {boolean} isSeededFlag - whether the header carries `isSeeded`
 *   (v2+); v0/v1 mark fork lineage with `seedLength` instead, which an
 *   unseeded import never writes.
 * @property {boolean} delegationDepth - whether the header carries
 *   `delegationDepth` explicitly (required by v4, accepted by v2/v3).
 * @property {boolean} assistantStream - whether `assistant/message` carries the
 *   `stream` field (v2+); v0/v1 reject it as an unknown field is not checked,
 *   but the field does not exist there, so it is omitted.
 */

/**
 * Build one profile from its feature flags.
 * @param {number} version - Session format version.
 * @param {boolean} modern - whether the generation has the v2+ shape.
 * @returns {FormatProfile} the frozen profile.
 */
function profile(version, modern) {
  return Object.freeze({
    version,
    isSeededFlag: modern,
    delegationDepth: version >= 4,
    assistantStream: modern,
  })
}

/** Profiles by format version; anything newer than v2 keeps the v2+ shape. */
const PROFILES = Object.freeze({
  0: profile(0, false),
  1: profile(1, false),
  2: profile(2, true),
  3: profile(3, true),
  4: profile(4, true),
})

/**
 * The profile for one format version. An unknown (future) version keeps the
 * newest known shape and is corrected at runtime when the backend refuses it,
 * so a v5 build needs at most a new row above, never a rewrite.
 * @param {number} version - Session format version to write.
 * @returns {FormatProfile} the profile to write with.
 */
export function formatProfile(version) {
  const known = PROFILES[version]
  if (known !== undefined) return known
  return profile(version, version >= 2)
}

/**
 * The newest format version this plugin expects a current build to write.
 * Only a first guess: the backend's own refusal names the version it needs,
 * and existing stored sessions answer first.
 */
export const DEFAULT_FORMAT_VERSION = KNOWN_FORMAT_VERSIONS[KNOWN_FORMAT_VERSIONS.length - 1]

/**
 * The Session header for one import, shaped for the target format.
 * Only fields every generation accepts are written: an unseeded import has no
 * fork lineage, so neither `seedLength` (v0/v1) nor `isSeeded: true` (v2+) is
 * ever needed.
 * @param {FormatProfile} profile - profile of the format being written.
 * @param {{id: string, createdAt: number, cwd: string}} base - identity facts.
 * @returns {object} the header to hand to `sessionPersistence.create`.
 */
export function sessionHeader(profile, base) {
  return {
    version: profile.version,
    id: base.id,
    createdAt: base.createdAt,
    cwd: base.cwd,
    ...profile.isSeededFlag ? { isSeeded: false } : {},
    ...profile.delegationDepth ? { delegationDepth: 0 } : {},
  }
}

/** Message event types whose `surfaceOp: "append"` marker every generation accepts. */
export const SURFACE_APPEND = 'append'

/**
 * Shape one assistant message event's data for the target format.
 * @param {FormatProfile} profile - profile of the format being written.
 * @param {object} data - `{turn, step, message}` built by the event writer.
 * @returns {object} event data valid for that generation.
 */
export function assistantMessageData(profile, data) {
  return profile.assistantStream ? { ...data, stream: [] } : { ...data }
}
