// The client's text helpers, run from src/editor.client.js with the bundled CodeMirror, outside a browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const context = vm.createContext({ window: { __ModuleLoader__: { load() {} } } })
vm.runInContext(`${read('../vendor/codemirror.iife.js')}\n;globalThis.CM = CM`, context)
vm.runInContext(`${read('../src/editor.client.js')}\n;globalThis.helpers = { lineSeparatorOf, textOf, diskUpdate }`, context)
const { CM, helpers: { lineSeparatorOf, textOf, diskUpdate } } = context

function editorState(content) {
  const separators = new CM.Compartment()
  const state = CM.EditorState.create({ doc: content, extensions: separators.of(CM.EditorState.lineSeparator.of(lineSeparatorOf(content))) })
  return { state, separators }
}

test('the line separator is the file\'s first line break', () => {
  assert.equal(lineSeparatorOf('a\r\nb\nc'), '\r\n')
  assert.equal(lineSeparatorOf('a\rb\r\n'), '\r')
  assert.equal(lineSeparatorOf('a\nb\r\n'), '\n')
  assert.equal(lineSeparatorOf('no break'), '\n')
})

test('the editor gives back a CRLF, CR or mixed file exactly, including after an edit', () => {
  for (const content of ['one\r\ntwo\r\n', 'one\rtwo\r', 'one\r\ntwo\nthree\r\n', 'one\ntwo\r\n']) {
    const { state } = editorState(content)
    assert.equal(textOf(state), content)
    const edited = state.update({ changes: { from: 0, insert: 'zero' }, selection: { anchor: 4 } }).state
    assert.equal(textOf(edited), `zero${content}`)
    const enter = edited.update(edited.replaceSelection(edited.lineBreak)).state
    assert.equal(textOf(enter), `zero${lineSeparatorOf(content)}${content}`, 'a new line uses the file\'s line break')
  }
  assert.equal(editorState('a\r\nb').state.doc.toString(), 'a\nb', 'which doc.toString() alone would not')
})

test('a change on disk is applied as one small change, or whole when the line breaks changed', () => {
  const before = 'first\r\nsecond\r\nthird\r\n'
  const { state, separators } = editorState(before)
  assert.equal(diskUpdate(state, before, separators), null)

  const after = 'first\r\nSECOND\r\nthird\r\n'
  const small = diskUpdate(state, after, separators)
  assert.deepEqual([small.changes.from, small.changes.to], [6, 12], 'only the changed word, in document positions')
  assert.equal(textOf(state.update(small).state), after)

  const unix = 'first\nsecond\n'
  const whole = state.update(diskUpdate(state, unix, separators)).state
  assert.equal(textOf(whole), unix)
  assert.equal(whole.lineBreak, '\n')
  assert.equal(whole.doc.lines, 3)

  const mixed = editorState('a\r\nb\nc\r\n')
  for (const next of ['a\r\nb\r\nc\r\n', 'a\nb\r\nc\r\n', 'a\r\nB\nc\r\nd\r\n']) {
    assert.equal(textOf(mixed.state.update(diskUpdate(mixed.state, next, mixed.separators)).state), next)
  }
})
