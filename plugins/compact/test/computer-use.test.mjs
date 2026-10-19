import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACTIVE_GRACE_MS, CUA_ENTRY, USER_STOP, createComputerUse } from '../computer-use.js'

function setup({ platform = 'darwin', helper = '/x/dsh-cua-native', value = {} } = {}) {
  let clock = 1000
  const mutations = []
  const descriptor = { ns: CUA_ENTRY, revision: 3, value: { allowedApps: [], refusedApps: ['Terminal'], taskOnlyApps: ['Safari'], ...value } }
  const settings = { describe: () => [descriptor], mutate: async (ns, ops, revision) => { mutations.push({ ns, ops, revision }) } }
  const cancelled = []
  const agents = new Map([['s1', { status: 'running', cancel: reason => cancelled.push(reason) }], ['idle', { status: 'idle', cancel: () => cancelled.push('idle') }]])
  const calls = []
  const computer = createComputerUse({
    platform, helperPath: () => helper, settings: () => settings, agents: () => agents, now: () => clock,
    exec: async (file, args) => { calls.push([file, ...args]); return file === 'open' ? '' : '{"accessibility":true,"screenRecording":false}\n' },
  })
  return { computer, mutations, cancelled, calls, tick: ms => { clock += ms }, descriptor }
}
const exec = (name, sessionId, args) => ({ name, agent: { session: { id: sessionId } }, arguments: args })

test('status reports the helper\'s permissions and the provider\'s lists; other systems are unsupported', async () => {
  const { computer, calls } = setup({ value: { allowedApps: [{ id: 'a'.repeat(64), name: 'TextEdit', executablePath: '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit' }] } })
  const status = await computer.actions.computerStatus()
  assert.deepEqual(status.permissions, { accessibility: true, screenRecording: false })
  assert.deepEqual(status.allowedApps.map(a => a.name), ['TextEdit'])
  assert.deepEqual(status.refusedApps, ['Terminal'])
  assert.deepEqual(calls, [['/x/dsh-cua-native', '--permissions']])
  assert.equal((await setup({ platform: 'linux' }).computer.actions.computerStatus()).supported, false)
  assert.match((await setup({ helper: null }).computer.actions.computerStatus()).permissionError, /not installed/)
})

test('System Settings opens only at the two permission pages', async () => {
  const { computer, calls } = setup()
  await computer.actions.openPermission({ permission: 'screenRecording' })
  assert.match(calls[0][1], /Privacy_ScreenCapture$/)
  await assert.rejects(computer.actions.openPermission({ permission: 'file:///etc' }), /accessibility or screenRecording/)
})

test('an always-allowed app can be removed, and the refused list replaced, through the provider settings', async () => {
  const id = 'b'.repeat(64)
  const { computer, mutations } = setup({ value: { allowedApps: [{ id, name: 'TextEdit', executablePath: '/x' }] } })
  assert.deepEqual(await computer.actions.forgetApp({ id }), { removed: true })
  assert.deepEqual(mutations[0], { ns: CUA_ENTRY, ops: [{ op: 'set', path: ['allowedApps'], value: [] }], revision: 3 })
  assert.deepEqual(await computer.actions.forgetApp({ id: 'c'.repeat(64) }), { removed: false })
  assert.deepEqual((await computer.actions.setRefusedApps({ apps: [' Terminal ', 'Terminal', '', 'Notes'] })).refusedApps, ['Terminal', 'Notes'])
  await assert.rejects(computer.actions.setRefusedApps({ apps: 'Terminal' }), /list of names/)
})

test('a session counts as controlling an app while a call runs and shortly after; Stop cancels its turn', async () => {
  const { computer, cancelled, tick } = setup()
  let release
  const running = computer.execute(exec('cua', 's1', { method: 'getApp', params: { selector: 'TextEdit' } }), () => new Promise(r => { release = r }))
  assert.deepEqual((await computer.actions.computerActivity()).sessions, [{ sessionId: 's1', app: null }])
  release({ value: { appHandle: 'h1', name: 'TextEdit' } })
  await running
  await computer.execute(exec('cua', 's1', { method: 'click', params: { appHandle: 'h1', x: 1, y: 1 } }), async () => ({ value: {} }))
  assert.deepEqual((await computer.actions.computerActivity()).sessions, [{ sessionId: 's1', app: 'TextEdit' }])
  tick(ACTIVE_GRACE_MS + 1)
  assert.deepEqual((await computer.actions.computerActivity()).sessions, [])
  assert.deepEqual(await computer.actions.stopComputer({ sessionId: 's1' }), { stopped: true })
  // The loop records this cause as the turn's end reason; a plain string there left the turn end without a reason.
  assert.deepEqual(cancelled, [{ kind: 'user' }])
  assert.equal(cancelled[0], USER_STOP)
  assert.deepEqual(await computer.actions.stopComputer({ sessionId: 'idle' }), { stopped: false }, 'an idle session has no turn to stop')
  await computer.execute(exec('bash', 's1', {}), async () => 'ok')
  assert.deepEqual((await computer.actions.computerActivity()).sessions, [], 'other tools are not computer use')
})
