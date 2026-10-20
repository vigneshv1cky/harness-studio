import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STUDIO_SKILLS, applyStudioSkills } from '../studio-skills.js'

test('registers both skills with valid names, routing text and bodies', () => {
  const registered = []
  const ctx = { inject: (deps, fn) => { assert.deepEqual(deps, ['skills']); fn({ skills: { register: s => { registered.push(s); return () => {} } } }) } }
  applyStudioSkills(ctx)
  assert.deepEqual(registered.map(s => s.name), ['design-board', 'native-apps', 'dashboards', 'charts-and-diagrams'])
  for (const skill of registered) {
    assert.match(skill.name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
    assert.ok(skill.description.length > 40 && skill.whenToUse.length > 20)
    assert.ok(skill.content.length > 500)
    assert.equal(skill.source, 'runtime')
  }
})

test('the design board skill carries the board runtime in place of its marker', () => {
  const body = STUDIO_SKILLS[0].content()
  assert.ok(!body.includes('{{BOARD_RUNTIME}}'))
  assert.match(body, /----- board runtime start -----\n<!-- hs-board-runtime: [^\n]*-->\n<style>[\s\S]*<\/script>\n<!-- \/hs-board-runtime -->\n----- board runtime end -----/)
  assert.match(body, /template\[data-screen\]/)
})

test('the dashboards skill carries the dashboard runtime in place of its marker', () => {
  const body = STUDIO_SKILLS.find(s => s.name === 'dashboards').content()
  assert.ok(!body.includes('{{DASHBOARD_RUNTIME}}'))
  assert.match(body, /----- dashboard runtime start -----\n<!-- hs-dashboard-runtime: [^\n]*-->\n<style>[\s\S]*<\/script>\n<!-- \/hs-dashboard-runtime -->\n----- dashboard runtime end -----/)
})

test('a composition without a skill registry is left alone', () => {
  assert.doesNotThrow(() => applyStudioSkills({}))
})
