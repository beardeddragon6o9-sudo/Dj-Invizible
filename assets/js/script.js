// DOM
const panel = document.getElementById('panel');
const closePanel = document.getElementById('close-panel');
const messages = document.getElementById('messages');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const panelTitle = document.getElementById('panel-title');
const bookingPersona = document.getElementById('booking-persona');

const btnInviz = document.getElementById('mascot-invizible');
const btnMav = document.getElementById('mascot-maverick');

// === AI endpoint base (Vercel) ===
const API_BASE   = 'https://dj-invizible.vercel.app';   // no trailing slash
const AI_ENDPOINT = `${API_BASE}/api/chat`;
async function askAI(userText) {
  addMsg(userText, 'user');

  const typing = document.createElement('div');
  typing.className = 'msg bot';
  typing.textContent = '…';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: userText, persona: activePersona })
    });
    const data = await res.json();
    typing.remove();
    speak(data.text || "I'm here.");

    switch ((data.intent || '').toLowerCase()) {
      case 'mixes': routes.mixes(); break;
      case 'shows': routes.shows(); break;
      case 'book':  routes.book();  break;
      case 'about': routes.about(); break;
      case 'contact': routes.contact(); break;
    }
  } catch (err) {
    typing.remove();
    speak("My brain glitched for a sec—try again.");
    console.error(err);
  }
}

// State
let activePersona = 'invizible'; // default landing
const wait = (ms) => new Promise(res => setTimeout(res, ms));

// Utils
function addMsg(text, role='bot'){
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}
function speak(t){ addMsg(t, 'bot'); }

// Greeting (first visit only)
async function greetFirstTime(){
  if (localStorage.getItem('dj_invizible_seen')) return;
  localStorage.setItem('dj_invizible_seen', '1');

  panel.classList.remove('hidden');
  input?.focus();

  speak("Welcome to the digital home of Kelowna’s best DJ and Red Bull national finalist, DJ Invizible.");
  await wait(450);
  speak("I’m DJ Doom, his personal AI assistant. Ask me anything about mixes, shows, bookings, or the story.");
  await wait(450);
  speak("Here for Midnight Maverick’s country vibes? Click above me to summon him to the tables.");
}

// Swap positions (center/top-right) + theme/persona
function applyPersona(persona){
  activePersona = persona;

  // swap classes so positions change: primary <-> secondary
  btnInviz.classList.remove('primary','secondary');
  btnMav.classList.remove('primary','secondary');

  if (persona === 'invizible'){
    btnInviz.classList.add('primary');
    btnMav.classList.add('secondary');
  } else {
    btnMav.classList.add('primary');
    btnInviz.classList.add('secondary');
  }

  // theme toggle
  document.body.classList.toggle('theme-maverick', persona === 'maverick');
  document.body.classList.toggle('theme-invizible', persona === 'invizible');

  // chat panel prep
  panel.classList.remove('hidden'); // ensure open
  messages.innerHTML = ''; // reset chat for clarity
  input?.focus();
  if (bookingPersona) bookingPersona.value = persona;

  // header + hello
  if (persona === 'invizible'){
    panelTitle.textContent = 'DJ INVIZIBLE';
    speak("Back at Invizible’s booth. What can I cue up for you?");
    speak("Need the country set? Click Midnight Maverick above.");
  } else {
    panelTitle.textContent = 'MIDNIGHT MAVERICK';
    speak("🤠 Howdy! Midnight Maverick at your service — country-themed sets, rodeo energy, and boot-stompin’ remixes.");
    speak("Ask about booking, availability, or what the Maverick set includes.");
  }
}

// Events
btnInviz.addEventListener('click', () => applyPersona('invizible'));
btnMav.addEventListener('click', () => applyPersona('maverick'));

closePanel?.addEventListener('click', () => panel.classList.add('hidden'));

// Open panel on load (AI-first) + greet
window.addEventListener('load', () => {
  panel.classList.remove('hidden');
  input?.focus();
  greetFirstTime();
});

// Router (simple demo)
const routes = {
  "mixes": () => speak(activePersona === 'maverick'
    ? "Maverick mixes are heavy on country remixes and boot-scootin’ bass."
    : "Invizible mixes: bass, breaks, turntablism, Red Bull finalist heat."),
  "shows": () => speak("Upcoming shows lineup will appear here once wired."),
  "book": () => speak(`Booking ${activePersona === 'maverick' ? 'Midnight Maverick' : 'DJ Invizible'} — tell me your date, city, and venue.`),
  "about": () => speak(activePersona === 'maverick'
    ? "Midnight Maverick is Invizible’s country-flavored alter ego—high-energy line-dance ready sets."
    : "DJ Invizible blends hip-hop roots with modern bass & breakbeat."),
  "contact": () => speak("Email info@djinvizible.com or tell me what you need.")
};

// Chat submit
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await askAI(text); // <-- sends text to OpenAI endpoint instead of static routes
});
// assets/js/script.js
(() => {
  // ---- Config ----
  const API_ENDPOINT = "/api/chat";        // your Vercel function
  const DEFAULT_PERSONA = "invizible";     // "invizible" | "maverick"
  const MAX_HISTORY_PAIRS = 5;             // last N turns kept in memory

  // ---- State ----
  let persona = DEFAULT_PERSONA;
  let chatHistory = []; // [{role:'user'|'assistant', content:string}, ...]
  let sending = false;

  // ---- DOM helpers ----
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  // ---- Ensure UI exists (use existing if present; otherwise inject widget) ----
  function ensureUI() {
    let chatBody = $("#chat-body");
    let chatInput = $("#chat-input");
    let chatSend = $("#chat-send");
    let personaToggle = document.querySelector('[data-persona-toggle]');

    if (chatBody && chatInput && chatSend) {
      // Optional: wire existing persona toggles if you have them
      const existingMav = document.querySelector('[data-persona="maverick"]');
      const existingInv = document.querySelector('[data-persona="invizible"]');
      if (existingMav) existingMav.addEventListener("click", () => setPersona("maverick"));
      if (existingInv) existingInv.addEventListener("click", () => setPersona("invizible"));
      return { chatBody, chatInput, chatSend, personaToggle };
    }

    // Inject minimal styles (only if we create the widget)
    const style = el("style");
    style.textContent = `
      .invz-widget{position:fixed;bottom:20px;right:20px;z-index:99999;font-family:Inter,system-ui,sans-serif}
      .invz-fab{width:70px;height:70px;border-radius:50%;border:none;background:#9c5cff;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer}
      .invz-panel{position:fixed;bottom:100px;right:20px;width:340px;max-height:70vh;background:#0b0b12;color:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.35);display:none;overflow:hidden}
      .invz-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1)}
      .invz-title{font-weight:600}
      .invz-toggle{display:flex;gap:6px;background:#181827;border-radius:10px;padding:4px}
      .invz-toggle button{background:transparent;border:none;color:#cfd0ff;padding:6px 8px;border-radius:8px;cursor:pointer}
      .invz-toggle button.active{background:#9c5cff;color:white}
      .invz-body{padding:12px;display:flex;flex-direction:column;gap:8px;overflow:auto;max-height:52vh}
      .chat-msg{max-width:75%;padding:8px 12px;border-radius:12px}
      .chat-msg.user{align-self:flex-end;background:#1e1e2e}
      .chat-msg.bot{align-self:flex-start;background:#2d2d3a}
      .chat-msg.loader{display:flex;gap:4px;background:transparent;padding:8px 0}
      .chat-controls{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.1);background:#0b0b12}
      .chat-controls input{flex:1;background:#141424;color:#fff;border:none;border-radius:10px;padding:10px}
      .chat-controls button{border:none;border-radius:10px;padding:10px 12px;background:#9c5cff;color:#fff;cursor:pointer}
      .dot{width:6px;height:6px;background:#9c5cff;border-radius:50%;animation:invz-blink 1s infinite}
      .dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
      @keyframes invz-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
    `;
    document.head.appendChild(style);

    // Floating action button + panel
    const root = el("div", "invz-widget");
    const fab = el("button", "invz-fab");
    fab.setAttribute("aria-label", "Open chat");
    fab.textContent = "💬";
    const panel = el("div", "invz-panel");

    // Header with persona toggle
    const head = el("div", "invz-head");
    const title = el("div", "invz-title");
    title.textContent = "Chat with DJ Invizible";
    const toggle = el("div", "invz-toggle");
    const btnInv = el("button");
    btnInv.textContent = "Invizible";
    btnInv.classList.add("active");
    btnInv.dataset.persona = "invizible";
    const btnMav = el("button");
    btnMav.textContent = "Maverick";
    btnMav.dataset.persona = "maverick";
    toggle.append(btnInv, btnMav);
    head.append(title, toggle);

    // Body + controls
    const bodyDiv = el("div", "invz-body");
    bodyDiv.id = "chat-body";
    const controls = el("div", "chat-controls");
    const input = el("input");
    input.id = "chat-input";
    input.placeholder = "Ask anything…";
    const send = el("button");
    send.id = "chat-send";
    send.textContent = "Send";
    controls.append(input, send);

    panel.append(head, bodyDiv, controls);
    root.append(fab, panel);
    document.body.appendChild(root);

    // Toggle open/close
    fab.addEventListener("click", () => {
      panel.style.display = panel.style.display === "block" ? "none" : "block";
      input.focus();
    });

    // Persona toggle
    toggle.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const p = b.dataset.persona;
      if (!p) return;
      setPersona(p);
      // UI update
      btnInv.classList.toggle("active", p === "invizible");
      btnMav.classList.toggle("active", p === "maverick");
      title.textContent = p === "maverick" ? "Chat with Midnight Maverick" : "Chat with DJ Invizible";
    });

    return { chatBody: bodyDiv, chatInput: input, chatSend: send, personaToggle: toggle };
  }

  // ---- UI behaviors ----
  function setPersona(p) {
    persona = (p || "").toLowerCase() === "maverick" ? "maverick" : "invizible";
    // Optional: clear history when persona switches (keeps tone consistent)
    chatHistory = [];
  }

  function appendMessage(container, content, who = "bot") {
    const row = el("div", `chat-msg ${who}`);
    row.textContent = content;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  function addLoader(container) {
    const row = el("div", "chat-msg loader");
    row.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    return row;
  }

  function trimHistory() {
    // keep last N user/assistant pairs
    let pairs = 0, i = chatHistory.length - 1;
    for (; i >= 0 && pairs < MAX_HISTORY_PAIRS; i--) {
      if (chatHistory[i].role === "user") pairs++;
    }
    if (i > 0) chatHistory = chatHistory.slice(i + 1);
  }

  async function sendMessage(chatBody, chatInput) {
    if (sending) return;
    const msg = (chatInput.value || "").trim();
    if (!msg) return;

    // UI: show user message + loader
    appendMessage(chatBody, msg, "user");
    chatInput.value = "";
    const loader = addLoader(chatBody);
    sending = true;

    try {
      trimHistory();
      const resp = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          messages: [...chatHistory, { role: "user", content: msg }],
        }),
      });

      const data = await resp.json().catch(() => ({}));
      loader.remove();

      if (data && data.ok && data.message) {
        appendMessage(chatBody, data.message, "bot");
        chatHistory.push({ role: "user", content: msg });
        chatHistory.push({ role: "assistant", content: data.message });
      } else {
        appendMessage(chatBody, data?.message || "Out of juice, try again later.", "bot");
      }
    } catch (e) {
      loader.remove();
      appendMessage(chatBody, "Network hiccup. Try again.", "bot");
      console.error("[chat] send failed:", e);
    } finally {
      sending = false;
      chatInput.focus();
    }
  }

  // ---- Boot ----
  function boot() {
    const { chatBody, chatInput, chatSend } = ensureUI();

    // Persona toggle support if you already have custom controls elsewhere:
    document.querySelectorAll("[data-persona]").forEach((btn) => {
      btn.addEventListener("click", () => setPersona(btn.getAttribute("data-persona")));
    });

    // Wire send
    chatSend.addEventListener("click", () => sendMessage(chatBody, chatInput));
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage(chatBody, chatInput);
    });

    // Optional: greeting
    // appendMessage(chatBody, "Hey! I’m DJ Invizible. What can I spin up for you today?", "bot");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* Hook for real AI later:
   POST /api/chat with { message, persona: activePersona } and render the reply.
*/
