'use strict';

function send(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function failJson(res, status, error, code) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error, code }));
}

/**
 * Streams an async generator of AI events to the browser as Server-Sent Events.
 * - Errors before the first event become a normal JSON error response (401/429/503...).
 * - Errors mid-stream are sent as an {type:'error'} event.
 * - If the browser disconnects, the upstream OpenAI request is aborted.
 * Works with plain Node http responses and Express alike.
 */
async function streamToClient(res, makeStream) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  let started = false;
  try {
    for await (const event of makeStream(controller.signal)) {
      if (!started) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        started = true;
      }
      send(res, event);
    }
    if (!started) res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return res.end();
    const status = error.status || 502;
    const message = error.status ? error.message : `The AI request failed: ${error.message || 'unknown error'}`;
    if (!started) return failJson(res, status, message, error.name);
    send(res, { type: 'error', error: message });
    res.end();
  }
}

module.exports = { streamToClient };
