const form = document.getElementById("composer");
const input = document.getElementById("input");
const log   = document.getElementById("messages");

if (!form || !input || !log) {
  console.error("[chat-stream] Missing elements", {form:!!form, input:!!input, log:!!log});
}

function addBubble(role, text) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const span = document.createElement("span");
  span.textContent = text;
  row.appendChild(span);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return span;
}

async function askStream(messages, { system } = {}, onDelta) {
  const r = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system }),
  });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.delta) { full += payload.delta; onDelta?.(payload.delta, full); }
      if (payload.done)  return full;
      if (payload.error) throw new Error(payload.error);
    }
  }
  return full;
}

// keep conversation so replies are contextual
const history = [];

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (input?.value || "").trim();
  if (!text) return;

  addBubble("user", text);
  history.push({ role: "user", content: text });
  input.value = "";

  const live = addBubble("assistant", "");
  try {
    const full = await askStream(
      history,
      { system: "Be a helpful DJ assistant" },
      (_delta, whole) => { live.textContent = whole; log.scrollTop = log.scrollHeight; }
    );
    history.push({ role: "assistant", content: full });
  } catch (err) {
    live.textContent = "(error: " + (err.message || "server_error") + ")";
    console.error(err);
  }
});
