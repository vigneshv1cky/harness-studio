// Starts a long process through the runner, prints its pid and exits without disposing the runner.
import { createRunner } from '../../process.js'

const runner = createRunner()
runner.run('sleep', ['60']).catch(() => {})
setTimeout(() => {
  process.stdout.write(`${runner.live()[0]}\n`)
  process.exit(0)
}, 200)
