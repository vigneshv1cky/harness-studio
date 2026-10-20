import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('the sidebar shows the same version as desktop/VERSION', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const shown = client.match(/const STUDIO_VERSION = '([^']+)'/)?.[1]
  const release = readFileSync(new URL('../../../desktop/VERSION', import.meta.url), 'utf8').trim()
  assert.equal(shown, release)
})
