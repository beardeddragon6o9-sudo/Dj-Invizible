// DOM and mascot-driven booth UI.
const panel = document.getElementById('panel');
const chatToggle = document.getElementById('chat-toggle');
const closePanel = document.getElementById('close-panel');
const messages = document.getElementById('messages');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const panelTitle = document.getElementById('panel-title');
const panelSubtitle = document.getElementById('panel-subtitle');
const chatAvatar = document.getElementById('chat-avatar');
const chatFootnote = document.getElementById('chat-footnote');
const quickPrompts = document.getElementById('quick-prompts');
const bookingPersona = document.getElementById('booking-persona');
const mascotCue = document.getElementById('mascot-cue');
const venueNowDeck = document.getElementById('venue-now-deck');
const btnInviz = document.getElementById('mascot-invizible');
const btnMav = document.getElementById('mascot-maverick');
const compactChat = matchMedia('(max-width: 600px), (max-height: 540px) and (pointer: coarse)');

// Use this deployment's own backend: preview talks to preview, production to production.
// This preserves the same /api/chat request body and session handling.
const AI_ENDPOINT = '/api/chat';
const MIXES_URL = 'https://www.youtube.com/@DJ.INVIZIBLE';
const mixesUrlPattern = MIXES_URL.replaceAll('.', '\\.');
const mixesLinkPattern = new RegExp(
  String.raw`(\[[^\]\n]+\]\(${mixesUrlPattern}\)|${mixesUrlPattern}(?=$|[\s),!?;:]|\.(?=\s|$)))`, 'gi'
);
let chatHistory = [];
// Keep each DJ's booking context, transcript and unfinished input independent.
const personaThreads = {
  invizible: { history: chatHistory, nodes: document.createDocumentFragment(), draft: '', visited: false },
  maverick: { history: [], nodes: document.createDocumentFragment(), draft: '', visited: false }
};
let activePersona = 'invizible';
let chatBusy = false;
let selectedMerch = null;
let chatTrigger = chatToggle;
window.addEventListener('merch-open', () => {
  if (compactChat.matches && !panel.classList.contains('hidden')) hidePanel();
});
window.addEventListener('merch-selection', event => {
  selectedMerch = event.detail;
  if (selectedMerch && !panel.classList.contains('hidden')) describeMerch();
});
window.addEventListener('merch-chat', () => {
  const wasClosed = panel.classList.contains('hidden');
  showPanel({ trigger: document.getElementById('merch-chat') });
  if (wasClosed && selectedMerch) describeMerch();
});
let cueTimer;
let speakingTimer;
let acknowledgementTimer;
let entranceTimer;

const countryHint = 'Country plans? Click or tap Maverick’s icon in the top-right corner.';
const personaUI = {
  invizible: {
    name: 'DJ INVIZIBLE',
    headerName: 'DJ DOOM',
    avatar: 'assets/img/invizible.png',
    placeholder: 'Say something to Invizible...',
    greeting: `Hey, I’m DJ Doom, DJ Invizible’s virtual AI assistant. ${countryHint}`,
    comeback: `Welcome back! Want to hear a mix or book a date? ${countryHint}`,
    cue: 'Invizible is on deck. 🎧'
  },
  maverick: {
    name: 'MIDNITE MAVERICK',
    avatar: 'assets/img/maverick.png',
    placeholder: 'Say something to Maverick...',
    greeting: 'Hey, I’m DJ Doom, Midnite Maverick’s virtual AI assistant. Ask me about country sets or booking a date.',
    comeback: 'Welcome back to Maverick’s booth! Got a country set in mind or a date you’d like to check?',
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
  window.dispatchEvent(new CustomEvent('booth-interact'));
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

function fitChatToViewport() {
  if (!compactChat.matches || panel.classList.contains('hidden')) return;
  const layoutHeight = document.documentElement.clientHeight;
  const viewport = window.visualViewport;
  const height = viewport?.height ?? layoutHeight;
  const inset = Math.max(0, layoutHeight - height - (viewport?.offsetTop ?? 0));
  panel.style.setProperty('--chat-viewport-height', `${height}px`);
  panel.style.setProperty('--chat-viewport-inset', `${inset}px`);
  panel.classList.toggle('chat-short', height < 320);
}
window.visualViewport?.addEventListener('resize', fitChatToViewport);
window.visualViewport?.addEventListener('scroll', fitChatToViewport);
window.addEventListener('resize', fitChatToViewport);

function showPanel({ trigger } = {}) {
  if (trigger) chatTrigger = trigger;
  panel.inert = false;
  panel.classList.remove('hidden');
  chatToggle.setAttribute('aria-expanded', 'true');
  greetActivePersona();
  messages.scrollTop = messages.scrollHeight;
  fitChatToViewport();
  if (compactChat.matches) panel.focus({ preventScroll: true });
  else input?.focus();
}
function hidePanel(restoreFocus = false) {
  panel.classList.add('hidden');
  panel.inert = true;
  chatToggle.setAttribute('aria-expanded', 'false');
  activeMascot()?.classList.remove('is-listening');
  setBoothStatus('AT THE TURNTABLES');
  if (restoreFocus) chatTrigger.focus();
}

function updateQuickPrompts() {
  if (!quickPrompts) return;
  quickPrompts.hidden = chatHistory.length > 0 || Boolean(input?.value.trim());
  quickPrompts.querySelectorAll('button').forEach(button => {
    button.disabled = chatBusy;
  });
}

// Render conversation text literally, with a link for the verified channel in replies.
function addMsg(text, role = 'bot') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (role === 'bot') {
    el.dataset.speaker = personaUI[activePersona].name;
    for (const [index, part] of String(text).split(mixesLinkPattern).entries()) {
      if (index % 2 === 0) {
        el.append(part);
        continue;
      }
      const link = document.createElement('a');
      link.href = MIXES_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'DJ Invizible on YouTube';
      el.append(link);
    }
  } else {
    el.textContent = String(text);
  }
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}
function speak(text) { return addMsg(text, 'bot'); }
function describeMerch() {
  speak(`Checking out the ${selectedMerch.name}? This is a design preview for now—sizes, prices and ordering aren't available yet. What would you like to know about it?`);
}

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

async function askAI(userText, topic) {
  if (chatBusy || !userText.trim()) return;
  chatBusy = true;
  addMsg(userText, 'user');
  chatHistory.push({ role: 'user', content: userText });
  if (chatHistory.length > 24) chatHistory.splice(0, chatHistory.length - 24);
  updateQuickPrompts();
  const typing = startThinking();

  const sendButton = form?.querySelector('[type="submit"]');
  if (sendButton) sendButton.disabled = true;

  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: selectedMerch ? chatHistory.map((message, index) =>
        index === chatHistory.length - 1 && message.role === 'user'
          ? { ...message, content: `[Merch viewing context: ${selectedMerch.name}. ${selectedMerch.description} This is a visual concept only; sizes, prices, stock and ordering are not available. Do not invent those details or claim an order can be placed.]\n\n${message.content}` }
          : message) : chatHistory, persona: activePersona, topic })
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
    if (!compactChat.matches && !panel.classList.contains('hidden')) input?.focus();
    updateQuickPrompts();
  }
}

// A visit marker selects the greeting, not the conversation history. Never put
// visitors' contact or booking details into persistent browser storage here.
function seenPersonaBefore(persona) {
  const key = persona === 'maverick' ? 'dj_maverick_seen' : 'dj_invizible_seen';
  try {
    const returning = localStorage.getItem(key) === '1';
    localStorage.setItem(key, '1');
    return returning;
  } catch (e) {
    // Private browsing or disabled storage must still get a full introduction.
    return false;
  }
}

function greetActivePersona() {
  const thread = personaThreads[activePersona];
  if (thread.visited) return;
  const { greeting, comeback } = personaUI[activePersona];
  speak(seenPersonaBefore(activePersona) ? comeback : greeting);
  thread.visited = true;
}

// Clicking the same DJ reopens/focuses the chat without losing a booking.
// Switching DJs restores their own conversation and draft.
function applyPersona(persona) {
  if (chatBusy) {
    flashCue('One sec, finishing this answer.', 2300);
    return;
  }
  if (persona === activePersona) {
    showPanel({ trigger: activeMascot() });
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
  window.dispatchEvent(new CustomEvent('booth-persona', { detail: { persona } }));
  btnInviz.classList.toggle('primary', persona === 'invizible');
  btnInviz.classList.toggle('secondary', persona !== 'invizible');
  btnMav.classList.toggle('primary', persona === 'maverick');
  btnMav.classList.toggle('secondary', persona !== 'maverick');
  btnInviz.setAttribute('aria-label', persona === 'invizible' ? 'Open DJ Doom chat' : 'Switch to Invizible');
  btnMav.setAttribute('aria-label', persona === 'maverick' ? 'Open Maverick chat' : 'Switch to Maverick');

  document.body.classList.toggle('theme-maverick', persona === 'maverick');
  document.body.classList.toggle('theme-invizible', persona === 'invizible');
  if (venueNowDeck) venueNowDeck.textContent = personaUI[persona].headerName || personaUI[persona].name;

  const incoming = personaThreads[persona];
  chatHistory = incoming.history;
  messages.appendChild(incoming.nodes);
  messages.scrollTop = messages.scrollHeight;
  if (input) input.value = incoming.draft;
  if (bookingPersona) bookingPersona.value = persona;
  panelTitle.textContent = personaUI[persona].headerName || personaUI[persona].name;
  if (chatFootnote) chatFootnote.textContent = 'DJ Doom • virtual AI assistant for ' + (persona === 'maverick' ? 'Midnite Maverick' : 'DJ Invizible') + '. Booking requests are reviewed by the DJ.';
  if (chatAvatar) chatAvatar.src = personaUI[persona].avatar;
  setBoothStatus('AT THE TURNTABLES');
  panel.setAttribute('aria-label', `Chat with ${personaUI[persona].name} mascot`);
  if (input) {
    input.placeholder = personaUI[persona].placeholder;
    input.setAttribute('aria-label', `Message the ${personaUI[persona].name} virtual mascot`);
  }
  showPanel({ trigger: chatToggle });
  updateQuickPrompts();
  enterBooth();
  flashCue(personaUI[persona].cue, 4300);
}

btnInviz.addEventListener('click', () => applyPersona('invizible'));
btnMav.addEventListener('click', () => applyPersona('maverick'));
chatToggle.addEventListener('click', () => {
  if (panel.classList.contains('hidden')) showPanel({ trigger: chatToggle });
  else hidePanel(true);
});
closePanel?.addEventListener('click', () => hidePanel(true));
panel.addEventListener('keydown', event => {
  if (event.key === 'Escape') hidePanel(true);
});

quickPrompts?.addEventListener('click', event => {
  const button = event.target.closest('button[data-topic]');
  if (!button || chatBusy) return;
  const prompt = promptText[activePersona][button.dataset.topic];
  if (prompt) askAI(prompt, button.dataset.topic);
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

// The module may finish after the page load event (for example on a very fast
// private-window navigation). Initialize from DOM readiness, exactly once.
let boothInitialized = false;
function initializeBooth() {
  if (boothInitialized) return;
  boothInitialized = true;
  enterBooth();
  flashCue(personaUI.invizible.cue, 4500);
  updateQuickPrompts();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeBooth, { once: true });
} else {
  initializeBooth();
}

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || chatBusy) return;
  input.value = '';
  await askAI(text);
});
