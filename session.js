(function () {
  const panel = document.getElementById("session-blocker");
  const message = document.getElementById("session-message");
  const retry = document.getElementById("session-reload");
  let blocked = true;

  function block(text) {
    blocked = true;
    message.textContent = text;
    document.getElementById("app-loading").classList.add("hidden");
    document.querySelectorAll("body > :not(script)").forEach(el => { if (el !== panel) el.inert = true; });
    clearTimeout(panel._motionHideTimer);
    panel.inert = false;
    panel.classList.remove("hidden", "is-closing");
    panel.setAttribute("aria-hidden", "false");
    retry.focus();
  }
  retry.addEventListener("click", () => location.reload());
  ["click", "change", "keydown", "blur", "submit", "pointerdown", "pointerup"].forEach(type => {
    document.addEventListener(type, event => {
      if (blocked && (event.target !== retry || (type === "keydown" && event.key === "Escape"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  });
  window.MoNySession = { block };

  async function start() {
    if (!navigator.locks) {
      block("Safe editing requires a browser with tab locking. Open MoNy over HTTPS in a current Safari, Chrome, Firefox, or Edge browser.");
      return;
    }
    try {
      await navigator.locks.request("monthly-money-tracker-editor", { ifAvailable: true }, async lock => {
        if (!lock) {
          block("MoNy is already open in another tab or window. Use that tab, or close it and select Reload here. Only one tab can edit your records at a time.");
          return;
        }
        blocked = false;
        window.addEventListener("error", () => block("MoNy could not finish loading safely. Reload to recover. Do not clear browser data."), { once: true });
        const script = document.createElement("script");
        script.src = "app.js";
        script.onerror = () => block("MoNy could not load. Check your connection and reload.");
        document.body.appendChild(script);
        // Held for this document's lifetime; closing/reloading releases it.
        await new Promise(() => {});
      });
    } catch (_) {
      block("This browser could not secure your records for editing. Reload to try again.");
    }
  }
  start();
})();
