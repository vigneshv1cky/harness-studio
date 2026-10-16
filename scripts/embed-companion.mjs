#!/usr/bin/env node
// Copy plugins/devpreview-companion/companion.js into the Dev Preview plugin's client.js, between the
// @companion-start / @companion-end markers, so the Desktop Browser pane can inject it into pages that do
// not load it themselves (live websites). Run after editing the companion:
//
//   node scripts/embed-companion.mjs          # rewrite client.js
//   node scripts/embed-companion.mjs --check  # exit 1 when client.js is out of date
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const companionPath = path.join(root, 'plugins/devpreview-companion/companion.js')
const clientPath = path.join(root, 'plugins/devpreview/client.js')
const START = '/*@companion-start*/'
const END = '/*@companion-end*/'

const companion = readFileSync(companionPath, 'utf8')
const client = readFileSync(clientPath, 'utf8')
const from = client.indexOf(START)
const to = client.indexOf(END)
if (from === -1 || to === -1 || to < from) {
  console.error(`client.js has no ${START} … ${END} markers`)
  process.exit(1)
}
const next = client.slice(0, from + START.length) + JSON.stringify(companion) + client.slice(to)
if (process.argv.includes('--check')) {
  if (next !== client) { console.error('client.js is out of date: run node scripts/embed-companion.mjs'); process.exit(1) }
  console.log('client.js companion is up to date')
} else {
  writeFileSync(clientPath, next)
  console.log(`Embedded ${companion.length} characters of companion.js into client.js`)
}
