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
  let lastCheck = 0;
  let activationTimer;
  const readyMessage = "A new version is ready. Finish your entry, then refresh.";

  function offerUpdate(worker) {
    waitingWorker = worker;
    message.textContent = readyMessage;
    banner.classList.remove("hidden");
    if (status) status.textContent = "Update available. Use Refresh at the top of the page.";
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    clearTimeout(activationTimer);
    location.reload();
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    reloadReady = true;
    if (requested) reload();
    else offerUpdate(null);
  });

  apply.addEventListener("click", () => {
    if (requested || (!waitingWorker && !reloadReady)) return;
    const event = new CustomEvent("mony:before-update", { cancelable: true, detail: {} });
    if (!document.dispatchEvent(event)) {
      message.textContent = event.detail.message || "Save or clear your entry before refreshing.";
      return;
    }
    requested = true;
    apply.disabled = true;
    apply.textContent = "Refreshing…";
    if (reloadReady || waitingWorker?.state === "activated") return reload();
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      activationTimer = setTimeout(() => {
        requested = false;
        apply.disabled = false;
        apply.textContent = "Refresh";
        message.textContent = "The update has not finished. Try Refresh again.";
      }, 10000);
    } catch {
      requested = false;
      apply.disabled = false;
      apply.textContent = "Refresh";
      message.textContent = "Unable to apply the update. Try again when you are online.";
    }
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
    if (!manual && Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    if (manual && status) status.textContent = "Checking for updates…";
    if (check) check.disabled = true;
    try {
      await registration.update();
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
  window.addEventListener("online", () => checkForUpdate());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      watchWorker(registration.installing);
      registration.addEventListener("updatefound", () => watchWorker(registration.installing));
      if (status) status.textContent = registration.waiting ? "Update available." : "Updates are checked automatically.";
    } catch {
      if (check) check.disabled = true;
      if (status) status.textContent = "Offline support is unavailable. Reopen the app when you are online.";
    }
  }, { once: true });
})();
