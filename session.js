(function () {
  const panel = document.getElementById("session-blocker");
  const message = document.getElementById("session-message");
  const retry = document.getElementById("session-reload");
  let blocked = true;
  let repairOnReload = false;
  // Set by app.js once its whole start-up has run (see ready() below).
  let appReady = false;

  /* `repair` is set when the app's own files failed rather than the records -
     a missing or broken script. Reload then drops the saved copy of the app
     files (Cache Storage and the service worker) so they are fetched fresh.
     The records live in localStorage, which this never touches.

     The panel is shown FIRST. This used to hide the start-up loading screen
     before anything else, and app.js removes that element once it has
     started - so any block after start-up threw right there, with `blocked`
     already set: every tap was swallowed and no message ever appeared. Every
     other step is optional and guarded. */
  function block(text, repair = false) {
    blocked = true;
    repairOnReload = repairOnReload || repair;
    message.textContent = text;
    clearTimeout(panel._motionHideTimer);
    panel.inert = false;
    panel.classList.remove("hidden", "is-closing");
    panel.setAttribute("aria-hidden", "false");
    document.getElementById("app-loading")?.classList.add("hidden");
    document.querySelectorAll("body > :not(script)").forEach(el => { if (el !== panel) el.inert = true; });
    retry.focus?.();
  }

  /* Only worth throwing the saved app files away when fresh ones can actually
     be downloaded. Offline, deleting them would leave nothing to open at all,
     so the reload keeps them. The query string keeps this request away from
     the service worker's cache. */
  async function serverReachable() {
    try {
      const response = await fetch(`manifest.json?reachable=${Date.now()}`, { cache: "no-store" });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function repairAppFiles() {
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => /^mmt-v\d+$/.test(key)).map(key => caches.delete(key)));
      }
      if (navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(registration => registration.unregister()));
      }
    } catch (_) { /* a plain reload is still the best remaining step */ }
  }

  retry.addEventListener("click", async () => {
    retry.disabled = true;
    if (repairOnReload && await serverReachable()) await repairAppFiles();
    location.reload();
  });
  ["click", "change", "keydown", "blur", "submit", "pointerdown", "pointerup"].forEach(type => {
    document.addEventListener(type, event => {
      if (blocked && (event.target !== retry || (type === "keydown" && event.key === "Escape"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  });
  /* Called by app.js when its start-up has completed. An error after that is
     a fault in something the user did, not a broken download, so it gets a
     plain message and a plain reload. */
  function ready() { appReady = true; }
  window.MoNySession = { block, ready };

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
        window.addEventListener("error", () => {
          if (appReady) {
            block("Something went wrong in MoNy. Reload to carry on - your saved records are safe on this device. Do not clear browser data.");
          } else {
            block("MoNy could not finish loading safely. Reload to recover - when you are online it downloads a fresh copy of the app. Your records stay on this device; do not clear browser data.", true);
          }
        }, { once: true });
        const script = document.createElement("script");
        script.src = "app.js";
        script.onerror = () => block("MoNy could not load. Check your connection and reload.", true);
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
