import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { BOARD_POLICY, BOARD_RUNTIME, findRuntime, listBoards, prepareBoard, readBoard } from '../board.js'

let cwd
before(async () => { cwd = await mkdtemp(path.join(tmpdir(), 'hs-boards-')) })
after(async () => { await rm(cwd, { recursive: true, force: true }) })

// The viewer as the first version of the skill wrote it into boards, before the comment markers.
const OLD_RUNTIME = `<style>
  html, body { margin: 0; }
  #hs-board-bar { position: fixed; }
</style>
<div id="hs-board-bar"><b id="hs-board-title"></b></div>
<div id="hs-board-stage"></div>
<script>
(() => {
  // Harness Studio design board: each <template data-screen> becomes one row of artboards
  const stage = document.getElementById('hs-board-stage')
})()
</script>`
const board = runtime => `<!doctype html>
<html><head><meta charset="utf-8"><title>Habit settings</title></head>
<body>
<template data-shared><style>:root { --accent: #0a7; }</style></template>
<template data-screen="Home: compact list"><main>Hi</main></template>
${runtime}
</body></html>
`

test('the Design pane carries the same viewer the design-board skill writes', () => {
  const skill = readFileSync(new URL('../../compact/skills/board-runtime.html', import.meta.url), 'utf8').trimEnd()
  assert.equal(BOARD_RUNTIME, skill, 'copy plugins/compact/skills/board-runtime.html to plugins/devpreview/board-runtime.html')
  assert.match(BOARD_RUNTIME, /^<!-- hs-board-runtime: /)
  assert.match(BOARD_RUNTIME, /<!-- \/hs-board-runtime -->$/)
})

test('an older board gets the current viewer, and the screens are left alone', () => {
  const { html, linked } = prepareBoard(board(OLD_RUNTIME))
  assert.equal(linked, true)
  assert.ok(html.includes(BOARD_RUNTIME))
  assert.ok(!html.includes('const stage = document.getElementById(\'hs-board-stage\')\n})()'))
  assert.equal(html.split('Harness Studio design board').length, 2, 'one viewer only')
  assert.ok(html.includes('<template data-screen="Home: compact list"><main>Hi</main></template>'))
})

test('a current board is swapped between its markers, so preparing twice changes nothing more', () => {
  const once = prepareBoard(board(BOARD_RUNTIME)).html
  const markers = findRuntime(once)
  assert.ok(markers)
  assert.equal(once.slice(markers.from, markers.to), BOARD_RUNTIME)
  assert.equal(once.split('<!-- hs-board-runtime:').length, 2)
})

test('a board whose viewer was rewritten is shown as it is, without click-to-reference', () => {
  const custom = board('<script>console.log("my own viewer")</script>')
  const { html, linked } = prepareBoard(custom)
  assert.equal(linked, false)
  assert.ok(html.includes('my own viewer'))
})

test('the policy comes first in the board\'s head and never inside a screen', () => {
  const { html } = prepareBoard(board(OLD_RUNTIME))
  assert.ok(html.startsWith(`<!doctype html>\n<html><head><meta http-equiv="Content-Security-Policy" content="${BOARD_POLICY}">`))
  assert.match(BOARD_POLICY, /connect-src 'none'/)
  assert.match(BOARD_POLICY, /form-action 'none'/)
  const headless = prepareBoard('<!DOCTYPE html>\n<template data-screen="A"><head></head></template>' + OLD_RUNTIME).html
  assert.ok(headless.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"'))
})

test('boards are listed newest first; other files, links and a missing folder are not', async () => {
  assert.deepEqual(await listBoards(cwd), { boards: [] })
  const designs = path.join(cwd, 'designs')
  await mkdir(designs)
  await writeFile(path.join(designs, 'old.board.html'), board(OLD_RUNTIME))
  await writeFile(path.join(designs, 'new.board.html'), board(BOARD_RUNTIME))
  await writeFile(path.join(designs, 'notes.html'), '<p>not a board</p>')
  await utimes(path.join(designs, 'old.board.html'), new Date(1_700_000_000_000), new Date(1_700_000_000_000))
  const outside = path.join(cwd, 'secret.txt')
  await writeFile(outside, 'secret')
  await symlink(outside, path.join(designs, 'link.board.html'))
  const { boards } = await listBoards(cwd)
  assert.deepEqual(boards.map(b => b.name), ['new.board.html', 'old.board.html'])
  assert.ok(boards[0].modified > boards[1].modified && boards[0].size > 0)
})

test('reading a board refuses other names, links and paths out of the folder', async () => {
  const read = await readBoard(cwd, 'old.board.html')
  assert.equal(read.linked, true)
  assert.ok(read.html.includes(BOARD_RUNTIME))
  for (const name of ['../secret.board.html', 'notes.html', '.board.html', null, 'sub/x.board.html']) {
    await assert.rejects(readBoard(cwd, name), error => error.status === 400, String(name))
  }
  await assert.rejects(readBoard(cwd, 'link.board.html'), error => error.status === 404)
  await assert.rejects(readBoard(cwd, 'missing.board.html'), error => error.status === 404)
})

test('a designs folder that is a link is not followed', async () => {
  const other = await mkdtemp(path.join(tmpdir(), 'hs-boards-link-'))
  try {
    await mkdir(path.join(other, 'real'))
    await writeFile(path.join(other, 'real', 'x.board.html'), board(OLD_RUNTIME))
    await symlink(path.join(other, 'real'), path.join(other, 'designs'))
    assert.deepEqual(await listBoards(other), { boards: [] })
    await assert.rejects(readBoard(other, 'x.board.html'), error => error.status === 404)
  } finally {
    await rm(other, { recursive: true, force: true })
  }
})
