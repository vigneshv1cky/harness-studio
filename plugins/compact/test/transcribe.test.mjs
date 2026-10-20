import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PIECE_SECONDS, SEARCH_SECONDS, applyTranscribe, clock, createTranscribe, decodeCommand, parseRange, parseReference, parseTime, pieceEnd, pieces, wavHeader } from '../transcribe.js'

test('times and ranges are read the way the marking bar writes them', () => {
  assert.equal(parseTime('1:10.4'), 70.4)
  assert.equal(parseTime('75:02.0'), 4502)
  assert.equal(parseTime('1:02:03.5'), 3723.5)
  assert.equal(parseTime('12.5s'), 12.5)
  assert.equal(parseTime('1:75'), undefined)
  assert.equal(parseTime('soon'), undefined)
  assert.deepEqual(parseRange('1:10.4 to 1:25.0'), [70.4, 85])
  assert.deepEqual(parseRange('70.4-85'), [70.4, 85])
  assert.equal(parseRange('1:25.0 to 1:10.4'), undefined)
  assert.deepEqual(parseReference('[clips/talk, part 2.mp4, 1:10.4 to 1:25.0]'), { file: 'clips/talk, part 2.mp4', range: [70.4, 85] })
  assert.equal(parseReference('clip.mp4'), undefined)
  for (const seconds of [0, 9.9, 70.4, 4502]) assert.equal(parseTime(clock(seconds)), seconds)
  assert.equal(clock(70.4), '1:10.4')
  assert.equal(clock(5), '0:05.0')
})

test('the WAV header is the canonical 16 kHz mono 16-bit one the recognizer accepts', () => {
  const data = Buffer.alloc(32000)
  const wav = Buffer.concat([wavHeader(data.length), data])
  // The same checks as Harness's speech service.
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ')
  assert.deepEqual([wav.readUInt32LE(16), wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt32LE(28), wav.readUInt16LE(32), wav.readUInt16LE(34)], [16, 1, 1, 16000, 32000, 2, 16])
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(4), wav.length - 8)
  assert.equal(wav.readUInt32LE(40), wav.length - 44)
})

/** Raw samples: loud everywhere except a quiet tenth of a second starting at `quietAt` seconds. */
function tone(seconds, quietAt = []) {
  const buffer = Buffer.alloc(seconds * 32000)
  for (let i = 0; i < buffer.length / 2; i++) {
    const t = i / 16000
    const quiet = quietAt.some(q => t >= q && t < q + 0.1)
    buffer.writeInt16LE(quiet ? 0 : Math.round(8000 * Math.sin(i / 3)), i * 2)
  }
  return buffer
}

test('pieces end at the quietest moment of their last seconds', () => {
  assert.equal(pieceEnd(tone(10)), 10 * 32000, 'a short recording is one piece')
  const end = pieceEnd(tone(31, [27.2]))
  assert.equal(end, Math.round(27.25 * 32000))
  assert.ok(end >= (PIECE_SECONDS - SEARCH_SECONDS) * 32000 && end <= PIECE_SECONDS * 32000)
})

test('pieces cover the whole recording without gaps, each at most 30 seconds', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-pieces-'))
  try {
    const file = path.join(dir, 'audio.pcm')
    await writeFile(file, tone(70, [26.0, 55.55]))
    const all = []
    for await (const piece of pieces(file)) all.push(piece)
    assert.deepEqual(all.map(p => [p.start, p.end]), [[0, 26.05], [26.05, 55.6], [55.6, 70]])
    for (const piece of all) assert.equal(piece.samples.length, Math.round((piece.end - piece.start) * 32000))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the decode command seeks to the range and writes raw 16 kHz mono samples', () => {
  const command = decodeCommand('/bin/ffmpeg', "/work/it's.mp4", '/tmp/out.pcm', [70.4, 85])
  assert.match(command, /-ss 70\.400 -i '\/work\/it'\\''s\.mp4' -t 14\.600/)
  assert.match(command, /-ac 1 -ar 16000 -c:a pcm_s16le -f s16le '\/tmp\/out\.pcm'$/)
  assert.match(decodeCommand('ffmpeg', 'a.wav', 'o.pcm'), /-t 10800/)
})

function harness({ phase = 'ready', answer = 'Download', seconds = 70 } = {}) {
  const calls = { transcribed: [], asked: [], prepared: 0, commands: [] }
  let state = phase
  const speech = {
    snapshot: () => ({ selection: { providerId: 'sensevoice-local', language: 'auto' }, providers: [{ id: 'sensevoice-local', preparation: { phase: state } }] }),
    prepare: () => { calls.prepared += 1; state = 'ready' },
    async *follow() { yield speech.snapshot() },
    resolve: request => ({ ...request }),
    async transcribe(spec) {
      const audio = Buffer.from(spec.audio)
      const audioSeconds = (audio.length - 44) / 32000
      calls.transcribed.push({ audioSeconds, language: spec.language, header: audio.readUInt32LE(40) === audio.length - 44 })
      return { text: `piece ${calls.transcribed.length}`, audioSeconds, inferenceSeconds: audioSeconds / 20 }
    },
  }
  const shell = {
    resolve: request => request,
    async execute(request) {
      calls.commands.push(request)
      const output = /'([^']+\.pcm)'$/.exec(request.command)[1]
      await writeFile(output, tone(seconds, [26.0, 55.5]))
      return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) }
    },
  }
  const services = {
    speechToText: speech,
    shell,
    sandboxPolicy: { resolve: ({ mode } = {}) => ({ mode: mode ?? 'workspace-write', workspaceRoot: '/work', network: { mode: 'on' } }) },
    userQuestions: { ask: async request => { calls.asked.push(request); return { answers: [{ id: request.questions[0].id, selected: [answer] }] } } },
  }
  const ffmpeg = { ensure: async () => ({ ffmpeg: '/bin/ffmpeg', ffprobe: '/bin/ffprobe', source: 'system' }) }
  return { calls, services, transcribe: createTranscribe({ get: name => services[name] }, { ffmpeg }) }
}

async function inFolder(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hs-transcribe-test-'))
  try {
    await mkdir(path.join(dir, 'clips'))
    await writeFile(path.join(dir, 'clips', 'talk.mp4'), 'video')
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('transcribes a whole file in pieces with their time ranges, decoding without network', () => inFolder(async dir => {
  const { calls, transcribe } = harness()
  const text = await transcribe.execute({ file: 'clips/talk.mp4' }, { agent: { session: { id: 's', header: { cwd: dir } } } })
  assert.match(text, /^Transcript of clips\/talk\.mp4, 0:00\.0 to 1:10\.0 \(3 pieces, language auto;/)
  assert.match(text, /\n\[0:00\.0 to 0:26\.1\] piece 1\n\[0:26\.1 to 0:55\.6\] piece 2\n\[0:55\.6 to 1:10\.0\] piece 3$/)
  assert.ok(calls.transcribed.every(t => t.header && t.audioSeconds <= 30))
  assert.equal(calls.commands[0].sandboxPolicy.network.mode, 'off')
  assert.equal(calls.commands[0].sandboxPolicy.workspaceRoot, calls.commands[0].workdir)
  assert.equal(calls.asked.length, 0)
}))

test('a marked part is transcribed at its place in the file', () => inFolder(async dir => {
  const { calls, transcribe } = harness({ seconds: 14 })
  const text = await transcribe.execute({ file: '[clips/talk.mp4, 1:10.4 to 1:25.0]', language: 'en' }, { agent: { session: { id: 's', header: { cwd: dir } } } })
  assert.match(text, /^Transcript of clips\/talk\.mp4, 1:10\.4 to 1:24\.4 \(1 piece, language en;/)
  assert.match(text, /\n\[1:10\.4 to 1:24\.4\] piece 1$/)
  assert.match(calls.commands[0].command, /-ss 70\.400 .* -t 14\.600/)
  assert.equal(calls.transcribed[0].language, 'en')
  await assert.rejects(transcribe.execute({ file: 'clips/talk.mp4', range: 'later' }, { agent: { session: { id: 's', header: { cwd: dir } } } }), /range must look like/)
  await assert.rejects(transcribe.execute({ file: 'missing.mp3' }, { agent: { session: { id: 's', header: { cwd: dir } } } }), /is not a file/)
}))

test('asks before the speech model is downloaded, once per session when declined', () => inFolder(async dir => {
  const declined = harness({ phase: 'unprepared', answer: 'Not now' })
  const exec = { agent: { session: { id: 's', header: { cwd: dir } } } }
  await assert.rejects(declined.transcribe.execute({ file: 'clips/talk.mp4' }, exec), /chose not to download the speech model/)
  await assert.rejects(declined.transcribe.execute({ file: 'clips/talk.mp4' }, exec), /Do not ask again/)
  assert.equal(declined.calls.asked.length, 1)
  assert.equal(declined.calls.prepared, 0)
  const accepted = harness({ phase: 'unprepared', answer: 'Download' })
  assert.match(await accepted.transcribe.execute({ file: 'clips/talk.mp4' }, exec), /piece 3/)
  assert.match(accepted.calls.asked[0].questions[0].question, /241 MB, from Hugging Face/)
  assert.equal(accepted.calls.prepared, 1)
}))

test('says so when Voice Input is switched off', () => inFolder(async dir => {
  const { services, transcribe } = harness()
  delete services.speechToText
  await assert.rejects(transcribe.execute({ file: 'clips/talk.mp4' }, { agent: { session: { id: 's', header: { cwd: dir } } } }), /Voice Input plugin is switched off/)
}))

test('registers transcribe with Harness\'s tools', () => {
  const registered = []
  const ctx = { get: () => undefined, inject: (deps, fn) => { assert.deepEqual(deps, ['tools']); fn({ effect: make => make(), tools: { register: t => { registered.push(t); return () => {} } } }) } }
  applyTranscribe(ctx, { ffmpeg: {} })
  assert.deepEqual(registered.map(t => t.name), ['transcribe'])
  assert.deepEqual(registered[0].parameters.required, ['file'])
  assert.equal(applyTranscribe({}, { ffmpeg: {} }), undefined)
})
