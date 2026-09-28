/**
 * Unit tests for the pure translation layers — no DSH install required.
 *
 *   node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSessionEvents,
  fragmentText,
  isImportableMessage,
  messageBlocks,
  messageTime,
} from '../lib/events.js'
import {
  DEFAULT_FORMAT_VERSION,
  KNOWN_FORMAT_VERSIONS,
  assistantMessageData,
  formatProfile,
  sessionHeader,
} from '../lib/formats.js'
import { requiredFormatVersion, isLegacyPersistence, resolveFormatVersion } from '../lib/persistence.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'history.json'), 'utf8'))

test('fragment extraction reads the DeepSeek fragment vocabulary', () => {
  const assistant = fixture[1]
  assert.equal(fragmentText(assistant, new Set(['RESPONSE'])), 'Open the sidebar menu and choose Export.')
  assert.equal(fragmentText(assistant, new Set(['THINK'])), 'The user wants to export a conversation.')
  assert.equal(fragmentText(assistant, new Set(['TOOL_OPEN'])), '')
  assert.equal(fragmentText({ fragments: null }, new Set(['RESPONSE'])), '')
})

test('message blocks keep reasoning and answer apart', () => {
  const user = messageBlocks(fixture[0], 'user')
  assert.deepEqual(user, [{ type: 'text', text: 'How do I export my chat history?' }])
  const assistant = messageBlocks(fixture[1], 'assistant')
  assert.deepEqual(assistant.map((b) => b.type), ['reasoning', 'text'])
  const unfinished = messageBlocks(fixture[5], 'assistant')
  assert.equal(unfinished.length, 1)
  assert.ok(unfinished[0].text.length > 0, 'an unfinished answer still carries a note')
})

test('legacy flat content is still readable', () => {
  assert.equal(
    messageBlocks({ content: [{ type: 'text', text: 'legacy' }] }, 'user')[0].text,
    'legacy',
  )
})

test('timestamps come from inserted_at and are non-decreasing', () => {
  assert.equal(messageTime({ inserted_at: 1700000000 }, 0), 1700000000000)
  assert.equal(messageTime({}, 42), 42)
  const events = buildSessionEvents(fixture, 'title', formatProfile(4))
  const times = events.map((event) => event.time)
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
})

test('the event log is a dense, balanced turn/step bracket', () => {
  const events = buildSessionEvents(fixture, 'title', formatProfile(4))
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index))
  assert.equal(events[0].type, 'session/title')
  assert.equal(events[events.length - 1].type, 'session/end-seed')
  assert.deepEqual(events[events.length - 1].data, {})
  const opens = events.filter((event) => event.type === 'turn/start').length
  const closes = events.filter((event) => event.type === 'turn/end').length
  assert.equal(opens, closes)
  assert.equal(opens, 3, 'three human turns in the fixture')
  for (const event of events) {
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      assert.equal(event.surfaceOp, 'append')
    }
  }
})

test('format profiles shape headers and messages per generation', () => {
  const base = { id: 'session-x', createdAt: 1, cwd: '/tmp/ws' }
  assert.deepEqual(sessionHeader(formatProfile(0), base), { version: 0, id: 'session-x', createdAt: 1, cwd: '/tmp/ws' })
  assert.deepEqual(sessionHeader(formatProfile(1), base), { version: 1, id: 'session-x', createdAt: 1, cwd: '/tmp/ws' })
  assert.equal(sessionHeader(formatProfile(3), base).isSeeded, false)
  assert.equal(sessionHeader(formatProfile(3), base).delegationDepth, undefined)
  assert.equal(sessionHeader(formatProfile(4), base).delegationDepth, 0)
  // v0/v1 have no `stream` field on assistant messages; v2+ require it
  assert.equal('stream' in assistantMessageData(formatProfile(0), { turn: 1 }), false)
  assert.equal('stream' in assistantMessageData(formatProfile(1), { turn: 1 }), false)
  assert.deepEqual(assistantMessageData(formatProfile(4), { turn: 1 }).stream, [])
  // an unknown future version keeps the newest shape and its own number
  assert.equal(formatProfile(9).version, 9)
  assert.equal(formatProfile(9).assistantStream, true)
  assert.equal(formatProfile(9).delegationDepth, true)
})

test('every known format version is writable', () => {
  for (const version of KNOWN_FORMAT_VERSIONS) {
    const events = buildSessionEvents(fixture, 'title', formatProfile(version))
    assert.ok(events.length > 0, `v${version} produced events`)
  }
  assert.equal(DEFAULT_FORMAT_VERSION, KNOWN_FORMAT_VERSIONS[KNOWN_FORMAT_VERSIONS.length - 1])
})

test('a format refusal names the version to retry with', () => {
  assert.equal(requiredFormatVersion(new Error('encodeCurrent requires Session format v4')), 4)
  assert.equal(requiredFormatVersion(new Error('something else')), null)
})

test('version resolution reads both listing shapes', async () => {
  assert.equal(await resolveFormatVersion({ list: async () => [{ header: { version: 4 } }] }), 4)
  assert.equal(await resolveFormatVersion({ list: async () => [{ version: 0, id: 'a' }] }), 0)
  assert.equal(await resolveFormatVersion({ list: async () => { throw new Error('nope') } }), DEFAULT_FORMAT_VERSION)
  // a legacy-shaped service with nothing stored defaults to the v0 era
  assert.equal(await resolveFormatVersion({ list: async () => [], append: async () => {} }), 0)
})

test('legacy persistence is recognised by its surface', () => {
  assert.equal(isLegacyPersistence({ append: async () => {}, create: async () => {} }), true)
  assert.equal(isLegacyPersistence({ open: async () => {}, create: async () => {} }), false)
})

test('unimportable messages are recognisable', () => {
  assert.equal(isImportableMessage(fixture[0]), true)
  assert.equal(isImportableMessage({ role: 'ASSISTANT', fragments: [] }), true, 'placeholder keeps the turn')
})
