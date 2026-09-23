// DOM and mascot-driven booth UI.
const panel = document.getElementById('panel');
const closePanel = document.getElementById('close-panel');
const messages = document.getElementById('messages');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const panelTitle = document.getElementById('panel-title');
const panelSubtitle = document.getElementById('panel-subtitle');
const chatAvatar = document.getElementById('chat-avatar');
const quickPrompts = document.getElementById('quick-prompts');
const bookingPersona = document.getElementById('booking-persona');
const mascotCue = document.getElementById('mascot-cue');
const btnInviz = document.getElementById('mascot-invizible');
const btnMav = document.getElementById('mascot-maverick');

// Keep the existing booking/chat transport and its message contract unchanged.
const API_BASE = 'https://dj-invizible.vercel.app';
const AI_ENDPOINT = `${API_BASE}/api/chat`;
let chatHistory = [];
// Keep each DJ's booking context, transcript and unfinished input independent.
const personaThreads = {
  invizible: { history: chatHistory, nodes: document.createDocumentFragment(), draft: '', visited: false },
  maverick: { history: [], nodes: document.createDocumentFragment(), draft: '', visited: false }
};
let activePersona = 'invizible';
let chatBusy = false;
let cueTimer;
let speakingTimer;
let acknowledgementTimer;
let entranceTimer;

const personaUI = {
  invizible: {
    name: 'DJ INVIZIBLE',
    avatar: 'assets/img/invizible.png',
    placeholder: 'Say something to Invizible...',
    greeting: 'Welcome to Invizible’s booth. Ask me about tracks, sets, or booking a date.',
    comeback: 'Invizible back on deck. What can I cue up?',
    cue: 'Invizible is on deck. 🎧'
  },
  maverick: {
    name: 'MIDNITE MAVERICK',
    avatar: 'assets/img/maverick.png',
    placeholder: 'Say something to Maverick...',
    greeting: 'Maverick’s on deck. Ask me about the country set or getting a date booked.',
    comeback: 'Maverick here. What can I play for you?',
    cue: 'Maverick is on deck. 🤠'
  }
};
const promptText = {
  invizible: {
    booking: "I'd like to book DJ Invizible for an event.",
    mixes: 'Tell me about your mixes and music.',
    events: 'What sorts of events do you play?'
  },
  maverick: {
    booking: "I'd like to book Midnite Maverick for an event.",
    mixes: 'Tell me about your country mixes and music.',
    events: 'What sorts of events do you play?'
  }
};

function activeMascot() {
  return activePersona === 'maverick' ? btnMav : btnInviz;
}
function setBoothStatus(status) {
  if (panelSubtitle?.lastChild) panelSubtitle.lastChild.textContent = ' ' + status;
}
function acknowledgeMascot() {
  const mascot = activeMascot();
  if (!mascot) return;
  window.clearTimeout(acknowledgementTimer);
  mascot.classList.remove('is-acknowledging');
  void mascot.offsetWidth;
  mascot.classList.add('is-acknowledging');
  acknowledgementTimer = window.setTimeout(() => mascot.classList.remove('is-acknowledging'), 560);
}
function enterBooth() {
  const mascot = activeMascot();
  if (!mascot) return;
  window.clearTimeout(entranceTimer);
  mascot.classList.remove('is-entering');
  void mascot.offsetWidth;
  mascot.classList.add('is-entering');
  entranceTimer = window.setTimeout(() => mascot.classList.remove('is-entering'), 740);
}

function flashCue(text, duration = 4000) {
  if (!mascotCue) return;
  window.clearTimeout(cueTimer);
  mascotCue.textContent = text;
  mascotCue.classList.remove('hidden');
  if (duration > 0) {
    cueTimer = window.setTimeout(() => mascotCue.classList.add('hidden'), duration);
  }
}

function showPanel(focusInput = true) {
  panel.inert = false;
  panel.classList.remove('hidden');
  // On compact screens the panel follows the stage; do not jump past the mascots on load.
  if (focusInput) input?.focus();
}
function hidePanel() {
  panel.classList.add('hidden');
  panel.inert = true;
  activeMascot()?.classList.remove('is-listening');
  setBoothStatus('AT THE TURNTABLES');
  flashCue('Tap me whenever you want to talk.', 4500);
}

function updateQuickPrompts() {
  if (!quickPrompts) return;
  quickPrompts.hidden = chatHistory.length > 0 || Boolean(input?.value.trim());
  quickPrompts.querySelectorAll('button').forEach(button => {
    button.disabled = chatBusy;
  });
}

// Always use textContent for model and user text, never HTML.
function addMsg(text, role = 'bot') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (role === 'bot') el.dataset.speaker = personaUI[activePersona].name;
  el.textContent = String(text);
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}
function speak(text) { return addMsg(text, 'bot'); }

function startThinking() {
  const typing = document.createElement('div');
  typing.className = 'msg bot typing';
  typing.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = 'Mixing a reply';
  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
  typing.append(label, dots);
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
  activeMascot()?.classList.remove('is-listening', 'is-acknowledging');
  activeMascot()?.classList.add('is-thinking');
  setBoothStatus('MIXING A REPLY');
  flashCue('Mixing up a reply…', 0);
  return typing;
}

function finishThinking(typing) {
  typing.remove();
  activeMascot()?.classList.remove('is-thinking');
  setBoothStatus('AT THE TURNTABLES');
}

function reactToReply() {
  const mascot = activeMascot();
  window.clearTimeout(speakingTimer);
  mascot?.classList.remove('is-speaking');
  // Reflow retriggers the finite reaction on consecutive replies.
  if (mascot) {
    void mascot.offsetWidth;
    mascot.classList.add('is-speaking');
    setBoothStatus('ON THE MIC');
    speakingTimer = window.setTimeout(() => {
      mascot.classList.remove('is-speaking');
      setBoothStatus(document.activeElement === input ? 'LISTENING' : 'AT THE TURNTABLES');
    }, 1250);
  }
  flashCue('Back to you! ↗', 3600);
}

async function askAI(userText) {
  if (chatBusy || !userText.trim()) return;
  chatBusy = true;
  addMsg(userText, 'user');
  chatHistory.push({ role: 'user', content: userText });
  if (chatHistory.length > 24) chatHistory.splice(0, chatHistory.length - 24);
  updateQuickPrompts();
  const typing = startThinking();

  const sendButton = form?.querySelector('[type="submit"]');
  if (sendButton) sendButton.disabled = true;
  if (input) input.disabled = true;

  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory, persona: activePersona })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Chat request failed (HTTP ${res.status})`);
    }
    const reply = data.reply?.content ?? data.content ?? data.text;
    if (!reply) throw new Error('The assistant returned an empty reply.');
    finishThinking(typing);
    speak(reply);
    reactToReply();
    chatHistory.push({ role: 'assistant', content: reply });
    if (chatHistory.length > 24) chatHistory.splice(0, chatHistory.length - 24);
  } catch (err) {
    finishThinking(typing);
    // Do not preserve a user turn that never received a successful reply.
    if (chatHistory.at(-1)?.role === 'user') chatHistory.pop();
    speak(`Couldn't complete that request: ${err.message || 'server_error'}. Please try again.`);
    flashCue('Connection hiccup. Try that again.', 4500);
    console.error('[DJ chat]', err);
  } finally {
    chatBusy = false;
    if (sendButton) sendButton.disabled = false;
    if (input) {
      input.disabled = false;
      if (!panel.classList.contains('hidden')) input.focus();
    }
    updateQuickPrompts();
  }
}

function greetFirstTime() {
  let returning = false;
  try {
    returning = localStorage.getItem('dj_invizible_seen') === '1';
    localStorage.setItem('dj_invizible_seen', '1');
  } catch (e) {
    // Private storage settings should never prevent someone chatting.
  }
  personaThreads.invizible.visited = true;
  speak(returning ? personaUI.invizible.comeback : personaUI.invizible.greeting);
  enterBooth();
  flashCue(personaUI.invizible.cue, 4500);
}

// Clicking the same DJ reopens/focuses the chat without losing a booking.
// Switching DJs intentionally starts a fresh, persona-specific conversation.
function applyPersona(persona) {
  if (chatBusy) {
    flashCue('One sec, finishing this answer.', 2300);
    return;
  }
  if (persona === activePersona) {
    showPanel();
    acknowledgeMascot();
    flashCue('Right here. What’s up?', 3300);
    return;
  }
  // Move the rendered messages into the outgoing DJ's private in-memory thread.
  const outgoing = personaThreads[activePersona];
  outgoing.draft = input?.value ?? '';
  while (messages.firstChild) outgoing.nodes.appendChild(messages.firstChild);
  window.clearTimeout(speakingTimer);
  window.clearTimeout(acknowledgementTimer);
  window.clearTimeout(entranceTimer);
  activeMascot()?.classList.remove('is-thinking', 'is-speaking', 'is-listening', 'is-acknowledging', 'is-entering');
  activePersona = persona;
  btnInviz.classList.toggle('primary', persona === 'invizible');
  btnInviz.classList.toggle('secondary', persona !== 'invizible');
  btnMav.classList.toggle('primary', persona === 'maverick');
  btnMav.classList.toggle('secondary', persona !== 'maverick');

  document.body.classList.toggle('theme-maverick', persona === 'maverick');
  document.body.classList.toggle('theme-invizible', persona === 'invizible');

  const incoming = personaThreads[persona];
  chatHistory = incoming.history;
  messages.appendChild(incoming.nodes);
  messages.scrollTop = messages.scrollHeight;
  if (input) input.value = incoming.draft;
  if (bookingPersona) bookingPersona.value = persona;
  panelTitle.textContent = personaUI[persona].name;
  if (chatAvatar) chatAvatar.src = personaUI[persona].avatar;
  setBoothStatus('AT THE TURNTABLES');
  panel.setAttribute('aria-label', `Chat with ${personaUI[persona].name} mascot`);
  if (input) {
    input.placeholder = personaUI[persona].placeholder;
    input.setAttribute('aria-label', `Message the ${personaUI[persona].name} virtual mascot`);
  }
  showPanel();
  if (!incoming.visited) {
    speak(personaUI[persona].greeting);
    incoming.visited = true;
  }
  updateQuickPrompts();
  enterBooth();
  flashCue(personaUI[persona].cue, 4300);
}

btnInviz.addEventListener('click', () => applyPersona('invizible'));
btnMav.addEventListener('click', () => applyPersona('maverick'));
closePanel?.addEventListener('click', hidePanel);

quickPrompts?.addEventListener('click', event => {
  const button = event.target.closest('button[data-topic]');
  if (!button || chatBusy) return;
  const prompt = promptText[activePersona][button.dataset.topic];
  if (prompt) askAI(prompt);
});

input?.addEventListener('focus', () => {
  if (!chatBusy) {
    activeMascot()?.classList.add('is-listening');
    setBoothStatus('LISTENING');
  }
});
input?.addEventListener('blur', () => {
  activeMascot()?.classList.remove('is-listening');
  if (!chatBusy) setBoothStatus('AT THE TURNTABLES');
});
input?.addEventListener('input', updateQuickPrompts);

window.addEventListener('load', () => {
  showPanel(false);
  greetFirstTime();
  updateQuickPrompts();
});

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || chatBusy) return;
  input.value = '';
  await askAI(text);
});
