/**
 * Your copies of system prompt sections.
 *
 * Harness assembles the system prompt from named sections contributed by its plugins. The Instructions page lets the
 * user edit any one of them: Open saves a copy of Harness's current text for that section in
 * `<harness home>/harness-studio/system-prompt/<section>.md` and opens it in the text editor, and from then on that
 * copy is sent in place of Harness's text; Reset deletes the copy and Harness's text comes back.
 *
 *   - Only sections with a copy change: every other section, plan mode's rules and agent presets keep coming from
 *     Harness, so its updates still reach them.
 *   - A copy keeps the section's place and its `{{name}}` variables, so `{{model}}` is still filled in.
 *   - Subagents keep their own prompt, as with Your additions.
 *   - Harness's text at the moment of the copy is kept in `.harness/<section>.md` beside it. A copy still equal to
 *     that text is not an edit: it is not sent, not shown as the user's, and Open refreshes it to Harness's current
 *     text, so opening a section to read it never freezes it. The record also lets a later version tell the user
 *     when Harness has changed a section they edited.
 *   - Copies are read on each assembly, so a saved edit applies from the next request.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const SECTION_COPIES_DIR = path.join('harness-studio', 'system-prompt')
const ORIGINALS = '.harness'

/** The file name for a section: its name with `/` and other unsafe characters replaced. */
export function sectionFileName(name) {
  return `${name.replace(/[^A-Za-z0-9._:-]+/g, '--')}.md`
}

/**
 * Swap in the copy for each section that has one.
 * @param {{ sections: { name: string, text: string, interpolate?: boolean }[] }} assembly
 * @param {Map<string, string>} copies - section name to the user's text.
 */
export function applySectionCopies(assembly, copies) {
  if (copies.size === 0) return assembly
  return { ...assembly, sections: assembly.sections.map(section => (copies.has(section.name) ? { ...section, text: copies.get(section.name) } : section)) }
}

/**
 * The copies folder and its part in prompt assembly.
 * @param {{ home: string, skip?: (name: string) => boolean }} options - `skip` names sections that cannot be copied,
 *   such as Your additions.
 */
export function createSectionCopies({ home, skip = () => false }) {
  const dir = path.join(home, SECTION_COPIES_DIR)
  /** Harness's text of each section as last assembled, before any copy replaced it. */
  const harnessText = new Map()

  const readOptional = file => readFile(file, 'utf8').catch(error => (error.code === 'ENOENT' ? undefined : Promise.reject(error)))

  /** Section name to the user's text, for every copy on disk that differs from the Harness text it was made from. */
  async function copies(names) {
    const files = new Set(await readdir(dir).catch(error => (error.code === 'ENOENT' ? [] : Promise.reject(error))))
    const found = new Map()
    for (const name of names) {
      const file = sectionFileName(name)
      if (!files.has(file)) continue
      const text = await readOptional(path.join(dir, file))
      if (text === undefined || text === await readOptional(path.join(dir, ORIGINALS, file))) continue
      found.set(name, text)
    }
    return found
  }

  return {
    dir,
    fileFor: name => path.join(dir, sectionFileName(name)),
    /**
     * `system-prompt/assemble` listener: remember Harness's text for each section, then swap in the copies.
     * @param {object} assembly
     * @param {{ agent?: { session?: { header?: { origin?: string } } } } | undefined} context
     * @param {() => Promise<object>} [next]
     */
    async apply(assembly, context, next) {
      const result = next === undefined ? assembly : await next()
      if (context?.agent?.session?.header?.origin === 'subagent') return result
      const names = result.sections.map(section => section.name).filter(name => !skip(name))
      for (const section of result.sections) if (!skip(section.name)) harnessText.set(section.name, section.text)
      return applySectionCopies(result, await copies(names))
    },
    /** Names of the sections that currently have a copy. */
    async edited(names) {
      return new Set((await copies(names)).keys())
    },
    /**
     * Make the copy for a section from Harness's text as last assembled, when there is none yet or the one there is
     * still unedited; an edited copy is left as it is.
     * @returns {Promise<string>} the copy's path.
     */
    async ensure(name) {
      if (skip(name) || !harnessText.has(name)) throw new Error('That section is not in the system prompt')
      const file = path.join(dir, sectionFileName(name))
      const record = path.join(dir, ORIGINALS, sectionFileName(name))
      const current = await readOptional(file)
      if (current !== undefined && current !== await readOptional(record)) return file
      const original = harnessText.get(name)
      await mkdir(path.join(dir, ORIGINALS), { recursive: true })
      await writeFile(record, original, 'utf8')
      await writeFile(file, original, 'utf8')
      return file
    },
    /** Delete a section's copy, so Harness's text is sent again. */
    async reset(name) {
      for (const file of [path.join(dir, sectionFileName(name)), path.join(dir, ORIGINALS, sectionFileName(name))]) {
        await unlink(file).catch(error => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    },
  }
}
