'use strict'
/**
 * devpreview-source-loader — DEVELOPMENT ONLY.
 *
 * A webpack / Turbopack loader for .jsx/.tsx files that adds
 *   data-src={"<project-relative path>:<line>:<column>"}
 * to every JSX host element (lowercase tags such as <div>, <button>), so the Harness Studio
 * companion script can tell the Browser pane exactly where a clicked element is written.
 * The value is a JSX expression holding a JSON string, so any character in a path is safe.
 *
 * Components (<Card>), member tags (<motion.div>), fragments and elements that already carry
 * data-src are left untouched. The output stays JSX/TSX; the framework's own compiler runs after.
 * Insertions never add lines, and an incoming source map is carried through (its columns are
 * shifted past the inserted text), so earlier loaders' maps still point at the original source.
 *
 * Options:
 *   root      absolute project root used to make paths relative (default: process.cwd())
 *   attribute attribute name (default: 'data-src')
 */
const path = require('node:path')
const { parse } = require('@babel/parser')
const MagicString = require('magic-string').default ?? require('magic-string')
const { decode, encode } = require('@jridgewell/sourcemap-codec')

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'])

/**
 * Visit every node depth-first.
 * @param {object} node - Babel AST node.
 * @param {(node: object) => void} visit - callback per node.
 */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (!SKIP_KEYS.has(key)) walk(node[key], visit)
  }
}

/**
 * Stamp source locations onto JSX host elements.
 * @param {string} source - file contents.
 * @param {string} relativePath - project-relative path written into the attribute.
 * @param {string} attribute - attribute name.
 * @returns {{ code: string, map: object } | undefined} undefined when nothing changed.
 */
function stamp(source, relativePath, attribute) {
  if (!source.includes('<')) return undefined
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'decorators-legacy'],
    errorRecovery: true,
  })
  const out = new MagicString(source)
  /** Insertions as [0-based line, column, inserted length], for chaining an incoming map. */
  const inserts = []
  let changed = false
  walk(ast.program, (node) => {
    if (node.type !== 'JSXOpeningElement') return
    const name = node.name
    if (name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name)) return
    const already = node.attributes.some(attr => attr.type === 'JSXAttribute' && attr.name && attr.name.name === attribute)
    if (already) return
    // Point at the element's opening "<", where editors place an element.
    const { line, column } = node.loc.start
    const text = ` ${attribute}={${JSON.stringify(`${relativePath}:${line}:${column + 1}`)}}`
    out.appendLeft(name.end, text)
    inserts.push([name.loc.end.line - 1, name.loc.end.column, text.length])
    changed = true
  })
  if (!changed) return undefined
  return { code: out.toString(), map: out.generateMap({ hires: true, includeContent: true, source: relativePath }), inserts }
}

/**
 * Chain an incoming source map through the insertions: same sources, with every generated column
 * at or after an insertion point on its line moved right by the inserted length.
 * @param {object | string} inputMap - the previous loader's map (generated = this loader's input).
 * @param {Array<[number, number, number]>} inserts - [line, column, length] per insertion.
 * @returns {object | undefined} the chained map, or undefined when the input map can't be read.
 */
function chainMap(inputMap, inserts) {
  let map = inputMap
  if (typeof map === 'string') { try { map = JSON.parse(map) } catch { return undefined } }
  if (map === null || typeof map !== 'object' || typeof map.mappings !== 'string') return undefined
  const byLine = new Map()
  for (const [line, column, length] of inserts) {
    if (!byLine.has(line)) byLine.set(line, [])
    byLine.get(line).push([column, length])
  }
  const lines = decode(map.mappings)
  for (const [line, shifts] of byLine) {
    const segments = lines[line]
    if (!segments) continue
    for (const segment of segments) {
      const original = segment[0]
      for (const [column, length] of shifts) if (original >= column) segment[0] += length
    }
  }
  return { ...map, mappings: encode(lines) }
}

/**
 * Loader entry point.
 * @this {{ resourcePath: string, getOptions?: () => object, query?: object, callback: Function }}
 * @param {string} source - file contents.
 * @param {object} [inputMap] - incoming source map.
 */
module.exports = function devpreviewSourceLoader(source, inputMap) {
  const options = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {}
  const root = options.root || process.cwd()
  const attribute = options.attribute || 'data-src'
  const relativePath = path.relative(root, this.resourcePath).split(path.sep).join('/')
  if (relativePath.startsWith('..') || relativePath.includes('node_modules/')) {
    this.callback(null, source, inputMap)
    return
  }
  let result
  try {
    result = stamp(source, relativePath, attribute)
  } catch (error) {
    // A file the parser cannot read is passed through unchanged; the real compiler reports it.
    this.callback(null, source, inputMap)
    return
  }
  if (result === undefined) { this.callback(null, source, inputMap); return }
  // With an incoming map, keep pointing at the original source; otherwise this map maps to the input.
  const map = inputMap ? chainMap(inputMap, result.inserts) : undefined
  this.callback(null, result.code, map ?? result.map)
}

module.exports.stamp = stamp
module.exports.chainMap = chainMap
