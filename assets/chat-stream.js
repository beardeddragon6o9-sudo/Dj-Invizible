document.addEventListener("DOMContentLoaded", () => {
  // Try your known IDs first, then fallbacks
  const form  = document.querySelector("#composer, #chat-form, form.chat, form[data-chat], .chat-form, form");
  const input = document.querySelector("#input, #chat-input, input.chat-input, textarea.chat-input, input[name='message'], textarea[name='message'], input[type='text'], textarea");
  let   log   = document.querySelector("#messages, #chat-log, .messages, .chat-messages, .chat-history, [data-messages]");

  if (!form || !input) {
    console.error("[chat-stream] Missing form/input", { form: !!form, input: !!input, log: !!log });
    return;
  }

  // If no messages container, create one right above the form
  if (!log) {
    log = document.createElement("div");
    log.id = "messages";
    log.style.maxHeight = "24rem";
    log.style.overflow = "auto";
    log.style.border = "1px solid #ccc";
    log.style.marginBottom = ".5rem";
    log.style.padding = ".5rem";
    const parent = form.parentNode;
    parent.insertBefore(log, form);
  }

  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;
    row.style.margin = "6px 0";
    row.style.textAlign = role === "user" ? "right" : "left";
    const span = document.createElement("span");
    span.textContent = text;
    span.style.display = "inline-block";
    span.style.padding = "6px 10px";
    span.style.borderRadius = "12px";
    span.style.background = role === "user" ? "#eee" : "#e6f0ff";
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

  // Prevent double handlers from legacy scripts
  let busy = false;
  const history = [];

  // Enter to send, Shift+Enter for newline (if textarea)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && input.tagName !== "TEXTAREA") {
      e.preventDefault();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation?.(); // stop old script.js handlers
    e.stopPropagation?.();
    if (busy) return;

    const text = (input.value || "").trim();
    if (!text) return;

    busy = true;

    addBubble("user", text);
    history.push({ role: "user", content: text });
    input.value = "";

    // keep context short (last 12 turns)
    if (history.length > 24) history.splice(0, history.length - 24);

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
    } finally {
      busy = false;
    }
  });
});
