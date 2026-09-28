/**
 * DeepSeek web history → DSH session events.
 *
 * Pure translation, no services: chat.deepseek.com keeps a message's text in
 * `fragments` (`REQUEST` = the human prompt, `RESPONSE` = the answer, `THINK` =
 * the reasoning, `TOOL_SEARCH`/`TOOL_OPEN` = web-search steps), and DSH keeps a
 * session as an append-only event log. This module turns the first into the
 * second for the format generation the running build writes.
 *
 * @module deepseek-web-import/events
 */
import { assistantMessageData, SURFACE_APPEND } from './formats.js'

/** Fragment types carrying text, grouped by the role that owns them. */
const USER_TEXT_FRAGMENTS = new Set(['REQUEST'])
const ASSISTANT_ANSWER_FRAGMENTS = new Set(['RESPONSE'])
const ASSISTANT_THINKING_FRAGMENTS = new Set(['THINK'])

/** Appended when a generation produced no text at all, so no turn looks empty. */
export const EMPTY_ANSWER_NOTE = '（这条回复在 DeepSeek 网页端没有正文）'

/**
 * Concatenate the `content` of one message's fragments of the wanted types.
 * @param {object} message - one DeepSeek history message.
 * @param {Set<string>} wanted - fragment type names to keep, upper case.
 * @returns {string} the joined text, empty when nothing matches.
 */
export function fragmentText(message, wanted) {
  const fragments = message && Array.isArray(message.fragments) ? message.fragments : null
  if (fragments === null) return ''
  return fragments
    .filter((f) => f && typeof f.content === 'string' && wanted.has(String(f.type || '').toUpperCase()))
    .map((f) => f.content.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/**
 * Flatten a legacy `content` field, accepted as a fallback for responses that
 * carry text outside `fragments`.
 * @param {unknown} content - raw `content` value of one message.
 * @returns {string} the flattened text.
 */
export function legacyText(content) {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') return block
      if (block && typeof block.text === 'string') return block.text
      if (block && typeof block.content === 'string') return block.content
      return ''
    }).join('\n')
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text
    if (typeof content.content === 'string') return content.content
  }
  return String(content)
}

/**
 * One message's wall-clock time in epoch milliseconds, when the API reported one.
 * @param {object} message - one DeepSeek history message.
 * @param {number} fallback - value to use when `inserted_at` is absent.
 * @returns {number} epoch milliseconds.
 */
export function messageTime(message, fallback) {
  const seconds = message ? Number(message.inserted_at) : NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  const millis = Math.round(seconds * 1000)
  return Number.isSafeInteger(millis) && millis >= 0 ? millis : fallback
}

/**
 * Read one DeepSeek history message into DSH content blocks.
 * @param {object} message - one DeepSeek history message.
 * @param {string} role - lower-cased role.
 * @returns {object[]} DSH content blocks (`text`, and `reasoning` for answers).
 */
export function messageBlocks(message, role) {
  if (role === 'user') {
    const text = fragmentText(message, USER_TEXT_FRAGMENTS) || legacyText(message.content)
    return [{ type: 'text', text }]
  }
  const reasoning = fragmentText(message, ASSISTANT_THINKING_FRAGMENTS)
  const answer = fragmentText(message, ASSISTANT_ANSWER_FRAGMENTS) || legacyText(message.content)
  const blocks = []
  if (reasoning.length > 0) blocks.push({ type: 'reasoning', text: reasoning })
  if (answer.length > 0) blocks.push({ type: 'text', text: answer })
  if (blocks.length === 0) blocks.push({ type: 'text', text: EMPTY_ANSWER_NOTE })
  return blocks
}

/**
 * Whether one DeepSeek message would contribute anything to the imported log.
 * @param {object} message - one DeepSeek history message.
 * @returns {boolean} true when the message carries text or reasoning.
 */
export function isImportableMessage(message) {
  const role = String((message && message.role) || '').toLowerCase()
  return messageBlocks(message || {}, role).some((block) => block.text.trim().length > 0)
}

/**
 * Translate one DeepSeek conversation into a legal DSH session log:
 * `turn/start → user/message → step/start → assistant/message → step/end →
 * turn/end`, surface events carrying `surfaceOp: "append"`, with a leading
 * `session/title` and the closing `session/end-seed` marker that classifies
 * everything before it as imported (seed) history.
 * @param {object[]} messages - DeepSeek history messages, oldest first.
 * @param {string} title - the DeepSeek conversation title.
 * @param {import('./formats.js').FormatProfile} profile - format being written.
 * @returns {object[]} contiguous events from seq 0.
 */
export function buildSessionEvents(messages, title, profile) {
  const events = []
  let seq = 0
  let turn = 0
  let openStep = false
  const base = Date.now()
  let lastTime = base
  const push = (type, data, surfaceOp, time) => {
    const at = Math.max(Number.isSafeInteger(time) ? time : base + seq, lastTime)
    lastTime = at
    const event = { type, seq, time: at, data }
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp
    events.push(event)
    seq += 1
  }
  push('session/title', { title: String(title || 'DeepSeek 导入对话'), messageSeqs: [], source: { kind: 'user' } })
  ;(messages || []).forEach((message) => {
    const role = String((message && message.role) || '').toLowerCase()
    const blocks = messageBlocks(message || {}, role)
    const time = messageTime(message, base + seq)
    if (role === 'user') {
      if (openStep) {
        push('step/end', { turn, step: 1 }, undefined, time)
        push('turn/end', { turn, reason: { kind: 'completed' } }, undefined, time)
        openStep = false
      }
      turn += 1
      push('turn/start', { turn }, undefined, time)
      push('user/message', { id: 'msg-' + turn + '-u', role: 'user', content: blocks, source: { kind: 'user' } }, SURFACE_APPEND, time)
      push('step/start', { turn, step: 1 }, undefined, time)
      openStep = true
    } else {
      if (!openStep) {
        turn += 1
        push('turn/start', { turn }, undefined, time)
        push('step/start', { turn, step: 1 }, undefined, time)
        openStep = true
      }
      push('assistant/message', assistantMessageData(profile, {
        turn,
        step: 1,
        message: {
          id: 'msg-' + turn + '-a',
          role: 'assistant',
          content: blocks,
          source: { kind: 'model', provider: 'deepseek', model: String((message && message.model) || '') || 'deepseek-chat' },
        },
      }), SURFACE_APPEND, time)
      push('step/end', { turn, step: 1 }, undefined, time)
      push('turn/end', { turn, reason: { kind: 'completed' } }, undefined, time)
      openStep = false
    }
  })
  push('session/end-seed', {}, undefined, lastTime)
  return events
}
