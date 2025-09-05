// assets/chat.js (pure JS module, no <script> tags)

const log  = document.getElementById('chat-log');
const form = document.getElementById('chat-form');
const inp  = document.getElementById('chat-input');

const history = []; // [{ role: "user"|"assistant", content: "..." }]

function addBubble(role, text) {
  const div = document.createElement('div');
  div.style.margin = '6px 0';
  div.style.textAlign = role === 'user' ? 'right' : 'left';
  const bubble = document.createElement('span');
  bubble.textContent = text;
  bubble.style.display = 'inline-block';
  bubble.style.padding = '6px 10px';
  bubble.style.borderRadius = '12px';
  bubble.style.background = role === 'user' ? '#eee' : '#e6f0ff';
  div.appendChild(bubble);
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function askStream(messages, { system } = {}, onDelta) {
  const r = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system }),
  });

  if (!r.ok || !r.body) {
    throw new Error(`HTTP ${r.status}`);
  }

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
      if (payload.done)  return full;
      if (payload.error) throw new Error(payload.error);
    }
  }
  return full;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inp.value.trim();
  if (!text) return;

  // user bubble
  addBubble('user', text);
  history.push({ role: 'user', content: text });
  inp.value = '';

  // assistant bubble (live-updating)
  const live = document.createElement('div');
  live.style.margin = '6px 0';
  live.style.textAlign = 'left';
  const bubble = document.createElement('span');
  bubble.textContent = '';
  bubble.style.display = 'inline-block';
  bubble.style.padding = '6px 10px';
  bubble.style.borderRadius = '12px';
  bubble.style.background = '#e6f0ff';
  live.appendChild(bubble);
  log.appendChild(live);
  log.scrollTop = log.scrollHeight;

  try {
    const full = await askStream(
      history,
      { system: 'Be a helpful DJ assistant' },
      (_delta, whole) => { bubble.textContent = whole; log.scrollTop = log.scrollHeight; }
    );
    history.push({ role: 'assistant', content: full });
  } catch (err) {
    bubble.textContent = '(error: ' + (err.message || 'server_error') + ')';
    console.error(err);
  }
});
