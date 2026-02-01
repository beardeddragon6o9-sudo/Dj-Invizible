const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");
const inbox = document.getElementById("inbox");
const requestList = document.getElementById("requestList");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const storeInfo = document.getElementById("storeInfo");
const lastUpdated = document.getElementById("lastUpdated");

const state = {
  items: [],
  store: null,
};

function showLogin() {
  loginCard.classList.remove("hidden");
  inbox.classList.add("hidden");
  refreshBtn.disabled = true;
  logoutBtn.disabled = true;
}

function showInbox() {
  loginCard.classList.add("hidden");
  inbox.classList.remove("hidden");
  refreshBtn.disabled = false;
  logoutBtn.disabled = false;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error || "Request failed";
    throw new Error(error);
  }
  return data;
}

function toLocalInput(value) {
  if (!value) return "";
  let date;
  if (value.includes("T")) {
    date = new Date(value);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    date = new Date(value.replace(" ", "T"));
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function renderRequests() {
  requestList.innerHTML = "";

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No booking requests yet.";
    requestList.appendChild(empty);
    return;
  }

  state.items.forEach((req) => {
    const card = document.createElement("article");
    card.className = "card request-card";
    card.dataset.id = req.id;

    const header = document.createElement("div");
    header.className = "request-header";
    header.innerHTML = `
      <div>
        <div><strong>${req.eventTypeName || "Gig request"}</strong></div>
        <div class="hint mono">${req.id}</div>
      </div>
      <div class="badge ${req.status}">${req.status.replace("_", " ")}</div>
    `;

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.innerHTML = `
      <div class="kv"><div class="label">Venue</div><div class="value">${req.venue || "-"}</div></div>
      <div class="kv"><div class="label">Date</div><div class="value">${req.date || "-"}</div></div>
      <div class="kv"><div class="label">Time window</div><div class="value">${req.timeWindow || "-"}</div></div>
      <div class="kv"><div class="label">Preferred start</div><div class="value">${req.preferredStart || "-"}</div></div>
      <div class="kv"><div class="label">Contact name</div><div class="value">${req.contactName || "-"}</div></div>
      <div class="kv"><div class="label">Contact email</div><div class="value">${req.contactEmail || "-"}</div></div>
      <div class="kv"><div class="label">Contact phone</div><div class="value">${req.contactPhone || "-"}</div></div>
      <div class="kv"><div class="label">Payment method</div><div class="value">${req.paymentMethod || "-"}</div></div>
      <div class="kv"><div class="label">Notes</div><div class="value">${req.notes || "-"}</div></div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    if (req.status === "pending") {
      const startInput = document.createElement("input");
      startInput.type = "datetime-local";
      startInput.value = toLocalInput(req.preferredStart);
      startInput.dataset.role = "start-input";

      const approveBtn = document.createElement("button");
      approveBtn.className = "btn ok";
      approveBtn.textContent = "Approve & book";
      approveBtn.dataset.action = "approve";

      const declineBtn = document.createElement("button");
      declineBtn.className = "btn danger";
      declineBtn.textContent = "Decline";
      declineBtn.dataset.action = "decline";

      actions.appendChild(startInput);
      actions.appendChild(approveBtn);
      actions.appendChild(declineBtn);
    }

    if (req.status === "booked") {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn danger";
      cancelBtn.textContent = "Cancel booking";
      cancelBtn.dataset.action = "cancel";
      actions.appendChild(cancelBtn);
    }

    if (req.bookingUid || req.booking?.data?.uid || req.booking?.uid) {
      const bookingId = req.bookingUid || req.booking?.data?.uid || req.booking?.uid;
      const meta = document.createElement("div");
      meta.className = "hint mono";
      meta.textContent = `Booking UID: ${bookingId}`;
      actions.appendChild(meta);
    }

    card.appendChild(header);
    card.appendChild(grid);
    card.appendChild(actions);
    requestList.appendChild(card);
  });
}

async function loadRequests() {
  const data = await api("/api/owner/requests");
  state.items = data.items || [];
  state.store = data.store?.type || "memory";
  storeInfo.textContent =
    state.store === "memory" ? "Store: memory (not persistent)" : `Store: ${state.store}`;
  lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  renderRequests();
}

async function checkAuth() {
  try {
    await api("/api/owner/me", { method: "GET" });
    showInbox();
    await loadRequests();
  } catch {
    showLogin();
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    await api("/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value }),
    });
    passwordInput.value = "";
    showInbox();
    await loadRequests();
  } catch (err) {
    loginError.textContent = err?.message || "Login failed.";
  }
});

refreshBtn?.addEventListener("click", async () => {
  try {
    await loadRequests();
  } catch (err) {
    showLogin();
    alert(err?.message || "Session expired.");
  }
});

logoutBtn?.addEventListener("click", async () => {
  await api("/api/owner/logout", { method: "POST" });
  showLogin();
});

requestList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = event.target.closest("[data-id]");
  if (!card) return;
  const id = card.dataset.id;
  const action = button.dataset.action;

  try {
    if (action === "approve") {
      const input = card.querySelector("input[data-role=\"start-input\"]");
      if (!input?.value) {
        alert("Set a start time before approving.");
        return;
      }
      const startIso = new Date(input.value).toISOString();
      await api("/api/owner/requests/update", {
        method: "POST",
        body: JSON.stringify({ id, action, start: startIso }),
      });
    }

    if (action === "decline") {
      const reason = window.prompt("Decline reason (optional):") || "";
      await api("/api/owner/requests/update", {
        method: "POST",
        body: JSON.stringify({ id, action, reason }),
      });
    }

    if (action === "cancel") {
      const reason = window.prompt("Cancel reason (optional):") || "";
      await api("/api/owner/requests/update", {
        method: "POST",
        body: JSON.stringify({ id, action, reason }),
      });
    }

    await loadRequests();
  } catch (err) {
    alert(err?.message || "Action failed.");
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/owner/sw.js");
}

checkAuth();
