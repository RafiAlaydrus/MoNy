/* Run with:  node --test test/     (or: npm test)
 *
 * These boot the real index.html + money.js + app.js in jsdom and drive them.
 * money.test.mjs covers the arithmetic; this file covers everything that has
 * historically gone wrong AROUND it - the month lifecycle, the migrations, and
 * the DOM wiring.
 *
 * That distinction is the point. Every bug this project has shipped lived in
 * app.js, precisely because none of it was reachable from a test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bootApp, KEYS, stored } from "./harness.mjs";

const SETTINGS = {
  showChart: false, currency: "RM", sortOrder: "oldest", budgetLimit: null,
  wallets: [{ id: "w0", name: "Grocery" }], collapsed: {}, dateOrderMigrated: true,
  carryOver: true, monthStartDay: 1
};

const month = (over = {}) => ({
  month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
  income: 3000, carryOver: 0, carryIn: { main: 0, wallets: {} },
  priority: [], priorityLocked: false, walletData: {}, secondChoice: [], ...over
});

/* ---------------------------------------------------------------------------
   BOOT
--------------------------------------------------------------------------- */

test("a first-ever run creates a month without crashing", () => {
  const w = bootApp({ storage: {}, today: "2026-08-15" });
  const d = w.__app.data;
  assert.equal(d.month, "2026-8");
  assert.equal(d.income, null);
  assert.equal(w.__jsdomErrors.length, 0, "nothing should throw during boot");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("an existing month is loaded rather than replaced", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month({ income: 1234 }) },
    today: "2026-08-15"
  });
  assert.equal(w.__app.data.income, 1234, "the stored month must survive boot");
  assert.equal(w.document.getElementById("total-income-display").textContent, "RM 1,234.00");
});

/* ---------------------------------------------------------------------------
   CORRUPT STORAGE

   Every storage read used to be a bare JSON.parse. One malformed byte threw
   before anything rendered and the app died to a blank screen, with the data
   still there but unreachable and no way to find that out.
--------------------------------------------------------------------------- */

test("REGRESSION: a corrupt month does not blank the app", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: "{not json at all" },
    today: "2026-08-15"
  });
  assert.equal(w.__jsdomErrors.length, 0, "boot must not throw");
  assert.ok(w.__app.data, "a usable month is created instead");
  assert.equal(w.document.getElementById("remaining-money").textContent, "RM 0.00",
    "and the UI renders");
});

test("a corrupt value is set aside, never overwritten", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: "{broken" },
    today: "2026-08-15"
  });
  assert.equal(w.localStorage.getItem(`${KEYS.data}-corrupt`), "{broken",
    "the only copy of the damaged data must be preserved for recovery");
});

test("corrupt settings fall back to defaults and keep the app usable", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: "]]]", [KEYS.data]: month({ income: 500 }) },
    today: "2026-08-15"
  });
  assert.equal(w.__jsdomErrors.length, 0);
  assert.equal(w.__app.settings.currency, "RM", "defaults applied");
  assert.equal(w.__app.data.income, 500, "the readable month still loads");
});

test("corrupt history does not take the current month down with it", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.archive]: "<<<", [KEYS.data]: month({ income: 750 }) },
    today: "2026-08-15"
  });
  assert.equal(w.__jsdomErrors.length, 0);
  assert.equal(w.__app.data.income, 750);
  assert.equal(Object.keys(w.__app.archive).length, 0, "history starts empty rather than crashing");
});

test("the user is told when something could not be read", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: "{broken" },
    today: "2026-08-15"
  });
  // The notice is deferred a tick so first paint happens first.
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(w.__alerts.length, 1, "exactly one notice, not one per key");
      assert.match(w.__alerts[0], /could not be read/);
      assert.match(w.__alerts[0], /this month/, "it names what was lost");
      assert.match(w.__alerts[0], /export/i, "and says what to do about it");
      resolve();
    }, 5);
  });
});

/* The damaged value is copied aside rather than destroyed, so it is still
   under the real key after the first load. If the fresh month were not saved,
   the app would warn again on every single load and stay unpersisted. */
test("recovery settles after one load rather than warning forever", () => {
  const first = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: "{broken" },
    today: "2026-08-15"
  });
  const recovered = stored(first, KEYS.data);
  assert.ok(recovered && recovered.month, "a fresh month is written straight away");

  const second = bootApp({
    storage: {
      [KEYS.settings]: stored(first, KEYS.settings),
      [KEYS.data]: recovered
    },
    today: "2026-08-15"
  });
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(second.__alerts.length, 0, "the second load is clean");
      resolve();
    }, 5);
  });
});

test("a clean load says nothing", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(w.__alerts.length, 0, "no notice when nothing is wrong");
      resolve();
    }, 5);
  });
});

/* ---------------------------------------------------------------------------
   RESET - the v1.17.1 bug, now reachable

   resetData clears the month field by field. When carryOver was added it was
   not added to that list, so the month emptied while the balance stayed. This
   asserts the SHAPE it produces, so any field added in future that is not
   cleared here fails immediately rather than on someone's phone.
--------------------------------------------------------------------------- */

test("REGRESSION: reset clears every field that holds money", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        income: 3000, carryOver: 1095.97,
        carryIn: { main: 882.01, wallets: { w0: 213.96 } },
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-08-02T10:00:00.000Z" }],
        walletData: { w0: { budget: 213.96, items: [{ name: "food", amount: 20, type: "take", date: "2026-08-03T10:00:00.000Z" }] } },
        secondChoice: [{ name: "Lunch", category: "Food / Drink", amount: 30, type: "take", date: "2026-08-04T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  w.__app.run("resetData()");
  const d = w.__app.data;

  /* Fields are checked individually rather than with deepEqual: these objects
     are created inside jsdom, so they carry that realm's prototypes and fail a
     strict structural comparison against Node-side literals. */
  assert.equal(d.income, null);
  assert.equal(d.carryOver, 0, "the balance must not survive a reset");
  assert.equal(d.carryIn.main, 0);
  assert.equal(Object.keys(d.carryIn.wallets).length, 0);
  assert.equal(d.priority.length, 0);
  assert.equal(d.priorityLocked, false);
  assert.equal(Object.keys(d.walletData).length, 0);
  assert.equal(d.secondChoice.length, 0);

  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 0,
    "a reset month holds nothing");
  assert.ok(w.__app.run("monthIsUnset(data)"), "and reads as unset");
});

/* The cycle is deliberately NOT reset: erasing this month's entries does not
   move you into a different budget period. */
test("reset keeps the cycle it is in", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: { ...SETTINGS, monthStartDay: 20 },
               [KEYS.data]: month({ cycleStart: "2026-08-20", cycleNext: "2026-09-20", month: "2026-8" }) },
    today: "2026-08-25"
  });
  w.__app.run("resetData()");
  assert.equal(w.__app.data.cycleStart, "2026-08-20", "still the same cycle");
  assert.equal(w.__app.data.cycleNext, "2026-09-20");
});

/* Guards against the reverse of the v1.17.1 bug: a field created for a new
   month but never cleared on reset. Compares the two field lists directly. */
test("every field a new month has is one reset knows about", () => {
  const w = bootApp({ storage: {}, today: "2026-08-15" });
  const fresh = w.__app.run("freshMonthData()");
  w.__app.run("resetData()");
  const reset = w.__app.data;

  const missing = Object.keys(fresh).filter(k => !(k in reset));
  assert.equal(missing.length, 0,
    `resetData does not set: ${missing.join(", ")} - add them or a reset will leave them behind`);
});

/* ---------------------------------------------------------------------------
   ROLLOVER
--------------------------------------------------------------------------- */

test("a finished month is archived and a fresh one opened", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
        income: 3000,
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-07-02T10:00:00.000Z" }],
        walletData: { w0: { budget: 400, items: [] } }
      })
    },
    today: "2026-08-15"
  });

  const archive = stored(w, KEYS.archive);
  assert.ok(archive["2026-7"], "July must be archived");
  assert.equal(w.__app.data.month, "2026-8", "and August opened");
  assert.equal(w.__app.data.income, null, "with no income yet");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("carry-forward brings the closing balance into the new month", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
        income: 3000,
        priority: [{ name: "Rent", category: "Bills", amount: 1000, paid: true, date: "2026-07-02T10:00:00.000Z" }],
        walletData: { w0: { budget: 400, items: [] } }
      })
    },
    today: "2026-08-15"
  });

  const d = w.__app.data;
  assert.equal(d.carryOver, 2000, "1600 left in main plus 400 still in the wallet");
  assert.equal(d.carryIn.main, 1600);
  assert.equal(d.carryIn.wallets.w0, 400);
  assert.equal(d.walletData.w0.budget, 400, "the wallet reopens holding what it had");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("carry-forward switched off starts the new month empty", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, carryOver: false },
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
        income: 3000, walletData: { w0: { budget: 400, items: [] } }
      })
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.data.carryOver, 0);
  /* walletData is not necessarily EMPTY: ensureWalletData() creates a slot on
     demand while rendering. What matters is that no slot holds money - an
     empty slot has a null budget and no items, and contributes nothing. */
  assert.equal(w.__app.run("getWalletBalance('w0')"), 0, "no wallet reopens with money");
  assert.ok(!w.__app.data.walletData.w0 || !w.__app.data.walletData.w0.budget);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* An app left unopened for months must land on the CURRENT cycle, carrying the
   balance once rather than compounding it per skipped month. */
test("a long gap lands on the current cycle and carries once", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-1", cycleStart: "2026-01-01", cycleNext: "2026-02-01",
        income: 1000, walletData: {}
      })
    },
    today: "2026-08-15"
  });
  const d = w.__app.data;
  assert.equal(d.cycleStart, "2026-08-01", "lands on August, not February");
  assert.equal(d.carryOver, 1000, "carried once, not seven times");
  assert.equal(Object.keys(stored(w, KEYS.archive)).length, 1, "only the month that existed is archived");
});

/* ---------------------------------------------------------------------------
   MIGRATIONS - old shapes must keep working
--------------------------------------------------------------------------- */

test("a month stored before cycles existed is stamped as 1st-to-1st", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      // no cycleStart / cycleNext, as every install had before v1.18.0
      [KEYS.data]: { month: "2026-8", income: 3000, priority: [], priorityLocked: false,
                     walletData: {}, secondChoice: [] }
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.data.cycleStart, "2026-08-01");
  assert.equal(w.__app.data.cycleNext, "2026-09-01");
  assert.equal(w.__app.data.income, 3000, "the month itself is untouched");
});

test("a month stored before carry-over existed is back-filled from the archive", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.archive]: {
        "2026-7": {
          data: { month: "2026-7", income: 2056,
                  priority: [{ name: "Rent", category: "Bills", amount: 960, paid: true, date: "2026-07-02T10:00:00.000Z" }],
                  walletData: { w0: { budget: 200, items: [] } }, secondChoice: [] },
          wallets: [{ id: "w0", name: "Grocery" }], currency: "RM", closedAt: "2026-08-01T00:00:00.000Z"
        }
      },
      // August exists but has no carryOver field at all
      [KEYS.data]: { month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
                     income: null, priority: [], priorityLocked: false, walletData: {}, secondChoice: [] }
    },
    today: "2026-08-15"
  });
  const d = w.__app.data;
  assert.equal(d.carryOver, 1096, "896 left in main plus the 200 in the wallet");
  assert.equal(d.walletData.w0.budget, 200, "the wallet is reopened");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* The back-fill must be idempotent - it writes a number even when that number
   is zero, which is what marks the month as done. */
test("the carry-over back-fill never applies twice", () => {
  const storage = {
    [KEYS.settings]: SETTINGS,
    [KEYS.archive]: {
      "2026-7": {
        data: { month: "2026-7", income: 1000, priority: [], walletData: {}, secondChoice: [] },
        wallets: [], currency: "RM", closedAt: "2026-08-01T00:00:00.000Z"
      }
    },
    [KEYS.data]: { month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
                   income: null, priority: [], priorityLocked: false, walletData: {}, secondChoice: [] }
  };

  const first = bootApp({ storage, today: "2026-08-15" });
  assert.equal(first.__app.data.carryOver, 1000);

  // Boot again from what the first run saved - the money must not double.
  const second = bootApp({
    storage: {
      [KEYS.settings]: stored(first, KEYS.settings),
      [KEYS.archive]: stored(first, KEYS.archive),
      [KEYS.data]: stored(first, KEYS.data)
    },
    today: "2026-08-15"
  });
  assert.equal(second.__app.data.carryOver, 1000, "still 1000, not 2000");
});

test("a pre-multi-wallet month is upgraded to walletData", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: { month: "2026-8", income: 1000, priority: [], priorityLocked: false,
                     secondChoice: [], groceryBudget: 300,
                     groceryItems: [{ name: "food", amount: 50, type: "take", date: "2026-08-02T10:00:00.000Z" }] }
    },
    today: "2026-08-15"
  });
  const d = w.__app.data;
  assert.equal(d.walletData.w0.budget, 300, "the old single wallet becomes wallet #1");
  assert.equal(d.walletData.w0.items.length, 1);
  assert.ok(!("groceryBudget" in d), "the legacy keys are removed");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* ---------------------------------------------------------------------------
   IMPORT VALIDATION

   Import is the only place arbitrary data enters the app. The month KEY is the
   part that matters most: a malformed one yields a cycleStart of
   "NaN-NaN-01", which no migration can repair because every later run reads it
   as already migrated.
--------------------------------------------------------------------------- */

const validFile = () => ({
  app: "monthly-money-tracker", formatVersion: 1, exportedAt: "2026-08-15T00:00:00.000Z",
  data: { month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
          income: 3000, carryOver: 0, carryIn: { main: 0, wallets: {} },
          priority: [], priorityLocked: false, walletData: {}, secondChoice: [] },
  settings: SETTINGS, archive: {}, priorityBackup: []
});

function check(file) {
  const w = bootApp({ storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() }, today: "2026-08-15" });
  return w.__app.run(`validateImport(${JSON.stringify(file)})`);
}

test("a well-formed export is accepted", () => {
  assert.equal(check(validFile()), null);
});

test("a file from before cycles existed is still accepted", () => {
  const f = validFile();
  delete f.data.cycleStart;
  delete f.data.cycleNext;
  delete f.data.carryOver;
  delete f.data.carryIn;
  assert.equal(check(f), null, "the migrations fill these in - they must not block an import");
});

test("REGRESSION: a missing or malformed month is rejected", () => {
  const missing = validFile(); delete missing.data.month;
  assert.match(check(missing), /month is missing/);

  ["", "garbage", "2026", "2026-13", "2026-0", null, 42, "2026-08"].forEach(bad => {
    const f = validFile(); f.data.month = bad;
    assert.ok(check(f), `month ${JSON.stringify(bad)} should be rejected`);
  });
});

test("a valid month key is accepted in every legal form", () => {
  ["2026-1", "2026-9", "2026-10", "2026-12"].forEach(good => {
    const f = validFile(); f.data.month = good;
    assert.equal(check(f), null, `month ${good} should be accepted`);
  });
});

test("malformed cycle dates are rejected, absent ones are not", () => {
  const bad = validFile(); bad.data.cycleStart = "not-a-date";
  assert.match(check(bad), /cycleStart/);

  const backwards = validFile();
  backwards.data.cycleStart = "2026-09-01";
  backwards.data.cycleNext = "2026-08-01";
  assert.match(check(backwards), /ends before it starts/);
});

test("a non-numeric income is rejected", () => {
  const f = validFile(); f.data.income = "lots";
  assert.match(check(f), /income isn't a number/);
  const nulled = validFile(); nulled.data.income = null;
  assert.equal(check(nulled), null, "null means not set yet, which is valid");
});

test("a bad archive key is rejected before it can break history", () => {
  const f = validFile();
  f.archive = { "not-a-month": { data: { month: "x", income: 0, priority: [], walletData: {}, secondChoice: [] } } };
  assert.match(check(f), /history has an invalid month/);
});

test("a malformed archive entry is rejected", () => {
  const f = validFile();
  f.archive = { "2026-7": { wallets: [] } };   // no data
  assert.match(check(f), /history entry for 2026-7 is malformed/);
});

/* The strongest guarantee available: whatever the app WRITES, it must accept.
   Built from the app's own live state rather than a hand-made fixture, so a
   field added to a month in future is covered without anyone remembering to
   update this test. */
test("the app's own export always passes its own validator", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.archive]: {
        "2026-7": { data: { month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
                            income: 2000, priority: [], walletData: {}, secondChoice: [] },
                    wallets: [{ id: "w0", name: "Grocery" }], currency: "RM",
                    closedAt: "2026-08-01T00:00:00.000Z" }
      },
      [KEYS.data]: month({ income: 3000, carryOver: 500,
        carryIn: { main: 500, wallets: {} },
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-08-02T10:00:00.000Z" }],
        walletData: { w0: { budget: 200, items: [] } },
        secondChoice: [{ name: "Lunch", category: "Food / Drink", amount: 30, type: "take", date: "2026-08-03T10:00:00.000Z" }] })
    },
    today: "2026-08-15"
  });

  const problem = w.__app.run(`validateImport({
    app: "monthly-money-tracker", formatVersion: 1, exportedAt: new Date().toISOString(),
    data, settings, archive, priorityBackup: []
  })`);
  assert.equal(problem, null, `the app cannot re-import its own export: ${problem}`);
});

test("arrays are not mistaken for objects", () => {
  const f = validFile(); f.data.walletData = [];
  assert.match(check(f), /wallet data is malformed/);
  const g = validFile(); g.settings = [];
  assert.match(check(g), /settings are malformed/);
});

/* ---------------------------------------------------------------------------
   RENDERING - the figures on screen must match the maths behind them
--------------------------------------------------------------------------- */

test("the projection hides when nothing is owed and returns when it is", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        priority: [{ name: "Rent", category: "Bills", amount: 200, paid: false, date: "2026-08-02T10:00:00.000Z" }] })
    },
    today: "2026-08-15"
  });
  const line = w.document.getElementById("projection-line");
  assert.ok(!line.classList.contains("hidden"), "a bill is owed, so it shows");
  assert.match(line.textContent, /Projected Balance RM 800\.00/);

  w.__app.run("data.priority[0].paid = true; calculateRemaining();");
  assert.ok(line.classList.contains("hidden"), "nothing owed, so it hides");

  w.__app.run("data.priority[0].paid = false; calculateRemaining();");
  assert.ok(!line.classList.contains("hidden"), "and returns when unticked");
});

test("carried money opens each history without being counted twice", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: null, carryOver: 1096,
        carryIn: { main: 896, wallets: { w0: 200 } },
        walletData: { w0: { budget: 200, items: [] } } })
    },
    today: "2026-08-15"
  });

  const scRows = [...w.document.querySelectorAll("#sc-table tr")].map(r => r.textContent.replace(/\s+/g, " ").trim());
  assert.match(scRows[0], /Brought forward .* \+ RM 896\.00/);

  const walletRows = [...w.document.querySelectorAll("#wallets-container tbody tr")]
    .map(r => r.textContent.replace(/\s+/g, " ").trim());
  assert.match(walletRows[0], /Brought forward .* \+ RM 200\.00/);

  // The rows are display only - the books must be untouched by them.
  assert.equal(w.__app.run("totalIncomeOf(data, allWallets())"), 1096);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("total income shows the carried balance, matching the chart", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: null, carryOver: 1095.97,
        carryIn: { main: 882.01, wallets: { w0: 213.96 } },
        walletData: { w0: { budget: 213.96, items: [] } } })
    },
    today: "2026-08-15"
  });
  assert.equal(w.document.getElementById("total-income-display").textContent, "RM 1,095.97");
  assert.equal(w.document.getElementById("remaining-money").textContent, "RM 882.01");
});
