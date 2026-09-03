/* Shared, dependency-free UI behaviour.
 *
 * This stays a classic script because MoNy intentionally has no build step.
 * Keeping it behind one namespace still lets app.js stay focused on finance
 * state and screen-specific rendering, while this file owns reusable motion.
 */
(function attachUiHelpers(global) {
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
