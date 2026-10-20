/**
 * The transcribe tool: speech in an audio or video file, or in a time range of it, as text with the time range
 * each piece was said in.
 *
 * Recognition is Harness's local speech service from the Voice Input bundle (SenseVoice small on the CPU, the
 * same recognizer the microphone button uses); nothing leaves the computer. The recognizer takes one complete
 * 16 kHz mono 16-bit WAV per call and returns plain text without time stamps, so:
 *
 *   1. ffmpeg (ffmpeg.js; downloaded on first use) decodes the file or range to raw 16 kHz mono samples in a
 *      temporary folder, sandboxed like the agent's commands, with no network and that folder as the only one it
 *      may write;
 *   2. the samples are cut into pieces of about 30 seconds, each ending at the quietest moment of its last five
 *      seconds so a cut rarely splits a word, and read from disk one piece at a time;
 *   3. each piece goes to the recognizer in turn, and its text is returned with its time range in the file.
 *
 * Memory stays at one piece plus the recognizer's worker, which Harness stops after it has been idle.
 * The first use asks before Harness downloads the recognizer's model (about 241 MB from Hugging Face).
 */
import { randomBytes } from 'node:crypto'
import { open, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shellQuote } from './ffmpeg.js'

export const SAMPLE_RATE = 16000
const BYTES_PER_SECOND = SAMPLE_RATE * 2
export const PIECE_SECONDS = 30
/** The cut is placed at the quietest 100 ms of a piece's last this-many seconds. */
export const SEARCH_SECONDS = 5
const FRAME_BYTES = BYTES_PER_SECOND / 10
/** Longest audio one call transcribes; longer recordings are done a range at a time. */
export const MAX_SECONDS = 3 * 60 * 60
export const LANGUAGES = ['auto', 'zh', 'en', 'yue', 'ja', 'ko']
const DECODE_TIMEOUT_MS = 10 * 60_000
const PREPARE_TIMEOUT_MS = 60 * 60_000
const QUESTION_ID = 'speech-model-download'
const ACCEPT = 'Download'
const DECLINE = 'Not now'
const MODEL_DOWNLOAD = 'about 241 MB'

/** "75.5", "1:10.4" or "1:02:03.5" in seconds; undefined when it is none of those. */
export function parseTime(text) {
  const match = /^\s*(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d+)?)\s*s?\s*$/.exec(String(text ?? ''))
  if (!match) return undefined
  const [, hours, minutes, seconds] = match
  if ((minutes !== undefined || hours !== undefined) && Number(seconds) >= 60) return undefined
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds)
}

/** "1:10.4 to 1:25.0" (the Files tab's marking reference), "1:10.4-1:25" or "70.4 – 85" as [from, to] in seconds. */
export function parseRange(text) {
  const parts = String(text ?? '').split(/\s+to\s+|\s*[-–—]\s*/)
  if (parts.length !== 2) return undefined
  const from = parseTime(parts[0])
  const to = parseTime(parts[1])
  if (from === undefined || to === undefined || to <= from) return undefined
  return [from, to]
}

/** A file argument that is a whole marking reference, "[clip.mp4, 1:10.4 to 1:25.0]", split into file and range. */
export function parseReference(text) {
  const match = /^\s*\[(.+),\s*([^,\]]+\s+to\s+[^,\]]+)\]\s*$/.exec(String(text ?? ''))
  if (!match) return undefined
  const range = parseRange(match[2])
  return range ? { file: match[1].trim(), range } : undefined
}

/** Seconds as the marking bar writes them: minutes and seconds to a tenth, e.g. 1:10.4 or 75:02.0. */
export function clock(seconds) {
  const tenths = Math.round(seconds * 10)
  const minutes = Math.floor(tenths / 600)
  return `${minutes}:${((tenths - minutes * 600) / 10).toFixed(1).padStart(4, '0')}`
}

/** A canonical 44-byte header for 16 kHz mono 16-bit PCM, the only WAV the recognizer accepts. */
export function wavHeader(dataBytes) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(BYTES_PER_SECOND, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

/**
 * Where to end a piece read from `samples` (16-bit little-endian PCM starting at the piece's start): the middle of
 * the quietest 100 ms frame in the last SEARCH_SECONDS of a PIECE_SECONDS window, or the whole buffer when it is
 * not longer than a piece.
 * @param {Buffer} samples
 * @returns {number} bytes in the piece, always even.
 */
export function pieceEnd(samples) {
  const full = PIECE_SECONDS * BYTES_PER_SECOND
  if (samples.length <= full) return samples.length - (samples.length % 2)
  let best = full
  let quietest = Infinity
  for (let frame = full - SEARCH_SECONDS * BYTES_PER_SECOND; frame + FRAME_BYTES <= full; frame += FRAME_BYTES) {
    let energy = 0
    for (let i = frame; i < frame + FRAME_BYTES; i += 2) {
      const sample = samples.readInt16LE(i)
      energy += sample * sample
    }
    if (energy < quietest) {
      quietest = energy
      best = frame + FRAME_BYTES / 2
    }
  }
  return best
}

/**
 * Read a raw PCM file a piece at a time.
 * @param {string} file - raw 16 kHz mono 16-bit little-endian samples.
 * @returns {AsyncGenerator<{ start: number, end: number, samples: Buffer }>} seconds from the file's start.
 */
export async function* pieces(file) {
  const handle = await open(file, 'r')
  try {
    const total = (await handle.stat()).size
    const window = Buffer.alloc(PIECE_SECONDS * BYTES_PER_SECOND + FRAME_BYTES)
    let offset = 0
    while (offset + 1 < total) {
      const { bytesRead } = await handle.read(window, 0, window.length, offset)
      if (bytesRead < 2) break
      const length = pieceEnd(window.subarray(0, bytesRead))
      yield { start: offset / BYTES_PER_SECOND, end: (offset + length) / BYTES_PER_SECOND, samples: Buffer.from(window.subarray(0, length)) }
      offset += length
    }
  } finally {
    await handle.close()
  }
}

/** The ffmpeg command that decodes `input` (or a range of it) to raw samples in `output`. */
export function decodeCommand(ffmpeg, input, output, range) {
  const seek = range ? ` -ss ${range[0].toFixed(3)}` : ''
  const length = range ? ` -t ${(range[1] - range[0]).toFixed(3)}` : ` -t ${MAX_SECONDS}`
  return `${shellQuote(ffmpeg)} -nostdin -hide_banner -loglevel error -y${seek} -i ${shellQuote(input)}${length} -map 0:a:0 -vn -ac 1 -ar ${SAMPLE_RATE} -c:a pcm_s16le -f s16le ${shellQuote(output)}`
}

const lastLines = (text, n = 8) => String(text ?? '').trim().split('\n').slice(-n).join('\n').slice(0, 1500)

/**
 * The transcribe tool.
 * @param {object} ctx - the Host plugin context.
 * @param {{ ffmpeg: ReturnType<import('./ffmpeg.js').createFfmpeg> }} options
 */
export function createTranscribe(ctx, { ffmpeg }) {
  /** Sessions whose person answered "Not now" to the model download. */
  const declined = new Set()

  async function folderOf(agent, signal) {
    const workingDirectory = ctx.get('workingDirectory')
    if (workingDirectory) {
      try { return await workingDirectory.ensure(agent, signal) } catch { /* fall back to the session's folder */ }
    }
    return agent.session?.header?.cwd ?? process.cwd()
  }

  /** The selected recognizer, prepared; asks before its first download. */
  async function recognizer(agent, signal) {
    const speech = ctx.get('speechToText')
    if (!speech) throw new Error('Speech recognition is off: the Voice Input plugin is switched off on the Plugins page. Ask the user to switch it on to transcribe.')
    const snapshot = speech.snapshot()
    const providerId = snapshot.selection.providerId
    const provider = snapshot.providers.find(p => p.id === providerId)
    if (!provider) throw new Error('No speech recognizer is available.')
    const phase = provider.preparation.phase
    if (phase === 'ready' || phase === 'standby') return { speech, providerId }
    const sessionId = agent.session?.id ?? agent.session?.header?.id
    if (phase === 'unprepared' || phase === 'failed' || phase === 'cancelled') {
      if (declined.has(sessionId)) throw new Error('The user chose not to download the speech model in this session. Do not ask again.')
      const questions = ctx.get('userQuestions')
      if (!questions) throw new Error('The speech model is not downloaded and this Harness cannot ask the user; ask them to download it under Plugins → Voice Input.')
      const answer = await questions.ask({
        agent,
        signal,
        questions: [{
          id: QUESTION_ID,
          header: 'Speech model',
          question: `Transcribing needs the local speech model, downloaded once (SenseVoice small and a voice detector, ${MODEL_DOWNLOAD}, from Hugging Face). Recognition then runs on this computer; no audio is sent anywhere. Download it now?`,
          options: [
            { label: ACCEPT, description: `Download ${MODEL_DOWNLOAD} now; it takes a few minutes.` },
            { label: DECLINE, description: 'Do not download; this session will not ask again.' },
          ],
        }],
      })
      if (answer?.answers?.find(a => a.id === QUESTION_ID)?.selected?.includes(ACCEPT) !== true) {
        declined.add(sessionId)
        throw new Error('The user chose not to download the speech model. Do not ask again in this session.')
      }
    }
    speech.prepare(providerId)
    const watch = new AbortController()
    const stop = () => watch.abort()
    signal?.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, PREPARE_TIMEOUT_MS)
    try {
      for await (const next of speech.follow(watch.signal)) {
        const state = next.providers.find(p => p.id === providerId)?.preparation
        if (state?.phase === 'ready' || state?.phase === 'standby') return { speech, providerId }
        if (state?.phase === 'failed') throw new Error(`The speech model could not be prepared: ${state.message}`)
        if (state?.phase === 'cancelled') throw new Error('Preparing the speech model was cancelled.')
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      watch.abort()
    }
    if (signal?.aborted) throw signal.reason ?? new Error('Cancelled')
    throw new Error('Preparing the speech model took longer than an hour.')
  }

  async function decode(agent, signal, tools, input, range) {
    const shell = ctx.get('shell')
    if (!shell) throw new Error('Harness\'s command runner is not available, so the file cannot be decoded.')
    const temp = await mkdtemp(path.join(os.tmpdir(), 'hs-transcribe-'))
    const output = path.join(temp, `audio-${randomBytes(3).toString('hex')}.pcm`)
    const policies = ctx.get('sandboxPolicy')
    let policy = policies?.resolve({ session: agent.session })
    if (policy?.mode === 'danger-full-access') policy = policies.resolve({ session: agent.session, mode: 'workspace-write' })
    const sandboxPolicy = policy === undefined ? undefined
      : { ...policy, mode: 'workspace-write', workspaceRoot: temp, extraWritable: undefined, network: { mode: 'off' } }
    try {
      const run = await shell.execute(shell.resolve({
        command: decodeCommand(tools.ffmpeg, input, output, range),
        workdir: temp,
        timeoutMs: DECODE_TIMEOUT_MS,
        stdoutMaxBytes: 16 * 1024,
        signal,
        ...sandboxPolicy ? { sandboxPolicy } : {},
      }))
      const result = await run.result()
      if (result.timedOut || result.exitCode !== 0) {
        const message = lastLines(result.stderr?.text || result.stdout?.text)
        if (/matches no streams|does not contain any stream/i.test(message)) throw new Error(`${input} has no audio.`)
        throw new Error(`ffmpeg could not read ${input}${result.timedOut ? ' (it took longer than 10 minutes)' : ''}.\n${message}`)
      }
      return { temp, output }
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function execute(args, exec) {
    const agent = exec.agent
    if (!agent) throw new Error('transcribe needs a session')
    const reference = parseReference(args?.file)
    let file = reference?.file ?? String(args?.file ?? '').trim()
    if (file === '') throw new Error('file is required: the audio or video file, relative to the session folder or absolute')
    let range = reference?.range
    if (args?.range !== undefined && String(args.range).trim() !== '') {
      range = parseRange(args.range)
      if (!range) throw new Error(`range must look like "1:10.4 to 1:25.0" (start before end); got "${args.range}"`)
    }
    if (range && range[1] - range[0] > MAX_SECONDS) throw new Error(`A range can be at most ${MAX_SECONDS / 3600} hours.`)
    const language = args?.language ?? 'auto'
    if (!LANGUAGES.includes(language)) throw new Error(`language must be one of ${LANGUAGES.join(', ')}`)
    const folder = await folderOf(agent, exec.signal)
    const input = path.resolve(folder, file)
    const info = await stat(input).catch(() => undefined)
    if (!info?.isFile()) throw new Error(`${file} is not a file`)

    const { speech, providerId } = await recognizer(agent, exec.signal)
    const tools = await ffmpeg.ensure(agent, exec.signal)
    const { temp, output } = await decode(agent, exec.signal, tools, input, range)
    const offset = range?.[0] ?? 0
    const lines = []
    let audioSeconds = 0
    let inferenceSeconds = 0
    let spoken = 0
    try {
      for await (const piece of pieces(output)) {
        if (exec.signal?.aborted) throw exec.signal.reason ?? new Error('Cancelled')
        const audio = Buffer.concat([wavHeader(piece.samples.length), piece.samples])
        const transcript = await speech.transcribe(speech.resolve({ audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength), providerId, language }), exec.signal ?? new AbortController().signal)
        audioSeconds += transcript.audioSeconds
        inferenceSeconds += transcript.inferenceSeconds
        const text = transcript.text.trim()
        if (text !== '') spoken += 1
        lines.push(`[${clock(offset + piece.start)} to ${clock(offset + piece.end)}] ${text === '' ? '(no speech)' : text}`)
      }
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
    }
    const name = path.relative(folder, input).startsWith('..') ? input : path.relative(folder, input)
    if (lines.length === 0) return `${name}${range ? ` from ${clock(range[0])} to ${clock(range[1])}` : ''} has no audio in that range.`
    const end = offset + audioSeconds
    const header = `Transcript of ${name}, ${clock(offset)} to ${clock(end)} (${lines.length} piece${lines.length === 1 ? '' : 's'}, language ${language}${spoken === 0 ? ', no speech recognized' : ''}; ${audioSeconds.toFixed(1)} s of audio in ${inferenceSeconds.toFixed(1)} s). Times are positions in the file; the recognizer gives no finer timing than each piece.`
    const capped = !range && audioSeconds >= MAX_SECONDS - 1 ? `\nOnly the first ${MAX_SECONDS / 3600} hours were transcribed; call again with a range for the rest.` : ''
    return `${header}\n${lines.join('\n')}${capped}`
  }

  const tool = {
    name: 'transcribe',
    description: 'Transcribe the speech in an audio or video file, or in a time range of it, on this computer. Returns the text in pieces of about 30 seconds, each with the time range it was said in, so you can say where something was said. Use it when the user asks what is said in a recording or video, or refers to a marked part such as "[clip.mp4, 1:10.4 to 1:25.0]"; pass that reference as file, or the range separately. Languages: Chinese, English, Cantonese, Japanese, Korean, or auto. The first use may ask the user to download ffmpeg and the speech model.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The audio or video file, relative to the session folder or absolute; or a whole marking reference like "[clip.mp4, 1:10.4 to 1:25.0]".' },
        range: { type: 'string', description: 'Optional part of the file, e.g. "1:10.4 to 1:25.0" (minutes:seconds, or hours:minutes:seconds). Omit to transcribe the whole file (up to 3 hours).' },
        language: { type: 'string', enum: LANGUAGES, description: 'Spoken language: zh (Chinese), en (English), yue (Cantonese), ja (Japanese), ko (Korean), or auto (default) to detect it.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    execute,
  }

  return { tool, execute, recognizer }
}

/**
 * Register transcribe once Harness's tools are available.
 * @param {object} ctx - the Host plugin context.
 * @param {{ ffmpeg: ReturnType<import('./ffmpeg.js').createFfmpeg> }} options
 */
export function applyTranscribe(ctx, { ffmpeg }) {
  if (typeof ctx.inject !== 'function') return undefined
  const transcribe = createTranscribe(ctx, { ffmpeg })
  const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
  ctx.inject(['tools'], (scope) => {
    scope.effect(() => scope.tools.register({ output: text, ...transcribe.tool }), 'tool transcribe')
  })
  return transcribe
}
