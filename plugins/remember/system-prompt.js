/**
 * Your additions to the system prompt.
 *
 * Harness assembles the system prompt from sections contributed by its plugins: the agent's role, how to use each
 * tool, plan mode's rules when it is on. The Instructions page keeps that prompt as it is and lets the user add text
 * at its end, kept in `<harness home>/harness-studio/system-prompt-additions.md`:
 *
 *   - a `system-prompt/assemble` listener appends one section with the text after every other section, so plan mode,
 *     agent presets and tool guidance keep working, and the additions keep applying when Harness changes its prompt;
 *   - subagents keep their own prompt, which carries the role they were delegated;
 *   - the text is read on each assembly, so a change applies from the next request, and removing the file removes
 *     the section.
 *
 * The file is plain text and may be edited by hand; its hash guards the page's editor against overwriting an edit
 * made elsewhere in the meantime.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const SYSTEM_PROMPT_DIR = 'harness-studio'
export const SYSTEM_PROMPT_NAME = 'system-prompt-additions.md'
export const SYSTEM_PROMPT_SECTION = 'harness-studio/system-prompt-additions'
const MAX_BYTES = 1048576

export const systemPromptPath = home => path.join(home, SYSTEM_PROMPT_DIR, SYSTEM_PROMPT_NAME)
export const contentHash = content => createHash('sha256').update(content).digest('hex')

/**
 * Append the additions as the last section, kept literal so a `{{` in the text is not read as a prompt variable;
 * every other section, and the tools, contexts and variables, are left as assembled.
 */
export function applySystemPromptAdditions(assembly, text) {
  if (typeof text !== 'string' || text.trim() === '') return assembly
  return { ...assembly, sections: [...assembly.sections, { name: SYSTEM_PROMPT_SECTION, text, interpolate: false }] }
}

function checkText(content) {
  if (typeof content !== 'string') throw new Error('Your additions must be text')
  if (content.trim() === '') throw new Error('Your additions are empty; use Remove to take them out of the system prompt')
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Your additions must be under 1 MB')
}

/**
 * The additions file and its coordination with prompt assembly.
 * @param {{ home: string }} options - the Harness home holding `harness-studio/system-prompt-additions.md`.
 */
export function createSystemPromptAdditions({ home }) {
  const file = systemPromptPath(home)
  let cached // { key, value }, keyed by the file's mtime and size so a hand edit is seen

  async function read() {
    const info = await stat(file).catch(() => undefined)
    if (info === undefined) {
      cached = undefined
      return null
    }
    const key = `${info.mtimeMs}:${info.size}`
    if (cached?.key === key) return cached.value
    let content
    try {
      content = await readFile(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') {
        cached = undefined
        return null
      }
      throw error
    }
    const value = { content, hash: contentHash(content) }
    cached = { key, value }
    return value
  }

  return {
    file,
    read,
    /**
     * Append the additions to one assembly, delegating first so every other listener has contributed.
     * @param {object} assembly
     * @param {{ agent?: { session?: { header?: { origin?: string } } } } | undefined} context
     * @param {() => Promise<object>} [next]
     */
    async apply(assembly, context, next) {
      const result = next === undefined ? assembly : await next()
      if (context?.agent?.session?.header?.origin === 'subagent') return result
      const additions = await read()
      return applySystemPromptAdditions(result, additions?.content)
    },
    /**
     * Save text over the version the editor opened. A null hash creates the additions only when none exist;
     * any other hash must match the file, so an edit made elsewhere is never overwritten.
     */
    async write(content, hash) {
      cached = undefined // the hash guard must judge the file as it is now, not a cached read
      const current = await read()
      if (hash === null || hash === undefined) {
        if (current !== null) throw new Error('Your additions changed since you opened them. Reopen them and edit again.')
      } else if (current === null || current.hash !== hash) {
        throw new Error('Your additions changed since you opened them. Reopen them and edit again.')
      }
      checkText(content)
      await mkdir(path.dirname(file), { recursive: true })
      const temp = path.join(path.dirname(file), `.${SYSTEM_PROMPT_NAME}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
      try {
        await writeFile(temp, content, 'utf8')
        await rename(temp, file)
      } catch (error) {
        await unlink(temp).catch(() => undefined)
        throw error
      }
      cached = undefined
      return { content, hash: contentHash(content) }
    },
    /** Remove the additions, leaving Harness's assembled prompt alone. */
    async reset() {
      await unlink(file).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
      cached = undefined
    },
  }
}
