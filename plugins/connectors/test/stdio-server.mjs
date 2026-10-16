// Minimal MCP stdio server for tests: tools echo and add.
import { createInterface } from 'node:readline'
const out = m => process.stdout.write(JSON.stringify(m) + '\n')
const tools = [
  { name: 'echo', description: 'Echo the given text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'add', description: 'Add two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
]
process.stderr.write('stdio test server started\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'stdio-test', version: '1.0.0' }, instructions: 'Test server.' } })
  else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools } })
  else if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params
    if (name === 'echo') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + a.text }] } })
    else if (name === 'add') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(a.a + a.b) }] } })
    else out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'unknown tool' }] } })
  } else if ('id' in m) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } })
})
