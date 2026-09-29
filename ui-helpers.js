/* Shared, dependency-free UI behaviour.
 *
 * This stays a classic script because MoNy intentionally has no build step.
 * Keeping it behind one namespace still lets app.js stay focused on finance
 * state and screen-specific rendering, while this file owns reusable motion.
 */
(function attachUiHelpers(global) {
  const BASE_MODAL_LAYER = 9999;

  function prefersReducedMotion() {
    return typeof global.matchMedia === "function" &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function playTransient(el, className, duration = 360) {
    if (!el || prefersReducedMotion()) return;
    clearTimeout(el._motionTimer);
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    el._motionTimer = setTimeout(() => el.classList.remove(className), duration);
  }

  function revealSurface(el) {
    if (!el) return;
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active)) el._focusReturn = active;
    clearTimeout(el._motionHideTimer);
    el._motionHideTimer = null;
    /* Settings is moved to the document root for Safari tap handling. That
       means DOM order alone puts it above every dialog that Settings opens.
       Give each newly opened overlay the next layer instead: Add Wallet,
       categories, recovery, and every future dialog then appear in front of
       the sheet that launched them. */
    if (el.classList.contains("modal")) {
      const highestLayer = Array.from(document.querySelectorAll(".modal:not(.hidden)"))
        .filter(surface => surface !== el && !surface.classList.contains("is-closing"))
        .reduce((highest, surface) => Math.max(highest, Number(surface.style.getPropertyValue("--modal-layer")) || BASE_MODAL_LAYER), BASE_MODAL_LAYER - 1);
      el.style.setProperty("--modal-layer", String(highestLayer + 1));
    }
    el.classList.remove("hidden", "is-closing");
    el.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      if (el.classList.contains("hidden") || el.classList.contains("is-closing")) return;
      const initial = el.querySelector("[data-modal-initial-focus]") || el.querySelector(
        "input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
      );
      (initial || el.querySelector(".modal-card"))?.focus();
    });
  }

  function concealSurface(el, immediate = false, duration = 120) {
    if (!el || el.classList.contains("hidden")) return;
    const returnFocus = el._focusReturn;
    el._focusReturn = null;
    const restoreFocus = () => {
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === "function") returnFocus.focus();
    };
    clearTimeout(el._motionHideTimer);
    if (immediate || prefersReducedMotion()) {
      el.classList.add("hidden");
      el.classList.remove("is-closing");
      el.setAttribute("aria-hidden", "true");
      restoreFocus();
      return;
    }
    el.classList.add("is-closing");
    el.setAttribute("aria-hidden", "true");
    el._motionHideTimer = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("is-closing");
      el._motionHideTimer = null;
      restoreFocus();
    }, duration);
  }

  /* While any dialog or sheet is open the page behind it must not scroll.
     iOS ignores overflow:hidden on the body for touch scrolling, so the body
     is pinned in place with position:fixed at its current offset, and put
     back exactly where it was when the last dialog closes. The guided tour
     scrolls the page to what it points at, so its overlay is left out.
     Watching class changes covers every way a dialog opens or closes. */
  let lockedScrollY = null;
  function openDialogs() {
    return Array.from(document.querySelectorAll(".modal:not(.hidden)"))
      .filter(el => !el.classList.contains("is-closing") && !el.classList.contains("tutorial-overlay"));
  }
  function updateScrollLock() {
    const body = document.body;
    if (!body) return;
    const shouldLock = openDialogs().length > 0;
    if (shouldLock && lockedScrollY === null) {
      lockedScrollY = global.scrollY || 0;
      body.classList.add("scroll-locked");
      body.style.top = `-${lockedScrollY}px`;
    } else if (!shouldLock && lockedScrollY !== null) {
      const y = lockedScrollY;
      lockedScrollY = null;
      body.classList.remove("scroll-locked");
      body.style.top = "";
      global.scrollTo(0, y);
    }
  }
  let lockCheckQueued = false;
  function queueScrollLockCheck() {
    if (lockCheckQueued) return;
    lockCheckQueued = true;
    Promise.resolve().then(() => { lockCheckQueued = false; updateScrollLock(); });
  }
  if (typeof global.MutationObserver === "function" && document.documentElement) {
    new global.MutationObserver(records => {
      if (records.some(r => r.target.classList && r.target.classList.contains("modal"))) queueScrollLockCheck();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  global.MoNyUI = { prefersReducedMotion, playTransient, revealSurface, concealSurface, updateScrollLock };
})(window);
