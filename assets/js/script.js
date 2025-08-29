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
// === Chat Variables ===
const chatBody = document.querySelector("#chat-body"); // your chat messages container
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
const persona = "invizible"; // or "maverick" based on toggle

// Maintain conversation history for multi-turn chats
let chatHistory = [];

// Append message to chat window
function appendMessage(content, sender = "bot") {
  const row = document.createElement("div");
  row.className = `chat-msg ${sender}`;
  row.textContent = content;
  chatBody.appendChild(row);
  chatBody.scrollTop = chatBody.scrollHeight; // auto-scroll
}

// Loader animation for "mascot is thinking"
function addLoader() {
  const loader = document.createElement("div");
  loader.className = "chat-msg loader";
  loader.innerHTML = `
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
  `;
  chatBody.appendChild(loader);
  chatBody.scrollTop = chatBody.scrollHeight;
  return loader;
}

// Send message to mascot API
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // Show user message instantly
  appendMessage(message, "user");
  chatInput.value = "";

  // Add loader while waiting for mascot
  const loader = addLoader();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        persona,
        messages: [
          ...chatHistory,
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    loader.remove();

    if (data.ok && data.message) {
      appendMessage(data.message, "bot");
      chatHistory.push({ role: "user", content: message });
      chatHistory.push({ role: "assistant", content: data.message });
    } else {
      appendMessage(data.message || "Out of juice, try again later.", "bot");
    }
  } catch (err) {
    loader.remove();
    appendMessage("Network hiccup, try again.", "bot");
    console.error("[chat] fetch failed:", err);
  }
}

// Send on button click or Enter key
chatSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});


/* Hook for real AI later:
   POST /api/chat with { message, persona: activePersona } and render the reply.
*/
