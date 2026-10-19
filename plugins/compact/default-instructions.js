/**
 * Harness Studio's default reply style (lead with the outcome, short by default, structured when the content is,
 * faithful about what was checked) ships as the person's own instruction file, so it sits in the Instructions tab
 * as "Global, all projects" where it can be read and edited, instead of hiding in the system prompt. It is written
 * once, at the first start, and only when that file does not exist: a file the person already has is left alone,
 * and one they delete is not written again.
 */
import { constants } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** The default file's contents, shipped beside this module. */
export const DEFAULT_INSTRUCTIONS = new URL('./default-agents.md', import.meta.url)

/**
 * Write the default instruction file into the Harness home the first time Harness Studio starts there.
 * @param {string} home - the Harness home (`~/.harness-studio` in the app).
 * @param {{ copyFile?: typeof copyFile, mkdir?: typeof mkdir, writeFile?: typeof writeFile }} [fs] - file operations, replaceable in tests.
 * @returns {Promise<'written' | 'kept' | 'done-before'>} what happened: the file was written, an existing one was kept, or this ran before.
 */
export async function writeDefaultInstructions(home, fs = {}) {
  const ops = { copyFile, mkdir, writeFile, ...fs }
  const marker = path.join(home, 'harness-studio', 'default-instructions')
  await ops.mkdir(path.dirname(marker), { recursive: true })
  // The marker is created exclusively, so only one start ever gets past this line.
  try {
    await ops.writeFile(marker, 'Harness Studio wrote its default instructions to AGENTS.md here, or found that file already present.\n', { flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') return 'done-before'
    throw error
  }
  try {
    await ops.copyFile(DEFAULT_INSTRUCTIONS, path.join(home, 'AGENTS.md'), constants.COPYFILE_EXCL)
    return 'written'
  } catch (error) {
    if (error?.code === 'EEXIST') return 'kept'
    throw error
  }
}
