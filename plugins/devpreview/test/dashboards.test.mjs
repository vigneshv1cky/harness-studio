import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { DASHBOARD_POLICY, createApprovals, createDashboards, listDashboards, preparePage, snapshotPage } from '../dashboards.js'

let cwd
let home
before(async () => { cwd = await mkdtemp(path.join(tmpdir(), 'hs-dash-')); home = await mkdtemp(path.join(tmpdir(), 'hs-dash-home-')) })
after(async () => { await rm(cwd, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }) })

// Runs the command for real with sh, like Harness's runner would (without the sandbox).
const run = (command, workdir) => new Promise(resolve => {
  execFile('sh', ['-c', command], { cwd: workdir }, (error, stdout, stderr) => resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout, stderr, timedOut: false }))
})

async function makeDashboard(name, files) {
  const dir = path.join(cwd, 'dashboards', name)
  await mkdir(path.join(dir, 'refresh'), { recursive: true })
  await writeFile(path.join(dir, 'dashboard.html'), '<!doctype html><html><head><title>Sales</title></head><body><div id="hs-dashboard-status"></div></body></html>')
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(dir, 'refresh', file), text)
  return dir
}

test('the page gets a policy that keeps its scripts off the network', () => {
  const page = preparePage('<!doctype html><html><head><title>x</title></head><body></body></html>')
  assert.match(page, /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'none'/)
  assert.ok(DASHBOARD_POLICY.includes("form-action 'none'"))
})

test('a snapshot carries the data and cannot break out of its script', () => {
  const html = snapshotPage('<html><head></head><body></body></html>', { data: { a: { value: '</script><script>alert(1)</script>' } }, savedAt: 'now' })
  assert.equal(html.match(/<\/script>/g).length, 1)
  assert.match(html, /window\.hsDashboardSnapshot = \{"data"/)
})

test('nothing runs until the refresh files are approved at their exact content', async () => {
  const dashboards = createDashboards({ approvals: createApprovals(path.join(home, 'approvals.json')) })
  const dir = await makeDashboard('sales', { 'sales.sh': 'cat refresh/rows.json\n', 'rows.json': '{"total": 42}' })
  assert.deepEqual((await listDashboards(cwd)).dashboards.map(d => [d.name, d.title, d.updated]), [['sales', 'Sales', 0]])
  const shown = await dashboards.read(cwd, 'sales')
  assert.deepEqual(shown.sources, ['sales'])
  assert.equal(shown.approval.approved, false)
  assert.deepEqual(shown.approval.files.map(f => f.name), ['rows.json', 'sales.sh'])
  let ran = 0
  const counting = (command, workdir) => { ran++; return run(command, workdir) }
  await assert.rejects(dashboards.refresh({ cwd, name: 'sales', run: counting }), /not approved/)
  await assert.rejects(dashboards.approve(cwd, 'sales', 'f'.repeat(64)), /changed since they were shown/)
  await dashboards.approve(cwd, 'sales', shown.approval.hash)
  const summary = await dashboards.refresh({ cwd, name: 'sales', run: counting })
  assert.deepEqual({ saved: summary.saved, errors: summary.errors }, { saved: 1, errors: {} })
  assert.equal(ran, 1)
  assert.deepEqual((await dashboards.read(cwd, 'sales')).data.sales.value, { total: 42 })
  // Any edit to any refresh file needs a new approval, and the approval file holds only a hash.
  await writeFile(path.join(dir, 'refresh', 'rows.json'), '{"total": 43}')
  assert.equal((await dashboards.read(cwd, 'sales')).approval.approved, false)
  await assert.rejects(dashboards.refresh({ cwd, name: 'sales', run: counting }), /not approved/)
  assert.equal(ran, 1)
  assert.doesNotMatch(await readFile(path.join(home, 'approvals.json'), 'utf8'), /total/)
  await dashboards.revoke(cwd, 'sales')
})

test('failures, non-JSON output, links in refresh/ and a linked data file', async () => {
  const dashboards = createDashboards({ approvals: createApprovals(path.join(home, 'approvals2.json')) })
  const dir = await makeDashboard('ops', { 'good.sh': 'echo "[1,2,3]"\n', 'bad.sh': 'echo nope >&2; exit 3\n', 'text.sh': 'echo hello\n' })
  // A link where data/good.json goes is replaced, never written through.
  await mkdir(path.join(dir, 'data'))
  const outside = path.join(home, 'outside.txt')
  await writeFile(outside, 'keep me')
  await symlink(outside, path.join(dir, 'data', 'good.json'))
  await dashboards.approve(cwd, 'ops', (await dashboards.read(cwd, 'ops')).approval.hash)
  const summary = await dashboards.refresh({ cwd, name: 'ops', run })
  assert.equal(summary.saved, 1)
  assert.match(summary.errors.bad, /exited with 3: nope/)
  assert.match(summary.errors.text, /did not print JSON/)
  assert.equal(await readFile(outside, 'utf8'), 'keep me')
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'data', 'good.json'), 'utf8')), [1, 2, 3])
  await symlink(outside, path.join(dir, 'refresh', 'linked.sh'))
  const read = await dashboards.read(cwd, 'ops')
  assert.match(read.approval.problem, /refresh\/linked\.sh is a link/)
  await assert.rejects(dashboards.refresh({ cwd, name: 'ops', run }), /is a link/)
  await assert.rejects(dashboards.read(cwd, '../ops'), /dashboard folder name/)
})

test('a snapshot is saved in the dashboard\'s snapshots folder', async () => {
  const dashboards = createDashboards({ approvals: createApprovals(path.join(home, 'approvals3.json')), now: () => new Date(2026, 9, 20, 6, 30).getTime() })
  const dir = await makeDashboard('snap', { 'x.sh': 'echo 1\n' })
  await mkdir(path.join(dir, 'data'))
  await writeFile(path.join(dir, 'data', 'x.json'), '7\n')
  const { path: saved } = await dashboards.snapshot(cwd, 'snap')
  assert.equal(saved, 'dashboards/snap/snapshots/snap-2026-10-20-0630.html')
  const html = await readFile(path.join(cwd, saved), 'utf8')
  assert.match(html, /"x":\{"value":7/)
  assert.match(html, /Content-Security-Policy/)
})
