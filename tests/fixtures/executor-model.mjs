// Controlled Responses stream, not a replacement for the factory model/tool adapter.
export function executorToolResponse(name, args, id, text = '') {
  const call = { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name,
    arguments: JSON.stringify(args), status: 'completed' };
  const events = [
    { type: 'response.created', response: { id: `resp_${id}`, status: 'in_progress' } },
    ...(text ? [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: `msg_${id}`, role: 'assistant', content: [] } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: `msg_${id}`, role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] } },
    ] : []),
    { type: 'response.output_item.added', output_index: text ? 1 : 0, item: { ...call, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: text ? 1 : 0, delta: call.arguments },
    { type: 'response.output_item.done', output_index: text ? 1 : 0, item: call },
    { type: 'response.completed', response: { id: `resp_${id}`, status: 'completed', output: [call],
      usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 } } },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}
