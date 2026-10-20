import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createCloudLoginGuard, createCloudLoginsSetting, loginsUsedBy } from '../cloud-logins.js'

const ALL = ['gcloud', 'aws', 'azure', 'kubernetes', 'snowflake', 'databricks', 'postgres', 'mysql']

test('a command uses a login when its CLI starts one of its commands', () => {
  assert.deepEqual(loginsUsedBy('gcloud config list', ALL), ['gcloud'])
  assert.deepEqual(loginsUsedBy('cd infra && sudo -E aws s3 ls | head; kubectl get pods', ALL), ['aws', 'kubernetes'])
  assert.deepEqual(loginsUsedBy('FOO=1 env BAR=2 /usr/local/bin/gsutil ls gs://b', ALL), ['gcloud'])
  assert.deepEqual(loginsUsedBy('echo $(az account show)', ALL), ['azure'])
  assert.deepEqual(loginsUsedBy('time helm list\nbq ls', ALL), ['gcloud', 'kubernetes'])
  assert.deepEqual(loginsUsedBy('echo gcloud is great; grep aws notes.txt', ALL), [])
  assert.deepEqual(loginsUsedBy('gcloud auth list', ['aws']), [])
  assert.deepEqual(loginsUsedBy(undefined, ALL), [])
  assert.deepEqual(loginsUsedBy('PGPASSFILE=x psql -h db -c "select 1" | head; snow connection list && mysqldump app > a.sql; databricks clusters list', ALL), ['snowflake', 'databricks', 'postgres', 'mysql'])
  assert.deepEqual(loginsUsedBy('snowsql -q "select 1"; pg_restore -d app a.dump', ALL), ['snowflake', 'postgres'])
})

test('the setting saves a valid choice and reports which logins exist on this computer', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-cloud-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, '.config', 'gcloud'), { recursive: true })
  await writeFile(path.join(dir, '.pgpass'), 'db:5432:*:me:secret\n')
  const file = path.join(dir, 'harness-studio', 'cloud-logins.json')
  const setting = createCloudLoginsSetting(file, { readFile, writeFile, rename, mkdir, rm, stat, dirname: path.dirname, join: path.join, home: dir })
  const first = await setting.get()
  assert.deepEqual(first.enabled, [])
  assert.deepEqual(first.logins.map(l => [l.id, l.present, l.path]), [
    ['gcloud', true, '~/.config/gcloud'], ['aws', false, '~/.aws'], ['azure', false, '~/.azure'], ['kubernetes', false, '~/.kube'],
    ['snowflake', false, '~/.snowflake, ~/Library/Application Support/snowflake, ~/.config/snowflake'],
    ['databricks', false, '~/.databrickscfg, ~/.databricks'], ['postgres', true, '~/.pgpass, ~/.pg_service.conf'], ['mysql', false, '~/.my.cnf, ~/.mylogin.cnf'],
  ])
  const saved = await setting.set({ enabled: ['kubernetes', 'gcloud'] })
  assert.deepEqual(saved.enabled, ['gcloud', 'kubernetes'])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { enabled: ['gcloud', 'kubernetes'] })
  await assert.rejects(setting.set({ enabled: ['gcp'] }), /enabled must list some of gcloud, aws, azure, kubernetes, snowflake, databricks, postgres, mysql/)
  await assert.rejects(setting.set({ enabled: 'gcloud' }), /enabled must list/)
  await writeFile(file, '{"enabled": "gcloud"}')
  assert.deepEqual(await setting.enabled(), [])
  await writeFile(file, 'not json')
  assert.deepEqual(await setting.enabled(), [])
})

test('the first command using an exposed login asks once per session and per login', async () => {
  let enabled = ['gcloud', 'aws']
  const guard = createCloudLoginGuard({ readEnabled: async () => enabled })
  const allow = async () => ({ kind: 'allow' })
  const session = {}
  const call = (command, extra = {}) => ({ name: 'bash', arguments: { command, ...extra }, agent: { session } })
  const run = async (exec) => {
    const decision = await guard.preExecute(exec, allow)
    if (decision.kind === 'allow') await guard.execute(exec, async () => 'ran')
    return decision
  }
  const first = call('gcloud projects list')
  const asked = await guard.preExecute(first, allow)
  assert.equal(asked.kind, 'ask')
  assert.match(asked.displayReason.en, /your Google Cloud login: gcloud projects list\. Allowing it also lets this session's later gcloud commands run without asking/)
  assert.equal((await guard.preExecute(call('gcloud config list'), allow)).kind, 'ask', 'not approved until the asked call runs')
  await guard.execute(first, async () => 'ran')
  assert.equal((await run(call('gcloud config list'))).kind, 'allow')
  const both = await run(call('gcloud auth list && aws sts get-caller-identity'))
  assert.equal(both.kind, 'ask')
  assert.match(both.displayReason.en, /your AWS login/)
  assert.equal((await run(call('ls -la'))).kind, 'allow')
  assert.equal((await run(call('kubectl get pods'))).kind, 'allow', 'a login not exposed is not asked about; the sandbox hides it')
  assert.equal((await run(call('aws s3 ls', { sandbox_permissions: 'danger-full-access' }))).kind, 'allow', 'escalation asks on its own')
  assert.equal((await run({ ...call('aws s3 ls'), name: 'read' })).kind, 'allow')
  assert.equal((await run({ name: 'bash', arguments: { command: 'aws s3 ls' } })).kind, 'allow', 'no session, nothing to remember')
  const denied = await guard.preExecute(call('aws s3 ls'), async () => ({ kind: 'deny', reason: 'no' }))
  assert.equal(denied.kind, 'deny')
  const other = { name: 'bash', arguments: { command: 'gcloud config list' }, agent: { session: {} } }
  assert.equal((await guard.preExecute(other, allow)).kind, 'ask', 'another session asks again')
  enabled = []
  assert.equal((await run(call('aws s3 ls'))).kind, 'allow')
  await guard.execute({ name: 'bash', arguments: {}, agent: { session } }, async () => 'ran')
})
