import { createServer, type ServerResponse } from 'node:http'
import type { Item } from '../src/responses-wire.ts'

export async function serve(handler: (body: Item, response: ServerResponse, path: string) => void) {
  const requests: { body: Item; headers: Record<string, unknown>; path: string }[] = []
  const server = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const part of request) raw += part.toString()
      const body = JSON.parse(raw)
      requests.push({ body, headers: request.headers, path: request.url! })
      handler(body, response, request.url!)
    } catch { response.writeHead(500).end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { url: `http://127.0.0.1:${address.port}/v1`, requests,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
export function completed(output: Item[], id = 'resp_test'): Item {
  return { id, status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
    input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 } } }
}
export function sse(response: ServerResponse, output: Item) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const data = `data: ${JSON.stringify({ type: output.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: output })}\r\n\r\n`
  // Fragment CRLF and UTF-8 independently from SSE frames.
  const bytes = Buffer.from(data)
  for (let offset = 0; offset < bytes.length; offset += 7) response.write(bytes.subarray(offset, offset + 7))
  response.end()
}
export const textItem = (text: string): Item => ({ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] })
