// assets/chat-stream.js
// Bind to an existing chat form without creating a new UI.
// We try a few common selectors so you don’t have to rename your DOM.

const form = document.querySelector('#chat-form, form.chat, form[data-chat], .chat-form');
const input = document.querySelector('#chat-input, input.chat-input, input[name="message"], textarea.chat-input, textarea[name="message"]');
const log   = document.querySelector('#chat-log, .chat-log, .messages, .chat-messages, .chat-history');

if (!form || !input || !log) {
  console.error('[chat-stream] Missing elements.',
    { form: !!form, input: !!input, log: !!log },
    'Match your existing IDs/classes to one of the selectors above or tweak them here.');
}

// Helpers
function bubble(role, text) {
  const wrap = document.createElement('div');
  wrap.className = role === 'user' ? 'msg user' : 'msg assistant';
  wrap.style.margin = '6px 0';
  wrap.style.textAlign = role === 'user' ? 'right' : 'left';
  const span = document.createElement('span');
  span.textContent = text;
  span.style.display = 'inline-block';
  span.style.padding = '6px 10px';
  span.style.borderRadius = '12px';
  span.style.background = role === 'user' ? '#eee' : '#e6f0ff';
  wrap.appendChild(span);
  log?.appendChild(wrap);
  if (log) log.scrollTop = log.scrollHeight;
  return span;
}

async function sendStream(messages, { system } = {}, onDelta) {
  const r = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system }),
  });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.delta) { full += payload.delta; onDelta?.(payload.delta, full); }
      if (payload.done) return full;
      if (payload.error) throw new Error(payload.error);
    }
  }
  return full;
}

// Keep conversation so replies are contextual
const history = [];

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = (input?.value || '').trim();
  if (!text) return;

  // append user's message
  bubble('user', text);
  history.push({ role: 'user', content: text });
  if (input) input.value = '';

  // live-updating assistant bubble
  const live = bubble('assistant', '');
  try {
    const full = await sendStream(
      history,
      { system: 'Be a helpful DJ assistant' },
      (_delta, whole) => { if (live) live.textContent = whole; log && (log.scrollTop = log.scrollHeight); }
    );
    history.push({ role: 'assistant', content: full });
  } catch (err) {
    if (live) live.textContent = '(error: ' + (err.message || 'server_error') + ')';
    console.error(err);
  }
});
