// Minimal MCP stdio server for tests: tools echo, add and picture.
import { createInterface } from 'node:readline'
const out = m => process.stdout.write(JSON.stringify(m) + '\n')
const tools = [
  { name: 'echo', description: 'Echo the given text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'add', description: 'Add two numbers.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'picture', description: 'Return a 1x1 PNG.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } },
]
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// STDIO_MANY_TOOLS=n adds n more tools, to test connectors whose tools are held back.
for (let i = 1; i <= Number(process.env.STDIO_MANY_TOOLS || 0); i++) {
  tools.push({ name: `extra_${i}`, description: i === 7 ? 'Create an issue in the tracker.' : `Extra tool number ${i}.`, inputSchema: { type: 'object', properties: {} } })
}
process.stderr.write('stdio test server started\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'stdio-test', version: '1.0.0' }, instructions: 'Test server.' } })
  else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools } })
  else if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params
    if (name === 'echo') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + a.text }] } })
    else if (name === 'picture') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'image', data: PNG, mimeType: 'image/png' }, { type: 'text', text: 'A dot.' }] } })
    else if (name === 'add') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(a.a + a.b) }] } })
    else if (name.startsWith('extra_')) out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ran ' + name }] } })
    else out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'unknown tool' }] } })
  } else if ('id' in m) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } })
})
