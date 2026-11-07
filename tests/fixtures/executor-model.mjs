// Controlled Anthropic stream, not a replacement for the factory model/tool adapter.
export function executorToolResponse(name, args, id, text = '', outputTokens = 20) {
  const events = [
    { type: 'message_start', message: { id: `msg_${id}`, type: 'message', role: 'assistant', content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
    ...(text ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
    ] : []),
    { type: 'content_block_start', index: text ? 1 : 0, content_block: { type: 'tool_use', id: `call_${id}`, name, input: {} } },
    { type: 'content_block_delta', index: text ? 1 : 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } },
    { type: 'content_block_stop', index: text ? 1 : 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}
