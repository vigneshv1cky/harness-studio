import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createNetworkSetting } from '../index.js'

test('the network setting reads as on until saved, and saves what the sandbox policy reads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'compact-net-'))
  try {
    const file = path.join(dir, 'harness-studio', 'network.json')
    const setting = createNetworkSetting(file)
    assert.deepEqual(await setting.get(), { network: 'on', allowedHosts: [], saved: false })
    await setting.set({ network: 'allowlist', allowedHosts: ['pypi.org', '*.github.com'] })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { network: 'allowlist', allowedHosts: ['pypi.org', '*.github.com'] })
    assert.deepEqual(await setting.get(), { network: 'allowlist', allowedHosts: ['pypi.org', '*.github.com'], saved: true })
    await assert.rejects(setting.set({ network: 'sometimes', allowedHosts: [] }), /network must be one of/)
    await assert.rejects(setting.set({ network: 'off', allowedHosts: 'pypi.org' }), /at most 200/)
    await writeFile(file, '{ broken')
    assert.equal((await setting.get()).network, 'on')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('concurrent saves run one at a time, leave a whole file holding the last one, and no temp files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'compact-net-'))
  try {
    const file = path.join(dir, 'harness-studio', 'network.json')
    const setting = createNetworkSetting(file)
    const saves = []
    for (let i = 0; i < 40; i++) {
      const allowedHosts = Array.from({ length: (i % 7) * 20 }, (_, j) => `host-${i}-${j}.example.com`)
      saves.push(setting.set({ network: i % 2 ? 'allowlist' : 'off', allowedHosts }))
    }
    // A failing save in the middle does not stop the ones queued after it.
    saves.push(setting.set({ network: 'bad', allowedHosts: [] }).catch(() => 'rejected'))
    saves.push(setting.set({ network: 'allowlist', allowedHosts: ['pypi.org'] }))
    const results = await Promise.all(saves)
    assert.equal(results.at(-2), 'rejected')
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { network: 'allowlist', allowedHosts: ['pypi.org'] })
    assert.deepEqual(await readdir(path.dirname(file)), ['network.json'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
