/* Boots the REAL app in a simulated browser.
 *
 * app.js is 3,000 lines of DOM and localStorage code with no exports, so it
 * cannot be imported the way money.js can. Rather than re-implement its logic
 * in a test double - which would drift, exactly the way duplicated money maths
 * once did - this loads index.html, money.js and app.js as they ship and lets
 * them run.
 *
 * That means these tests exercise production code, not a copy of it. It is the
 * same principle behind money.test.mjs requiring ../money.js by path.
 *
 * jsdom is a devDependency only. Nothing here is served, the app itself still
 * has no dependencies, and there is still no build step.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(root, f), "utf8");

// Read once - the files do not change between tests.
const HTML = read("index.html");
const MONEY_JS = read("money.js");
const APP_JS = read("app.js");

/* Boots the app with a given localStorage and a pinned date.
 *
 * @param {object} opts
 *   storage - localStorage contents as { key: value }, values already stringified
 *             or plain objects (objects are JSON-encoded for convenience). Pass a
 *             raw string to simulate corruption.
 *   today   - "YYYY-MM-DD", the date the app should believe it is
 *
 * Returns the jsdom window, with every app.js function reachable as a property
 * because app.js declares them at script scope.
 */
export function bootApp({ storage = {}, today = "2026-08-15" } = {}) {
  /* Swallow jsdom's noise about unimplemented canvas and CSS it cannot parse.
     Real errors are surfaced by the assertions, not by this console. */
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", e => errors.push(e));

  const dom = new JSDOM(HTML, {
    url: "https://example.org/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  /* Canvas is not implemented in jsdom. Both chart functions already guard on
     a null context, so returning null exercises the same path a browser with
     the chart switched off would take. */
  window.HTMLCanvasElement.prototype.getContext = () => null;

  // alert() throws "not implemented" in jsdom; record calls so tests can assert
  // that a failure was actually reported to the user.
  window.__alerts = [];
  window.alert = msg => { window.__alerts.push(String(msg)); };

  /* Pin "now". app.js reads new Date() at load to decide the current cycle, so
     this has to be in place before the script runs. Only the zero-argument form
     is redirected - every other use (parsing stored ISO strings, arithmetic on
     cycle dates) must behave normally or the cycle maths would be meaningless.

     The pinned instant is a `let`, not a const, so a test can move the clock
     forward AFTER boot via window.__setToday. That is what makes the live
     rollover testable: an installed PWA stays running while the date changes
     under it, which is precisely the case a single fixed date cannot express. */
  const RealDate = window.Date;
  let pinned = new RealDate(`${today}T12:00:00`);
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(pinned.getTime());
      else super(...args);
    }
    static now() { return pinned.getTime(); }
  }
  window.Date = PinnedDate;
  window.__setToday = dateStr => { pinned = new RealDate(`${dateStr}T12:00:00`); };

  // Seed storage before the app reads it.
  Object.entries(storage).forEach(([k, v]) => {
    window.localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  });

  /* Everything goes through ONE eval, deliberately.

     app.js declares its state with `let` (data, settings, archive). Top-level
     let/const bindings live in a lexical scope, not on the window, and each
     separate window.eval() call gets a fresh one - so state written by a second
     eval would be invisible to the first. Concatenating keeps app.js and the
     accessors below in the same scope.

     `run` uses a DIRECT eval, which is what gives it access to the enclosing
     lexical environment. It is the seam these tests drive the app through. */
  const epilogue = `
    window.__app = {
      get data() { return data; },
      get settings() { return settings; },
      get archive() { return archive; },
      run(src) { return eval(src); }
    };
  `;

  // money.js first: app.js calls its functions as globals and breaks without it.
  window.eval(`${MONEY_JS}\n;\n${APP_JS}\n;\n${epilogue}`);

  window.__jsdomErrors = errors;
  return window;
}

// Convenience: the four keys the app stores, so tests read the same names.
export const KEYS = {
  data: "monthly-money-tracker",
  settings: "monthly-money-tracker-settings",
  archive: "monthly-money-tracker-archive",
  backup: "monthly-money-tracker-priority-backup"
};

// Parse a stored key back out of a booted window.
export function stored(window, key) {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}
