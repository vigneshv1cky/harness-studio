/**
 * Running one check. A command goes through Harness's own command runner (the one the bash tool uses),
 * under the sandbox mode and network policy the session has at that moment, with its time limit, output cap,
 * credential scrub and process-group kill. A port is probed with a plain connection to this computer. Files
 * are watched by the operating system and reported in batches.
 */
import { watch as watchPath } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { isIgnoredFolder, isInside, LIMITS } from './logic.js'

/**
 * Run a command watch once.
 * @param {{ resolve: Function, execute: Function }} shell - Harness's command runner.
 * @param {{ command: string, timeout: number }} spec
 * @param {{ cwd: string, sandboxPolicy?: object, signal?: AbortSignal }} options
 * @returns {Promise<import('./logic.js').CheckResult>}
 */
export async function runCommand(shell, spec, { cwd, sandboxPolicy, signal }) {
  try {
    const request = {
      command: spec.command,
      workdir: cwd,
      timeoutMs: spec.timeout * 1000,
      stdoutMaxBytes: LIMITS.outputBytes,
      ...signal ? { signal } : {},
      ...sandboxPolicy ? { sandboxPolicy } : {},
    }
    const result = await (await shell.execute(shell.resolve(request))).result()
    const stdout = trimEnd(result.stdout?.text ?? '')
    const stderr = trimEnd(result.stderr?.text ?? '')
    const output = stderr ? `${stdout}${stdout ? '\n' : ''}[stderr]\n${stderr}` : stdout
    return { exitCode: result.timedOut ? null : result.exitCode, output: output.slice(0, LIMITS.outputBytes), ...result.timedOut ? { error: `timed out after ${spec.timeout}s` } : {} }
  } catch (error) {
    if (signal?.aborted) throw error
    return { exitCode: null, output: '', error: firstLine(error?.message ?? String(error)) }
  }
}

const trimEnd = text => text.replace(/\s+$/, '')
const firstLine = text => text.split('\n')[0].slice(0, 300)

/**
 * Probe a port on this computer: up when something accepts a connection within two seconds. `localhost`
 * tries both address families, since a server may listen on only one.
 */
export async function probePort({ port, host }, { timeoutMs = 2000 } = {}) {
  const hosts = host === 'localhost' ? ['127.0.0.1', '::1'] : [host]
  for (const address of hosts) {
    if (await connects(address, port, timeoutMs)) return { exitCode: 0, output: 'up' }
  }
  return { exitCode: 1, output: 'down' }
}

function connects(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = up => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * Keep a files watch to the session's folder. Watching runs on the Host without the sandbox, so every path,
 * with links resolved, must lie inside the session folder, and none may be, lie inside or hold a path the
 * session's sandbox keeps from being read; otherwise a watch could report the names of files under ~/.ssh.
 * @param {string[]} paths - absolute.
 * @param {{ root: string, deny?: readonly unknown[] }} where - the session folder, and the sandbox's read-deny paths.
 * @returns {Promise<string>} the session folder with links resolved.
 */
export async function confinePaths(paths, { root, deny = [] }) {
  let realRoot
  try {
    realRoot = await realpath(root)
  } catch {
    throw new Error(`the session folder ${root} does not exist`)
  }
  const denied = []
  for (const entry of deny) {
    if (typeof entry !== 'string' || entry === '') continue
    denied.push(path.resolve(entry), await realpath(entry).catch(() => path.resolve(entry)))
  }
  for (const target of paths) {
    let real
    try {
      real = await realpath(target)
    } catch {
      throw new Error(`${target} does not exist`)
    }
    if (!isInside(real, realRoot)) throw new Error(`${target} is outside this session's folder (${root}); a files watch only watches inside it`)
    if ([path.resolve(target), real].some(file => denied.some(d => isInside(file, d) || isInside(d, file)))) {
      throw new Error(`${target} is or holds a path this session's sandbox keeps from being read, so it cannot be watched`)
    }
  }
  return realRoot
}

/**
 * Watch files and folders, calling `onBatch` with the changed paths once events have been quiet for a
 * moment. Folders are watched with everything under them except .git and node_modules. Paths `accept`
 * refuses are dropped before the batch's cap applies, so a burst inside an ignored folder cannot crowd out a
 * real change. Where the system has no recursive watch (Linux, where each folder costs one of a limited
 * number of inotify watches), folders are walked and watched one by one, skipping ignored ones, up to
 * {@link LIMITS.maxWatchedFolders}; folders that appear later are added as they appear.
 * @param {string[]} paths
 * @param {(paths: string[]) => void} onBatch
 * @param {{ quietMs?: number, accept?: (file: string) => boolean, onError?: (error: Error) => void,
 *   onNote?: (message: string) => void, platform?: string, maxFolders?: number }} [options] - `onNote` hears
 *   when the folder limit is reached; `platform` and `maxFolders` are for tests.
 * @returns {Promise<() => void>} a function that stops watching.
 */
export async function watchFiles(paths, onBatch, options = {}) {
  const {
    quietMs = LIMITS.filesQuietMs,
    accept = file => !file.split(/[\\/]/).some(isIgnoredFolder),
    onError,
    onNote,
    platform = process.platform,
    maxFolders = LIMITS.maxWatchedFolders,
  } = options
  const oneByOne = platform === 'linux'
  /** Every watcher, by the path it watches. */
  const watchers = new Map()
  /** The folders asked for, when watched one by one. */
  const requestedFolders = new Set()
  /** The folders watched one by one that were found under a requested folder, which may go away. */
  const found = new Set()
  let stopped = false
  let capped = false
  let changed = new Set()
  let timer
  const flush = () => {
    timer = undefined
    const batch = [...changed]
    changed = new Set()
    if (batch.length) onBatch(batch)
  }
  const record = file => {
    try {
      if (!accept(file)) return
    } catch (error) {
      onError?.(error)
      return
    }
    if (changed.size < LIMITS.maxPaths) changed.add(file)
    clearTimeout(timer)
    timer = setTimeout(flush, quietMs)
    timer.unref?.()
  }
  const close = target => {
    watchers.get(target)?.close()
    watchers.delete(target)
    found.delete(target)
  }
  const add = (target, { folder, recursive }) => {
    const watcher = watchPath(target, { recursive, persistent: false }, (_event, name) => {
      const file = folder ? (name ? path.join(target, String(name)) : target) : target
      record(file)
      if (oneByOne && folder && name) followFolder(file).catch(error => onError?.(error))
    })
    watcher.on('error', error => {
      if (found.has(target)) close(target)
      onError?.(error)
    })
    watchers.set(target, watcher)
  }
  const folderCount = () => found.size + [...requestedFolders].filter(dir => watchers.has(dir)).length

  /** Watch a folder and the folders under it, one by one, skipping ignored ones and stopping at the limit. */
  async function watchTree(top) {
    const queue = [top]
    while (queue.length > 0 && !stopped) {
      const dir = queue.shift()
      if (watchers.has(dir)) continue
      if (folderCount() >= maxFolders) {
        if (!capped) {
          capped = true
          onNote?.(`Only the first ${maxFolders} folders are watched: this system watches folders one at a time, so changes in folders beyond those are not seen. Watch a smaller folder to see them all.`)
        }
        return
      }
      try {
        add(dir, { folder: true, recursive: false })
      } catch (error) {
        if (requestedFolders.has(dir)) throw error
        continue
      }
      if (!requestedFolders.has(dir)) found.add(dir)
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !isIgnoredFolder(entry.name)) queue.push(path.join(dir, entry.name))
      }
    }
  }

  /** A name changed in a folder watched one by one: watch it if it is a new folder, let it go if it went. */
  async function followFolder(file) {
    let info
    try {
      info = await lstat(file)
    } catch {
      for (const target of [...found]) if (isInside(target, file)) close(target)
      return
    }
    if (!stopped && info.isDirectory() && !watchers.has(file) && !isIgnoredFolder(path.basename(file))) await watchTree(file)
  }

  const stop = () => {
    stopped = true
    clearTimeout(timer)
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
  }
  try {
    for (const target of paths) {
      let info
      try {
        info = await stat(target)
      } catch {
        throw new Error(`${target} does not exist`)
      }
      const folder = info.isDirectory()
      if (folder && oneByOne) {
        requestedFolders.add(target)
        await watchTree(target)
      } else {
        add(target, { folder, recursive: folder })
      }
    }
  } catch (error) {
    stop()
    throw error
  }
  return stop
}
