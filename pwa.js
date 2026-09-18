(function () {
  const banner = document.getElementById("update-banner");
  const message = banner.querySelector("span");
  const apply = document.getElementById("apply-update");
  const dismiss = document.getElementById("dismiss-update");
  const check = document.getElementById("check-update");
  const status = document.getElementById("update-status");
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    if (check) check.disabled = true;
    if (status) status.textContent = "Open the hosted app to enable offline use and updates.";
    return;
  }

  let registration;
  let waitingWorker;
  let reloadReady = false;
  let requested = false;
  let reloading = false;
  let controlled = Boolean(navigator.serviceWorker.controller);
  const DAILY_UPDATE_CHECK_MS = 24 * 60 * 60 * 1000;
  const UPDATE_RETRY_MS = 30000;
  const LAST_UPDATE_CHECK_KEY = "mony-last-update-check";
  let lastCheck = readLastCheck();
  let activationTimer;
  let retryTimer;

  function readLastCheck() {
    try {
      const value = Number(localStorage.getItem(LAST_UPDATE_CHECK_KEY));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function saveLastCheck(value) {
    try { localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(value)); } catch { /* optional hint only */ }
  }

  function updateGuard() {
    const event = new CustomEvent("mony:before-update", { cancelable: true, detail: {} });
    return {
      allowed: document.dispatchEvent(event),
      message: event.detail.message || "Finish your current entry first."
    };
  }

  function scheduleAutomaticRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (document.visibilityState === "visible") applyAvailableUpdate();
    }, UPDATE_RETRY_MS);
  }

  function offerUpdate(worker) {
    waitingWorker = worker;
    applyAvailableUpdate();
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    clearTimeout(activationTimer);
    clearTimeout(retryTimer);
    location.reload();
  }

  function applyAvailableUpdate() {
    if (requested || reloading || (!waitingWorker && !reloadReady)) return;
    const guard = updateGuard();
    if (!guard.allowed) {
      message.textContent = `${guard.message} MoNy will update automatically when it is safe.`;
      banner.classList.remove("hidden");
      if (status) status.textContent = "Update ready. It will install automatically after your draft is saved.";
      scheduleAutomaticRetry();
      return;
    }

    requested = true;
    banner.classList.add("hidden");
    apply.disabled = true;
    apply.textContent = "Updating…";
    if (status) status.textContent = "Installing the latest version…";
    if (reloadReady || waitingWorker?.state === "activated") return reload();
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      activationTimer = setTimeout(() => {
        requested = false;
        apply.disabled = false;
        apply.textContent = "Update now";
        message.textContent = "Automatic update paused. MoNy will retry shortly.";
        banner.classList.remove("hidden");
        scheduleAutomaticRetry();
      }, 10000);
    } catch {
      requested = false;
      apply.disabled = false;
      apply.textContent = "Update now";
      message.textContent = "Unable to apply the update. MoNy will retry when you are online.";
      banner.classList.remove("hidden");
      scheduleAutomaticRetry();
    }
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    reloadReady = true;
    if (requested) reload();
    else applyAvailableUpdate();
  });

  apply.addEventListener("click", () => {
    applyAvailableUpdate();
  });
  dismiss.addEventListener("click", () => banner.classList.add("hidden"));

  function watchWorker(worker) {
    if (!worker) return;
    function changed() {
      if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
      if (worker.state === "redundant" && status) status.textContent = "The update could not be downloaded. Try again.";
    }
    worker.addEventListener("statechange", changed);
    changed();
  }

  async function checkForUpdate(manual = false) {
    if (!registration) return;
    if (registration.waiting || reloadReady) {
      offerUpdate(registration.waiting);
      return;
    }
    if (!manual && Date.now() - lastCheck < DAILY_UPDATE_CHECK_MS) return;
    lastCheck = Date.now();
    if (manual && status) status.textContent = "Checking for updates…";
    if (check) check.disabled = true;
    try {
      await registration.update();
      saveLastCheck(lastCheck);
      if (registration.waiting) offerUpdate(registration.waiting);
      else if (manual && status) status.textContent = registration.installing
        ? "Downloading the update…" : "You are using the latest version.";
    } catch {
      if (manual && status) status.textContent = "Could not check for updates. Check your connection and try again.";
    } finally {
      if (check) check.disabled = false;
    }
  }

  if (check) check.addEventListener("click", () => checkForUpdate(true));
  window.addEventListener("online", () => {
    checkForUpdate();
    applyAvailableUpdate();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
      applyAvailableUpdate();
    }
  });
  window.addEventListener("focus", applyAvailableUpdate);
  document.addEventListener("input", applyAvailableUpdate);
  document.addEventListener("change", applyAvailableUpdate);
  setInterval(() => checkForUpdate(), 60 * 60 * 1000);
  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      watchWorker(registration.installing);
      registration.addEventListener("updatefound", () => watchWorker(registration.installing));
      await checkForUpdate();
      if (status && !registration.waiting) status.textContent = "Updates install automatically each day.";
    } catch {
      if (check) check.disabled = true;
      if (status) status.textContent = "Offline support is unavailable. Reopen the app when you are online.";
    }
  }, { once: true });
})();
