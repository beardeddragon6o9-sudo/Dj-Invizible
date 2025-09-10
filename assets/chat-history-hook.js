(() => {
  const origFetch = window.fetch;
  window.chatHistory = window.chatHistory || [];

  // Helper: extract a user prompt from various legacy shapes
  function pickPrompt(payload) {
    return payload?.message ?? payload?.text ?? payload?.prompt ?? payload?.input ?? payload?.content ?? null;
  }

  window.fetch = async function patchedFetch(input, init) {
    try {
      const url = (typeof input === "string") ? input : (input?.url || "");
      const isChat = url.includes("/api/chat") && init?.method === "POST";

      if (!isChat) {
        return await origFetch.apply(this, arguments);
      }

      // Read/parse JSON body safely
      let payload = {};
      if (init?.body) {
        try { payload = JSON.parse(init.body); }
        catch { payload = { prompt: String(init.body || "").trim() }; }
      }

      // If caller didn't send messages[], upgrade it using our local history
      if (!Array.isArray(payload.messages)) {
        const prompt = pickPrompt(payload);
        if (prompt && String(prompt).trim()) {
          window.chatHistory.push({ role: "user", content: String(prompt) });
        }
        // Keep last 24 turns to avoid huge prompts
        if (window.chatHistory.length > 24) {
          window.chatHistory.splice(0, window.chatHistory.length - 24);
        }
        payload = {
          messages: window.chatHistory,
          // preserve optional fields if present
          system: payload.system,
          model: payload.model
        };
        init.body = JSON.stringify(payload);
        init.headers = { ...(init.headers || {}), "Content-Type": "application/json" };
      }

      // Send request
      const res = await origFetch.apply(this, [input, init]);

      // Update local history with assistant reply (best-effort)
      try {
        const clone = res.clone();
        const data = await clone.json();
        const text = data?.reply?.content || data?.content || data?.text || "";
        if (text) {
          window.chatHistory.push({ role: "assistant", content: String(text) });
          if (window.chatHistory.length > 24) {
            window.chatHistory.splice(0, window.chatHistory.length - 24);
          }
        }
      } catch { /* non-JSON or network error; ignore */ }

      return res;
    } catch {
      // If anything goes wrong, fall back to original fetch
      return await origFetch.apply(this, arguments);
    }
  };
})();
