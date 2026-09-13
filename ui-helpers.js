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
  }

  function concealSurface(el, immediate = false, duration = 120) {
    if (!el || el.classList.contains("hidden")) return;
    clearTimeout(el._motionHideTimer);
    if (immediate || prefersReducedMotion()) {
      el.classList.add("hidden");
      el.classList.remove("is-closing");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    el.classList.add("is-closing");
    el.setAttribute("aria-hidden", "true");
    el._motionHideTimer = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("is-closing");
      el._motionHideTimer = null;
    }, duration);
  }

  global.MoNyUI = { prefersReducedMotion, playTransient, revealSurface, concealSurface };
})(window);
