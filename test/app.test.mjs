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
import { readFileSync } from "node:fs";
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
   MONTH START SETTING

   The cycle's stored start never moves underneath the user. Changing the day
   only schedules a future cycleNext, including when the first candidate has
   already passed or the chosen day does not exist in the next month.
--------------------------------------------------------------------------- */

function changeMonthStart(w, day) {
  const select = w.document.getElementById("month-start-select");
  select.value = String(day);
  select.dispatchEvent(new w.Event("change"));
}

test("changing the month start schedules the chosen future boundary", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  changeMonthStart(w, 20);

  assert.equal(w.__app.settings.monthStartDay, 20);
  assert.equal(w.__app.data.cycleStart, "2026-08-01", "the active cycle still starts where it did");
  assert.equal(w.__app.data.cycleNext, "2026-09-20", "only its future boundary moves");
  assert.equal(stored(w, KEYS.data).cycleNext, "2026-09-20", "the new boundary is persisted");
  assert.equal(stored(w, KEYS.settings).monthStartDay, 20);
  assert.equal(w.__jsdomErrors.length, 0, "the real dropdown handler must not throw");
});

test("an already-passed candidate is deferred instead of cutting this cycle short", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, monthStartDay: 25 },
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-25", cycleNext: "2026-08-25"
      })
    },
    today: "2026-08-04"
  });

  changeMonthStart(w, 1); // 1 Aug has passed, so the setting begins 1 Sep.

  assert.equal(w.__app.data.month, "2026-7", "the live month is not archived early");
  assert.equal(w.__app.data.cycleNext, "2026-09-01");
  assert.equal(w.__app.run("checkCycleRollover()"), false, "the new boundary is still in the future");
  assert.match(w.__app.run("dayRangeLabel(data.cycleStart, data.cycleNext)"), /38 days/,
    "the stored range, including the deferred month, is the one displayed");
  assert.match(w.document.getElementById("current-month").textContent, /(Aug.*31.*2026|31.*Aug.*2026)/,
    "the month header ends the cycle on 31 Aug in either locale order");
  assert.match(w.document.getElementById("month-start-note").textContent, /(Sep.*1.*2026|1.*Sep.*2026)/,
    "the note names the real deferred boundary in either locale order");
});

test("a chosen day clamps safely in a shorter next month", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, monthStartDay: 31 },
      [KEYS.data]: month({
        month: "2026-1", cycleStart: "2026-01-31", cycleNext: "2026-02-28"
      })
    },
    today: "2026-02-10"
  });

  changeMonthStart(w, 30);

  assert.equal(w.__app.data.cycleNext, "2026-02-28", "February clamps the 30th to its last day");
  assert.equal(w.__app.run("checkCycleRollover()"), false);
  assert.equal(w.__jsdomErrors.length, 0);
});

test("month-start changes use today's live date in a long-running PWA", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, monthStartDay: 25 },
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-25", cycleNext: "2026-08-25"
      })
    },
    today: "2026-08-02"
  });

  // The app stays alive while 3 Aug passes. A startup-date comparison would
  // still accept that now-past boundary and immediately close the cycle.
  w.__setToday("2026-08-04");
  changeMonthStart(w, 3);

  assert.equal(w.__app.data.cycleNext, "2026-09-03");
  assert.equal(w.__app.run("checkCycleRollover()"), false);
  assert.equal(w.__jsdomErrors.length, 0);
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
   LIVE ROLLOVER - the app outliving the cycle it was opened in

   An installed PWA is not a page load. It stays resident for days, so the
   startup rollover alone left `data` pointing at a month the user considered
   closed, and every entry added after midnight was written into it silently.
--------------------------------------------------------------------------- */

/* REGRESSION: the reported shape of the bug. Boot inside a cycle, move the
   clock past its end WITHOUT reloading, and the app must close the month by
   itself. Reverting checkCycleRollover fails this on the first assertion -
   data.month stays "2026-7". */
test("REGRESSION: the cycle rolls over while the app stays open", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
        income: 3000,
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-07-02T10:00:00.000Z" }]
      })
    },
    today: "2026-07-20"
  });

  assert.equal(w.__app.data.month, "2026-7", "still July while the app is open");
  assert.equal(Object.keys(w.__app.archive).length, 0, "nothing archived yet");

  // Midnight passes with the app still in memory, then the user returns to it.
  w.__setToday("2026-08-01");
  assert.equal(w.__app.run("checkCycleRollover()"), true, "the rollover must fire");

  assert.equal(w.__app.data.month, "2026-8", "August is now the live month");
  assert.ok(w.__app.archive["2026-7"], "July was archived");
  assert.equal(w.__app.archive["2026-7"].data.income, 3000, "with its figures intact");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* The archived copy must survive `data` being emptied in place. performRollover
   mutates rather than reassigns, so archiving the live object by reference
   would leave history holding a month that gets blanked a few lines later. */
test("a live rollover archives a real copy, not a reference to the live month", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01", income: 2500
      })
    },
    today: "2026-07-15"
  });

  w.__setToday("2026-08-02");
  w.__app.run("checkCycleRollover()");

  assert.equal(w.__app.archive["2026-7"].data.income, 2500, "the archived month keeps its income");
  assert.equal(w.__app.archive["2026-7"].data.month, "2026-7", "and its own key");
  assert.equal(w.__app.data.income, null, "while the live month is genuinely fresh");
});

/* An entry added after the rollover belongs to the new month. This is the
   user-visible consequence of the bug: money logged on the 1st used to land
   in a month already sitting in History. */
test("an entry added after a live rollover lands in the new month", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01", income: 3000
      })
    },
    today: "2026-07-28"
  });

  w.__setToday("2026-08-01");
  w.__app.run("checkCycleRollover()");
  w.__app.run(`
    data.secondChoice.push({ name: "coffee", category: "Food / Drink", amount: 12, type: "take", date: new Date().toISOString() });
    saveData();
  `);

  assert.equal(w.__app.data.secondChoice.length, 1, "the entry is in the live month");
  assert.equal((w.__app.archive["2026-7"].data.secondChoice || []).length, 0,
    "and not in the archived one");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* Nothing to do mid-cycle. A check that rolled over early would archive a
   month the user is still using. */
test("checking mid-cycle does nothing", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01", income: 3000
      })
    },
    today: "2026-08-10"
  });

  w.__setToday("2026-08-31");
  assert.equal(w.__app.run("checkCycleRollover()"), false, "the last day is still inside the cycle");
  assert.equal(w.__app.data.month, "2026-8");
  assert.equal(Object.keys(w.__app.archive).length, 0, "nothing archived");
});

/* Skipping several cycles while backgrounded must land on today's cycle and
   carry the balance exactly once - the same guarantee the startup path has. */
test("a live rollover across several cycles lands on today's, carrying once", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-1", cycleStart: "2026-01-01", cycleNext: "2026-02-01", income: 1000
      })
    },
    today: "2026-01-15"
  });

  w.__setToday("2026-05-09");
  w.__app.run("checkCycleRollover()");

  assert.equal(w.__app.data.cycleStart, "2026-05-01", "lands on May, not February");
  assert.equal(w.__app.data.carryOver, 1000, "carried once, not four times");
  assert.equal(Object.keys(w.__app.archive).length, 1, "only the month that existed is archived");
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
   EDITING AN ENTRY

   Editing writes to the stored object in place, so the entry keeps its
   position and its identity - deletion resolves rows by object, not index.
   These check that the books follow the edit and that the things which must
   NOT be editable stay inert.
--------------------------------------------------------------------------- */

const dated = "2026-08-05T10:00:00.000Z";

test("editing a Second choice entry updates the books", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [{ name: "Lnuch", category: "Food / Drink", amount: 30, type: "take", date: dated }] })
    },
    today: "2026-08-15"
  });

  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 970);

  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  const doc = w.document;
  doc.getElementById("sc-name").value = "Lunch";
  doc.getElementById("sc-amount").value = "45";
  doc.getElementById("add-money").click();

  const item = w.__app.data.secondChoice[0];
  assert.equal(item.name, "Lunch", "the typo is fixed");
  assert.equal(item.amount, 45);
  assert.equal(item.type, "take", "the type is not changed by an edit");
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 955);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("editing preserves the entry's date rather than moving it to today", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [{ name: "Taxi", category: "Transport", amount: 20, type: "take", date: dated }] })
    },
    today: "2026-08-15"
  });
  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  assert.equal(w.document.getElementById("sc-date").value, "2026-08-05",
    "the form opens on the entry's own date");
  w.document.getElementById("sc-amount").value = "25";
  w.document.getElementById("add-money").click();
  assert.match(w.__app.data.secondChoice[0].date, /^2026-08-05/, "and the date survives the save");
});

test("a reimbursement stays a reimbursement through an edit", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [
          { name: "Meal", category: "Food / Drink", amount: 50, type: "take", date: dated },
          { name: "Repaid", category: "Food / Drink", amount: 50, type: "add", newMoney: false, date: dated }
        ] })
    },
    today: "2026-08-15"
  });
  const before = w.__app.run("totalIncomeOf(data, allWallets())");
  w.__app.run(`editSecondChoice(data.secondChoice[1])`);
  w.document.getElementById("sc-name").value = "Repaid by Sam";
  w.document.getElementById("add-money").click();

  const item = w.__app.data.secondChoice[1];
  assert.equal(item.newMoney, false, "the question is not silently re-answered");
  assert.equal(w.__app.run("totalIncomeOf(data, allWallets())"), before, "income is unchanged");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("an edit is rejected when the amount is invalid", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [{ name: "Taxi", category: "Transport", amount: 20, type: "take", date: dated }] })
    },
    today: "2026-08-15"
  });
  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  w.document.getElementById("sc-amount").value = "-5";
  w.document.getElementById("add-money").click();

  assert.equal(w.__app.data.secondChoice[0].amount, 20, "the bad value is not written");
  assert.ok(w.__app.run("editing !== null"), "and the form stays open to be corrected");
});

test("cancelling an edit leaves the entry alone", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [{ name: "Taxi", category: "Transport", amount: 20, type: "take", date: dated }] })
    },
    today: "2026-08-15"
  });
  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  w.document.getElementById("sc-amount").value = "999";
  w.document.getElementById("cancel-sc-edit").click();

  assert.equal(w.__app.data.secondChoice[0].amount, 20, "nothing is written");
  assert.ok(w.__app.run("editing === null"), "and edit mode ends");
  assert.equal(w.document.getElementById("sc-amount").value, "", "the form is cleared");
});

/* A transfer's amount is mirrored in a twin sharing a txId. Editing one half
   alone would create or destroy money, so transfers are not editable at all -
   deletion already removes both halves atomically. */
test("REGRESSION: a transfer half cannot be edited", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        walletData: { w0: { budget: 300, items: [
          { name: "back", amount: 50, type: "out", toId: "main", txId: "t1", date: dated }] } },
        secondChoice: [
          { name: "back", category: "Transfer", amount: 50, type: "add", transfer: true, txId: "t1", date: dated }] })
    },
    today: "2026-08-15"
  });

  assert.equal(w.__app.run("isEditable(data.secondChoice[0])"), false, "the main-side half");
  assert.equal(w.__app.run("isEditable(data.walletData.w0.items[0])"), false, "and the wallet-side half");

  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  assert.ok(w.__app.run("editing === null"), "opening an edit on one does nothing");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("editing a wallet item updates the wallet and the books", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        walletData: { w0: { budget: 300, items: [{ name: "food", amount: 50, type: "take", date: dated }] } } })
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.run("getWalletBalance('w0')"), 250);

  const section = w.document.querySelector("#wallets-container .wallet-section");
  w.__app.run(`document.querySelector("#wallets-container .wallet-section")._editItem(data.walletData.w0.items[0])`);
  section.querySelector("[data-role='item-amount']").value = "80";
  section.querySelector("[data-role='add-btn']").click();

  assert.equal(w.__app.data.walletData.w0.items[0].amount, 80);
  assert.equal(w.__app.run("getWalletBalance('w0')"), 220);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* The take cap has to be measured against the balance WITHOUT the item being
   edited, or its own amount counts against the headroom and an unchanged save
   would be refused. */
test("a wallet take can be edited up to the full balance", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        walletData: { w0: { budget: 300, items: [{ name: "food", amount: 100, type: "take", date: dated }] } } })
    },
    today: "2026-08-15"
  });
  const section = w.document.querySelector("#wallets-container .wallet-section");

  w.__app.run(`document.querySelector("#wallets-container .wallet-section")._editItem(data.walletData.w0.items[0])`);
  section.querySelector("[data-role='item-amount']").value = "300";
  section.querySelector("[data-role='add-btn']").click();
  assert.equal(w.__app.data.walletData.w0.items[0].amount, 300, "the whole balance is allowed");
  assert.equal(w.__app.run("getWalletBalance('w0')"), 0);

  // Beyond it is still refused - that would drive the wallet negative.
  w.__app.run(`document.querySelector("#wallets-container .wallet-section")._editItem(data.walletData.w0.items[0])`);
  w.document.querySelector("#wallets-container .wallet-section [data-role='item-amount']").value = "400";
  w.document.querySelector("#wallets-container .wallet-section [data-role='add-btn']").click();
  assert.equal(w.__app.data.walletData.w0.items[0].amount, 300, "over the balance is refused");
});

test("editing a priority bill leaves its paid state alone", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        priority: [{ name: "Electricty", category: "Bills", amount: 200, paid: true, date: dated }] })
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 800);

  w.__app.run(`editPriorityBill(data.priority[0])`);
  w.document.getElementById("pb-name").value = "Electricity";
  w.document.getElementById("pb-amount").value = "220";
  w.document.getElementById("add-priority").click();

  const bill = w.__app.data.priority[0];
  assert.equal(bill.name, "Electricity");
  assert.equal(bill.paid, true, "editing a bill is not the same as unticking it");
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 780);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* The lock exists to freeze the month's bills. Editing through it would defeat
   the point, and the form is hidden in that state anyway. */
test("a locked priority list cannot be edited", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000, priorityLocked: true,
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: false, date: dated }] })
    },
    today: "2026-08-15"
  });
  w.__app.run(`editPriorityBill(data.priority[0])`);
  assert.ok(w.__app.run("editing === null"), "no edit opens while locked");
  assert.equal(w.__app.data.priority[0].name, "Rent");
});

/* An edit whose target is deleted would write to an orphaned object on save,
   silently doing nothing. */
test("deleting the entry being edited closes the edit", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 1000,
        secondChoice: [{ name: "Taxi", category: "Transport", amount: 20, type: "take", date: dated }] })
    },
    today: "2026-08-15"
  });
  w.__app.run(`editSecondChoice(data.secondChoice[0])`);
  assert.ok(w.__app.run("editing !== null"));
  w.__app.run(`deleteSecondChoiceItem(data.secondChoice[0])`);
  assert.ok(w.__app.run("editing === null"), "the edit is abandoned with its target");
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

/* The reported import defect: the top-level wallet list was checked only for
   being an array, so `[null]` passed, replaced storage, and crashed on the
   next boot when activeWallets tried to read `deleted` from null. The same
   rule applies to every nested collection the render path dereferences. */
test("REGRESSION: malformed nested imports are rejected before they can blank the app", () => {
  const badWallet = validFile();
  badWallet.settings = { ...SETTINGS, wallets: [null] };
  assert.match(check(badWallet), /wallet list.*malformed wallet/i);

  const badWalletData = validFile();
  badWalletData.data.walletData = { w0: null };
  assert.match(check(badWalletData), /wallet data is malformed/i);

  const badWalletItem = validFile();
  badWalletItem.data.walletData = { w0: { budget: 100, items: [null] } };
  assert.match(check(badWalletItem), /malformed item/i);

  const badBill = validFile();
  badBill.data.priority = [null];
  assert.match(check(badBill), /priority bills.*malformed entry/i);

  const badSecondChoice = validFile();
  badSecondChoice.data.secondChoice = [null];
  assert.match(check(badSecondChoice), /Second choice.*malformed entry/i);

  const badCategories = validFile();
  badCategories.settings = {
    ...SETTINGS,
    categories: { priority: ["Bills", "Others"], secondChoice: [null, "Others"] }
  };
  assert.match(check(badCategories), /secondChoice categories are malformed/i);
});

test("malformed data inside an archived month is rejected too", () => {
  const f = validFile();
  f.archive = {
    "2026-7": {
      data: {
        month: "2026-7", income: 1000, priority: [], secondChoice: [],
        walletData: { w0: { budget: 100, items: [null] } }
      },
      wallets: [{ id: "w0", name: "Grocery" }], currency: "RM"
    }
  };
  assert.match(check(f), /history entry.*malformed item/i);

  const g = validFile();
  g.archive = {
    "2026-7": {
      data: { month: "2026-7", income: 1000, priority: [], secondChoice: [], walletData: {} },
      wallets: [null], currency: "RM"
    }
  };
  assert.match(check(g), /history wallet list.*malformed wallet/i);
});

test("impossible calendar dates are rejected rather than only format-checked", () => {
  const f = validFile();
  f.data.cycleNext = "2026-02-31";
  assert.match(check(f), /cycleNext isn't a valid date/);
});

test("nested validation is read-only when a file is rejected", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month({ income: 4321 }) },
    today: "2026-08-15"
  });
  const beforeData = w.localStorage.getItem(KEYS.data);
  const beforeSettings = w.localStorage.getItem(KEYS.settings);
  const bad = validFile();
  bad.settings = { ...SETTINGS, wallets: [null] };

  const problem = w.__app.run(`validateImport(${JSON.stringify(bad)})`);

  assert.ok(problem, "the file is refused");
  assert.equal(w.localStorage.getItem(KEYS.data), beforeData, "the current month is untouched");
  assert.equal(w.localStorage.getItem(KEYS.settings), beforeSettings, "settings are untouched");
  assert.equal(w.__app.run("pendingImport"), null, "the file is never armed for confirmation");
});

test("a valid legacy single-wallet export still passes nested validation", () => {
  const f = validFile();
  delete f.data.walletData;
  f.data.groceryBudget = 300;
  f.data.groceryItems = [
    { name: "food", amount: 50, type: "take", date: "2026-08-03T10:00:00.000Z" }
  ];
  /* validFile deliberately shares the standard settings fixture. Clone it
     before removing a legacy-absent field so later tests keep their wallet. */
  f.settings = { ...SETTINGS };
  delete f.settings.wallets;
  f.settings.secondWalletEnabled = true;
  f.settings.secondWalletName = "Second Wallet";
  f.archive = {
    "2026-7": {
      data: {
        month: "2026-7", income: 1000, priority: [], secondChoice: [],
        groceryBudget: 200,
        groceryItems: [{ name: "old food", amount: 25, type: "take" }]
      },
      walletEnabled: true, walletName: "Second Wallet", currency: "RM"
    }
  };

  assert.equal(check(f), null, "the existing post-import migrations can safely upgrade it");
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

/* ---------------------------------------------------------------------------
   CUSTOM CATEGORIES

   The two entry dropdowns were hardcoded markup until v1.22.0 - three labels
   for all everyday spending. They come from settings.categories now, which
   means the migration seeding them, and the guarantee that removing one never
   rewrites an entry already filed under it, both need covering.
--------------------------------------------------------------------------- */

const catValues = (w, id) =>
  [...w.document.getElementById(id).querySelectorAll("option")]
    .map(o => o.value)
    .filter(Boolean);

test("an install with no categories is seeded with the old hardcoded list", () => {
  // SETTINGS deliberately has no `categories` key - the pre-v1.22.0 shape.
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  assert.deepEqual([...w.__app.settings.categories.priority],
    ["Bills", "Subscription", "Others"], "exactly what the markup used to hold");
  assert.deepEqual([...w.__app.settings.categories.secondChoice],
    ["Food / Drink", "Transport", "Others"]);
  // And the dropdowns are actually built from them.
  assert.deepEqual(catValues(w, "pb-category"), ["Bills", "Subscription", "Others"]);
  assert.deepEqual(catValues(w, "sc-category"), ["Food / Drink", "Transport", "Others"]);
});

test("a stored category list drives the dropdowns", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: {
        ...SETTINGS,
        categories: { priority: ["Rent", "Others"], secondChoice: ["Coffee", "Petrol", "Others"] }
      },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });
  assert.deepEqual(catValues(w, "pb-category"), ["Rent", "Others"]);
  assert.deepEqual(catValues(w, "sc-category"), ["Coffee", "Petrol", "Others"]);
});

/* "Others" is where monthTotalsOf files anything with no category, so a list
   missing it would send that spending to a label the user cannot see. */
test("the fallback category is restored if it is missing", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, categories: { priority: ["Rent"], secondChoice: ["Coffee"] } },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });
  assert.ok(w.__app.settings.categories.priority.includes("Others"));
  assert.ok(w.__app.settings.categories.secondChoice.includes("Others"));
});

test("a junk category list falls back rather than throwing", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, categories: { priority: "nonsense", secondChoice: [1, null, "", "Ok", "Ok"] } },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });
  assert.equal(w.__jsdomErrors.length, 0, "boot must survive a hand-edited shape");
  assert.deepEqual([...w.__app.settings.categories.priority], ["Bills", "Subscription", "Others"],
    "an unusable list falls back to the defaults");
  assert.deepEqual([...w.__app.settings.categories.secondChoice], ["Ok", "Others"],
    "junk entries and the duplicate are dropped, the fallback added");
});

test("adding a category puts it before the fallback and into the dropdown", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  w.__app.run(`
    addCategoryTarget = "secondChoice";
    document.getElementById("add-category-name").value = "Groceries";
    confirmAddCategory();
  `);

  assert.deepEqual([...w.__app.settings.categories.secondChoice],
    ["Food / Drink", "Transport", "Groceries", "Others"], "Others stays last");
  assert.ok(catValues(w, "sc-category").includes("Groceries"));
});

test("a category cannot duplicate another, or take a wallet's name", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Transport")`), "duplicate");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "grocery")`), "wallet",
    "case-insensitive against the existing Grocery wallet");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "  ")`), "empty");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Groceries")`), null);
});

/* The reverse direction: a wallet must not take a category's name either, or
   the two would merge into one chart slice. A CUSTOM category has to be
   reserved just as firmly as a built-in one. */
test("a wallet cannot take a custom category's name", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, categories: { priority: ["Others"], secondChoice: ["Petrol", "Others"] } },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.run(`walletNameConflict("Petrol")`), "reserved");
  assert.equal(w.__app.run(`walletNameConflict("petrol")`), "reserved", "case-insensitive");
});

/* The important guarantee: removing a category is a dropdown change, not a
   data change. Rewriting entries would alter figures the user already
   checked - including archived months, which are a record of what happened. */
test("removing a category leaves entries filed under it untouched", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        secondChoice: [
          { name: "grab", category: "Transport", amount: 13, type: "take", date: "2026-08-02T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const before = w.__app.run(`monthTotalsOf(data, allWallets()).categories["Transport"]`);
  assert.equal(before, 13);

  w.__app.run(`
    categoryPendingDelete = { list: "secondChoice", name: "Transport" };
    document.getElementById("confirm-delete-category").click();
  `);

  assert.ok(!catValues(w, "sc-category").includes("Transport"), "gone from the dropdown");
  assert.equal(w.__app.data.secondChoice[0].category, "Transport", "but the entry is unchanged");
  assert.equal(w.__app.run(`monthTotalsOf(data, allWallets()).categories["Transport"]`), 13,
    "and it still counts toward spending");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* Editing an entry whose category was removed must not silently recategorise
   it. The select re-offers the original, marked, so an unchanged save is
   genuinely unchanged. */
test("editing an entry keeps a category that has since been removed", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        secondChoice: [
          { name: "grab", category: "Transport", amount: 13, type: "take", date: "2026-08-02T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  w.__app.run(`
    settings.categories.secondChoice = ["Food / Drink", "Others"];
    renderAllCategoryOptions();
    editSecondChoice(data.secondChoice[0]);
  `);

  const sel = w.document.getElementById("sc-category");
  assert.equal(sel.value, "Transport", "the entry's own category is still selected");
  assert.ok([...sel.querySelectorAll("option")].some(o => o.textContent.includes("(removed)")),
    "and marked as no longer offered");
});

/* The fallback cannot be removed - the settings row shows a locked marker
   instead of a delete button. */
test("the fallback category has no delete button", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  // Ordinary rows carry a rename input; the fallback carries a plain label.
  const rowName = r => {
    const input = r.querySelector(".category-name-input");
    return input ? input.value : r.querySelector(".category-name").textContent;
  };
  const rows = [...w.document.querySelectorAll("#cat-secondChoice-list .wallet-setting-row")];

  const others = rows.find(r => rowName(r) === "Others");
  assert.ok(others, "the fallback is listed");
  assert.equal(others.querySelector(".wallet-delete-btn"), null, "with no way to remove it");
  assert.equal(others.querySelector(".category-name-input"), null, "and no way to rename it");
  assert.ok(others.querySelector(".category-locked"), "and a marker saying why");

  const transport = rows.find(r => rowName(r) === "Transport");
  assert.ok(transport.querySelector(".wallet-delete-btn"), "an ordinary category can be removed");
  assert.ok(transport.querySelector(".category-name-input"), "and renamed in place");
});

/* Colour follows the ENTITY, never the chart's sort order - a category must not
   change colour because its spending moved it up or down the bar. */
test("a category's colour does not depend on the chart's ordering", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  const first = w.__app.run(`categoryColor("Others")`);
  assert.match(first, /^#[0-9a-f]{6}$/i);
  assert.equal(w.__app.run(`categoryColor("Others")`), first, "stable across calls");

  // A name settings has never heard of still draws rather than coming back
  // undefined - an archived month can hold a since-deleted category.
  assert.match(w.__app.run(`categoryColor("Deleted Long Ago")`), /^#[0-9a-f]{6}$/i);
});

/* REGRESSION: a wallet and a category came out the identical violet, side by
   side in the same chart - built-ins were pinned to slots while wallets were
   hashed into the same list, so nothing stopped the two meeting. Every named
   thing now takes its slot from one registry. */
test("REGRESSION: no two entities share a hue while slots remain", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: {
        ...SETTINGS,
        wallets: [{ id: "w0", name: "Grocery" }, { id: "w1", name: "Fuel" }]
      },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });

  const names = w.__app.run("chartNameRegistry()");
  const slots = w.__app.run("CHART_SERIES.length");
  assert.ok(names.length <= slots,
    `this fixture must fit in the ramp to prove the point (${names.length} names, ${slots} slots)`);

  const colors = names.map(n => w.__app.run(`categoryColor(${JSON.stringify(n)})`));
  assert.equal(new Set(colors).size, colors.length,
    `every name got its own hue: ${JSON.stringify(names.map((n, i) => [n, colors[i]]))}`);

  // And the wallets specifically, which is where the collision actually showed.
  const w0 = w.__app.run("walletColor(0)");
  const w1 = w.__app.run("walletColor(1)");
  assert.notEqual(w0, w1, "two wallets differ");
  assert.notEqual(w0, w.__app.run(`categoryColor("Food / Drink")`),
    "and a wallet does not collide with a category");
});

/* ---------------------------------------------------------------------------
   TIER 3 - dates, undo depth, the priority lock, wallet shortfalls
--------------------------------------------------------------------------- */

/* A back-dated entry still counts toward the month it was entered in - that
   is deliberate - so the row has to say the two disagree rather than render a
   bare "15 Jun" that looks like it belongs here. */
test("an entry dated outside the cycle shows its year and is marked", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        secondChoice: [
          { name: "inside", category: "Others", amount: 5, type: "take", date: "2026-08-10T10:00:00.000Z" },
          { name: "outside", category: "Others", amount: 7, type: "take", date: "2026-06-15T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const cells = [...w.document.querySelectorAll("#sc-table tr .date-stamp")];
  const inside = cells.find(c => !c.classList.contains("is-outside"));
  const outside = cells.find(c => c.classList.contains("is-outside"));

  assert.ok(inside, "an in-cycle entry is not marked");
  assert.doesNotMatch(inside.textContent, /2026/, "and needs no year");

  assert.ok(outside, "the June entry is marked");
  assert.match(outside.textContent, /2026/, "with the year spelled out");
  assert.match(outside.getAttribute("title"), /counted in it/, "and an explanation");

  // Marking it must not change what it counts toward.
  assert.equal(w.__app.run(`monthTotalsOf(data, allWallets()).spent`), 12);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* REGRESSION: the undo stack. Deleting twice in quick succession used to
   strand the first deletion - the toast showed only the second and the first
   could never be taken back. */
test("REGRESSION: two quick deletions can both be undone", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        secondChoice: [
          { name: "one", category: "Others", amount: 10, type: "take", date: "2026-08-02T10:00:00.000Z" },
          { name: "two", category: "Others", amount: 20, type: "take", date: "2026-08-03T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  w.__app.run(`
    deleteSecondChoiceItem(data.secondChoice.find(i => i.name === "one"));
    deleteSecondChoiceItem(data.secondChoice.find(i => i.name === "two"));
  `);
  assert.equal(w.__app.data.secondChoice.length, 0, "both gone");

  const undo = w.document.getElementById("undo-btn");
  undo.click();
  assert.deepEqual([...w.__app.data.secondChoice].map(i => i.name), ["two"],
    "the most recent deletion comes back first");

  // The toast must re-offer the earlier one rather than going quiet.
  assert.ok(!w.document.getElementById("undo-toast").classList.contains("hidden"),
    "the toast stays up for the next undo");
  undo.click();
  assert.deepEqual([...w.__app.data.secondChoice].map(i => i.name).sort(), ["one", "two"],
    "and the first deletion is recoverable too");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("the undo stack is bounded, committing the oldest beyond the cap", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });
  const committed = w.__app.run(`
    (() => {
      const done = [];
      for (let i = 0; i < 13; i++) showUndo("x" + i, () => done.push(i), () => {});
      return { done: done.length, depth: undoStack.length };
    })()
  `);
  assert.equal(committed.depth, 10, "the stack is capped");
  assert.equal(committed.done, 3, "the three oldest were committed rather than dropped");
});

/* The lock existed to stop accidental edits, but had no way out short of the
   hidden full reset - which wipes the month. */
test("the priority lock can be undone without resetting the month", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-08-02T10:00:00.000Z" }],
        priorityLocked: true
      })
    },
    today: "2026-08-15"
  });

  const form = w.document.getElementById("priority-form");
  const badge = w.document.getElementById("priority-lock-badge");
  assert.equal(form.style.display, "none", "locked hides the form");
  assert.ok(!badge.classList.contains("hidden"), "and shows the badge");

  badge.click();
  w.document.getElementById("confirm-priority").click();

  assert.equal(w.__app.data.priorityLocked, false);
  assert.notEqual(form.style.display, "none", "the form comes back");
  assert.ok(badge.classList.contains("hidden"), "and the badge goes away");
  assert.equal(w.__app.data.priority.length, 1, "the bills themselves are untouched");
  assert.equal(w.__app.data.income, 3000, "and so is the rest of the month");
});

test("locking still works, and the shared modal says which way it is going", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: false, date: "2026-08-02T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  w.document.getElementById("save-priority").click();
  assert.match(w.document.getElementById("priority-modal-title").textContent, /Save/);
  w.document.getElementById("confirm-priority").click();
  assert.equal(w.__app.data.priorityLocked, true);

  w.document.getElementById("priority-lock-badge").click();
  assert.match(w.document.getElementById("priority-modal-title").textContent, /Unlock/);
});

/* A wallet take beyond its balance used to be a bare red border. It now
   offers the ways to make the take legal - but never "record it anyway",
   because a negative wallet balance cannot be represented. */
test("taking more than a wallet holds offers a top-up instead of failing silently", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 3000, walletData: { w0: { budget: 50, items: [] } } })
    },
    today: "2026-08-15"
  });

  const section = w.document.querySelector('.wallet-section[data-wallet-id="w0"]');
  section.querySelector("[data-role='item-name']").value = "big shop";
  section.querySelector("[data-role='item-amount']").value = "120";
  section.querySelector("[data-role='take-btn']").click();

  const modal = w.document.getElementById("overspend-modal");
  assert.ok(!modal.classList.contains("hidden"), "the prompt opens");
  assert.match(w.document.getElementById("overspend-summary").textContent, /70\.00 more/,
    "and names the shortfall");

  const options = [...w.document.querySelectorAll("#overspend-options .transfer-dest-btn")]
    .map(b => b.textContent);
  assert.ok(options.some(t => /from main balance/.test(t)), "main can cover it");
  assert.ok(!options.some(t => /Record it anyway/.test(t)),
    "but a negative wallet balance is never offered");

  // Taking the top-up must leave the wallet at zero, not negative.
  w.document.querySelector("#overspend-options .transfer-dest-btn").click();
  assert.equal(w.__app.run(`getWalletBalance("w0")`), 0);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("a wallet shortfall nothing can cover explains itself", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({ income: 60, walletData: { w0: { budget: 50, items: [] } } })
    },
    today: "2026-08-15"
  });

  const section = w.document.querySelector('.wallet-section[data-wallet-id="w0"]');
  section.querySelector("[data-role='item-name']").value = "too much";
  section.querySelector("[data-role='item-amount']").value = "500";
  section.querySelector("[data-role='take-btn']").click();

  assert.equal(w.document.querySelectorAll("#overspend-options .transfer-dest-btn").length, 0);
  assert.match(w.document.getElementById("overspend-options").textContent, /Raise this wallet's budget/);
});

/* ---------------------------------------------------------------------------
   CATEGORY RENAME

   Categories are raw strings, not ids - the chart keys slices by name and
   every entry stores the name it was given. A rename that only touched the
   settings list would orphan every entry filed under the old one: still
   counting, under a label no dropdown offers.
--------------------------------------------------------------------------- */

const catRow = (w, list, name) =>
  [...w.document.querySelectorAll(`#cat-${list}-list .wallet-setting-row`)]
    .find(r => {
      const i = r.querySelector(".category-name-input");
      return (i ? i.value : r.querySelector(".category-name").textContent) === name;
    });

test("renaming a category re-files this month's entries under the new name", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        secondChoice: [
          { name: "grab", category: "Transport", amount: 13, type: "take", date: "2026-08-02T10:00:00.000Z" },
          { name: "mamak", category: "Food / Drink", amount: 30, type: "take", date: "2026-08-03T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const before = w.__app.run(`monthTotalsOf(data, allWallets()).spent`);

  const input = catRow(w, "secondChoice", "Transport").querySelector(".category-name-input");
  input.value = "Travel";
  input.dispatchEvent(new w.Event("blur"));

  assert.ok([...w.__app.settings.categories.secondChoice].includes("Travel"));
  assert.ok(![...w.__app.settings.categories.secondChoice].includes("Transport"));
  assert.equal(w.__app.data.secondChoice[0].category, "Travel", "the entry followed the rename");
  assert.equal(w.__app.data.secondChoice[1].category, "Food / Drink", "others are untouched");

  const totals = w.__app.run(`monthTotalsOf(data, allWallets()).categories`);
  assert.equal(totals["Travel"], 13, "spending is filed under the new name");
  assert.equal(totals["Transport"], undefined, "and nothing is stranded under the old one");
  assert.equal(w.__app.run(`monthTotalsOf(data, allWallets()).spent`), before,
    "a rename changes a label, never an amount");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("renaming keeps its position in the list, and the dropdown follows", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  const input = catRow(w, "secondChoice", "Food / Drink").querySelector(".category-name-input");
  input.value = "Eating out";
  input.dispatchEvent(new w.Event("blur"));

  assert.deepEqual([...w.__app.settings.categories.secondChoice],
    ["Eating out", "Transport", "Others"], "renamed in place, Others still last");
  assert.deepEqual(catValues(w, "sc-category"), ["Eating out", "Transport", "Others"]);
});

test("bill categories rename their bills too", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true, date: "2026-08-02T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  const input = catRow(w, "priority", "Bills").querySelector(".category-name-input");
  input.value = "Housing";
  input.dispatchEvent(new w.Event("blur"));

  assert.equal(w.__app.data.priority[0].category, "Housing");
  assert.equal(w.__app.run(`monthTotalsOf(data, allWallets()).categories["Housing"]`), 900);
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

/* Archived months keep the name they were recorded with - they already
   snapshot wallet names and currency, and a past month is a record of what
   happened. No figure moves either way. */
test("a rename does not rewrite archived months", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.archive]: {
        "2026-7": {
          data: {
            month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
            income: 2000, priority: [], priorityLocked: false, walletData: {},
            secondChoice: [{ name: "bus", category: "Transport", amount: 8, type: "take", date: "2026-07-05T10:00:00.000Z" }]
          },
          wallets: [], currency: "RM", closedAt: "2026-08-01T00:00:00.000Z"
        }
      },
      [KEYS.data]: month({
        secondChoice: [{ name: "grab", category: "Transport", amount: 13, type: "take", date: "2026-08-02T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  const input = catRow(w, "secondChoice", "Transport").querySelector(".category-name-input");
  input.value = "Travel";
  input.dispatchEvent(new w.Event("blur"));

  assert.equal(w.__app.data.secondChoice[0].category, "Travel", "this month follows");
  assert.equal(w.__app.archive["2026-7"].data.secondChoice[0].category, "Transport",
    "July keeps what it was recorded with");
});

test("a rename is refused if it collides, and the field reverts", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  const input = catRow(w, "secondChoice", "Transport").querySelector(".category-name-input");

  input.value = "Food / Drink";               // already in this list
  input.dispatchEvent(new w.Event("blur"));
  assert.equal(input.value, "Transport", "reverted");
  assert.ok(input.classList.contains("input-error"));

  input.value = "Grocery";                     // taken by a wallet
  input.dispatchEvent(new w.Event("blur"));
  assert.equal(input.value, "Transport", "reverted again");

  input.value = "   ";                         // empty
  input.dispatchEvent(new w.Event("blur"));
  assert.equal(input.value, "Transport");

  assert.deepEqual([...w.__app.settings.categories.secondChoice],
    ["Food / Drink", "Transport", "Others"], "nothing changed");
});

/* Re-saving a row without really changing it must not be read as a duplicate
   of itself - that is what the `exclude` argument is for. */
test("saving a category name unchanged is not a conflict", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Transport", "Transport")`), null);
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Transport")`), "duplicate",
    "still a duplicate when it is not the one being renamed");
});

test("the category panel opens from settings and closes again", async () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  const panel = w.document.getElementById("category-panel");
  assert.ok(panel.classList.contains("hidden"), "closed to begin with");

  w.document.getElementById("open-category-panel-btn").click();
  assert.ok(!panel.classList.contains("hidden"), "opens");
  assert.ok(w.document.querySelectorAll("#cat-priority-list .wallet-setting-row").length > 0,
    "and is populated");

  w.document.getElementById("close-category-panel").click();
  assert.ok(panel.classList.contains("is-closing"), "starts its short native close motion");
  assert.equal(panel.getAttribute("aria-hidden"), "true", "stops being an interactive surface immediately");
  await new Promise(resolve => w.setTimeout(resolve, 140));
  assert.ok(panel.classList.contains("hidden"), "is removed after the close frame");

  assert.match(w.document.getElementById("category-count").textContent, /categories/,
    "the settings row summarises how many there are");
});

/* ---------------------------------------------------------------------------
   INCREMENTAL RENDERING AND RELEASE FEATURES
--------------------------------------------------------------------------- */

test("editing one wallet leaves every other wallet section mounted", () => {
  const wallets = [{ id: "w0", name: "Grocery" }, { id: "w1", name: "Fuel" }];
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, wallets },
      [KEYS.data]: month({ walletData: {
        w0: { budget: 100, items: [] }, w1: { budget: 100, items: [] }
      } })
    }
  });
  const untouched = w.document.querySelector('[data-wallet-id="w1"]');

  w.__app.run('renderWallet(allWallets().find(wallet => wallet.id === "w0"))');

  assert.strictEqual(w.document.querySelector('[data-wallet-id="w1"]'), untouched,
    "a local wallet refresh must preserve other wallet forms and their input state");
});

test("recurring templates are applied exactly once when a live cycle rolls over", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, recurring: [
        { name: "Rent", type: "bill", category: "Bills", amount: 900 },
        { name: "Payday", type: "income", category: "Others", amount: 3000 },
        { name: "Internet", type: "expense", category: "Bills", amount: 120 }
      ] },
      [KEYS.data]: month()
    },
    today: "2026-08-31"
  });

  w.__setToday("2026-09-01");
  assert.equal(w.__app.run("checkCycleRollover()"), true);
  assert.equal(w.__app.data.priority[0].name, "Rent");
  assert.equal(JSON.stringify(w.__app.data.secondChoice.map(item => [item.name, item.type])),
    JSON.stringify([["Payday", "add"], ["Internet", "take"]]));
  assert.equal(w.__app.run("checkCycleRollover()"), false,
    "re-checking on the same day cannot duplicate templates");
});

test("theme choice and local recovery snapshot persist through the real handlers", () => {
  const w = bootApp({ storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() } });
  const theme = w.document.getElementById("theme-select");
  theme.value = "light";
  theme.dispatchEvent(new w.Event("input"));

  assert.equal(w.document.documentElement.dataset.theme, "light");
  assert.equal(stored(w, KEYS.settings).theme, "light");
  const snapshot = JSON.parse(w.localStorage.getItem("monthly-money-tracker-latest-backup"));
  assert.equal(snapshot.settings.theme, "light");
  assert.equal(snapshot.data.month, "2026-8");
});

/* ---------------------------------------------------------------------------
   RESERVED AND COLLIDING CATEGORY NAMES

   isTransferEntry() treats `category === "Transfer"` as a wallet transfer
   returning to main - a fallback for entries written before the flag shipped.
   That was safe while categories were hardcoded. Making them editable removed
   the protection, and a category by that name broke the invariant.
--------------------------------------------------------------------------- */

/* REGRESSION: the exact shape of the bug, asserted against money.js rather
   than the UI, because it is the books that broke. Reverting the reserved
   check lets the category be created and this fails on totalIncome. */
test("REGRESSION: a category named Transfer would void real income", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month({ income: 1000 }) },
    today: "2026-08-15"
  });

  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Transfer")`), "reserved");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "transfer")`), "reserved",
    "case-insensitive");

  // It must not be creatable through the real add path either.
  w.__app.run(`
    addCategoryTarget = "secondChoice";
    document.getElementById("add-category-name").value = "Transfer";
    confirmAddCategory();
  `);
  assert.ok(![...w.__app.settings.categories.secondChoice].includes("Transfer"),
    "the add is refused");
  assert.ok(!w.document.getElementById("add-category-error").classList.contains("hidden"),
    "and the reason is shown");

  /* What it would have caused: income logged under that name reads as money
     coming back out of a wallet, so totalIncome stops rising while
     mainRemaining does, and the books stop balancing. */
  const broken = w.__app.run(`
    (() => {
      const d = JSON.parse(JSON.stringify(data));
      d.secondChoice.push({ name: "side job", category: "Transfer", amount: 500,
                            type: "add", newMoney: true, date: "2026-08-02T10:00:00.000Z" });
      return { income: totalIncomeOf(d, []), ok: reconciles(d, []) };
    })()
  `);
  assert.equal(broken.income, 1000, "income would not have risen");
  assert.equal(broken.ok, false, "and the invariant would have broken");
});

/* An install that created one during the window when nothing stopped it. */
test("a stored reserved category is removed on load", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: {
        ...SETTINGS,
        categories: { priority: ["Bills", "Others"], secondChoice: ["Transfer", "Food / Drink", "Others"] }
      },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });

  assert.deepEqual([...w.__app.settings.categories.secondChoice], ["Food / Drink", "Others"],
    "dropped from the list");
  assert.ok(!catValues(w, "sc-category").includes("Transfer"), "and from the dropdown");
  assert.deepEqual([...stored(w, KEYS.settings).categories.secondChoice], ["Food / Drink", "Others"],
    "the repair is persisted, not just in memory");
});

/* Entries already filed under it are deliberately left alone: a user's
   "Transfer" entry and a genuine pre-v1.13.0 untagged transfer are identical
   on disk, so there is no safe way to tell them apart. */
test("removing the reserved name does not rewrite entries already using it", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: {
        ...SETTINGS,
        categories: { priority: ["Others"], secondChoice: ["Transfer", "Others"] }
      },
      [KEYS.data]: month({
        secondChoice: [{ name: "from wallet", category: "Transfer", amount: 50,
                         type: "add", date: "2026-08-02T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });
  assert.equal(w.__app.data.secondChoice[0].category, "Transfer",
    "the entry is untouched - it may be a real legacy transfer");
});

/* A CLOSED wallet's spending stays on the books under its name, so a category
   taking that name would merge into its slice. */
test("a category cannot take a closed wallet's name", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: {
        ...SETTINGS,
        wallets: [{ id: "w0", name: "Grocery" }, { id: "w1", name: "Fuel", deleted: true }]
      },
      [KEYS.data]: month({
        walletData: { w1: { budget: 100, items: [{ name: "petrol", amount: 60, type: "take", date: "2026-08-02T10:00:00.000Z" }] } }
      })
    },
    today: "2026-08-15"
  });

  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Fuel")`), "wallet",
    "the closed wallet still owns the name");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Grocery")`), "wallet",
    "and so does the open one");
  assert.equal(w.__app.run(`categoryNameConflict("secondChoice", "Petrol")`), null,
    "an unrelated name is fine");
});

/* ---------------------------------------------------------------------------
   PROMPTS OPEN ACROSS A LIVE ROLLOVER

   The overspend, transfer and source modals hold a callback closed over
   amounts computed against the month being archived. Left open, tapping an
   option after the rollover commits those figures into the new month.
--------------------------------------------------------------------------- */

test("REGRESSION: an open prompt is dismissed by a live rollover", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
        income: 100, walletData: { w0: { budget: 50, items: [] } }
      })
    },
    today: "2026-07-20"
  });

  // Trigger a real overspend prompt against July's figures.
  const section = w.document.querySelector('.wallet-section[data-wallet-id="w0"]');
  section.querySelector("[data-role='item-name']").value = "big shop";
  section.querySelector("[data-role='item-amount']").value = "500";
  section.querySelector("[data-role='take-btn']").click();

  const overspend = w.document.getElementById("overspend-modal");
  assert.ok(!overspend.classList.contains("hidden"), "the prompt is open");

  // Midnight passes with it still on screen.
  w.__setToday("2026-08-01");
  assert.equal(w.__app.run("checkCycleRollover()"), true);

  assert.ok(overspend.classList.contains("hidden"), "the prompt is dismissed");
  assert.equal(w.__app.run("overspendCancel"), null, "and its callback dropped");
  assert.equal(w.__app.data.month, "2026-8");
  assert.equal((w.__app.data.walletData.w0 || { items: [] }).items.length, 0,
    "nothing from the abandoned prompt leaked into the new month");
  assert.ok(w.__app.run("reconciles(data, allWallets())"));
});

test("a rollover clears every pending modal handle", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01", income: 500
      })
    },
    today: "2026-07-20"
  });

  w.__app.run(`
    walletPendingDelete = { id: "w0", name: "Grocery" };
    categoryPendingDelete = { list: "secondChoice", name: "Transport" };
    pendingImport = { data: {} };
    document.getElementById("import-modal").classList.remove("hidden");
  `);

  w.__setToday("2026-08-01");
  w.__app.run("checkCycleRollover()");

  assert.equal(w.__app.run("walletPendingDelete"), null);
  assert.equal(w.__app.run("categoryPendingDelete"), null);
  assert.equal(w.__app.run("pendingImport"), null);
  assert.ok(w.document.getElementById("import-modal").classList.contains("hidden"));
  assert.equal([...w.document.querySelectorAll(".modal")].filter(m => !m.classList.contains("hidden")).length, 0,
    "no modal is left showing");
});

/* ---------------------------------------------------------------------------
   THE CHART COMING UP BLANK

   fitCanvas() declines to draw into a zero-sized box, which is right. What
   was wrong is that nothing retried, so one bad measurement was permanent -
   and v1.22.0's `max-width: 100%` guaranteed a bad measurement by making the
   canvas's width depend on a container whose width depended on the canvas.
--------------------------------------------------------------------------- */

/* REGRESSION: the donut could not show a small category - a RM 30 line against
   a RM 2,000 income was a slice a third of a degree wide. Every segment of the
   bar that replaced it must be visible, however small its share. */
test("REGRESSION: a tiny category still gets a visible segment", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, showChart: true },
      [KEYS.data]: month({
        income: 2000,
        secondChoice: [
          { name: "rent", category: "Others", amount: 900, type: "take", date: "2026-08-02T10:00:00.000Z" },
          { name: "fuel", category: "Transport", amount: 30, type: "take", date: "2026-08-03T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const segs = [...w.document.querySelectorAll("#chart-bar .chart-bar-seg")];
  assert.ok(segs.length >= 2, "one segment per row");

  /* A floor in CSS, not a share of the total - a share can always round to
     nothing. jsdom has no layout, so the rule itself is the assertion. */
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(".chart-bar-seg"), css.indexOf("}", css.indexOf(".chart-bar-seg")));
  assert.match(block, /min-width:\s*[1-9]/, "segments have a minimum width");

  // Every segment carries a real share, so none is a zero-width sliver.
  segs.forEach(s => {
    const grow = parseFloat(s.style.flexGrow);
    assert.ok(grow > 0, `a segment has a positive share (got ${grow})`);
  });
});

/* The bar divides the segments' own sum, not income - when overspent the
   overspend is deliberately absent, and dividing by income would leave the
   bar visibly short of full for no stated reason. */
test("the bar's segments always add up to the whole bar", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, showChart: true },
      [KEYS.data]: month({
        income: 1000,
        secondChoice: [
          { name: "a", category: "Others", amount: 1200, type: "take", date: "2026-08-02T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const segs = [...w.document.querySelectorAll("#chart-bar .chart-bar-seg")];
  const sum = segs.reduce((n, s) => n + parseFloat(s.style.flexGrow), 0);
  assert.ok(Math.abs(sum - 1000) < 1, `shares total the whole bar (got ${sum})`);

  // The overspend is a row, with no segment behind it.
  const over = [...w.document.querySelectorAll("#chart-legend .legend-item")]
    .find(r => r.textContent.includes("Overspent"));
  assert.ok(over, "an overspend is reported in the rows");
  assert.equal(segs.length, 1, "and has no segment of its own");
});

/* Money in a wallet or still in the balance is not spending, and must not be
   coloured as though it were a category - the old ring gave Remaining a full
   blue slice under a caption reading "total spent". */
test("only spending is coloured; unspent money stays greyscale", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: { ...SETTINGS, showChart: true },
      [KEYS.data]: month({
        income: 1000,
        secondChoice: [
          { name: "a", category: "Others", amount: 100, type: "take", date: "2026-08-02T10:00:00.000Z" }
        ]
      })
    },
    today: "2026-08-15"
  });

  const series = w.__app.run("CHART_SERIES");
  const rows = [...w.document.querySelectorAll("#chart-legend .legend-item")];
  const remaining = rows.find(r => r.textContent.includes("Remaining"));
  assert.ok(remaining, "Remaining is listed");

  const dot = remaining.querySelector(".legend-dot").style.background;
  assert.ok(!series.some(hex => dot.includes(hex)),
    "Remaining does not wear a category colour");
});

/* ---------------------------------------------------------------------------
   NATIVE FAST MOTION

   Frequent navigation must never replay the old half-second section stagger.
   Motion is applied to one incoming compositor surface, while state and input
   handling update synchronously underneath it.
--------------------------------------------------------------------------- */

test("Native Fast uses one short directional transition per tab", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });

  const home = w.document.getElementById("tab-home");
  const bills = w.document.getElementById("tab-bills");
  assert.ok(!home.classList.contains("tab-enter-forward"), "startup does not animate gratuitously");

  w.document.querySelector('.tab-btn[data-tab="bills"]').click();
  assert.ok(!bills.classList.contains("hidden"), "the destination is available immediately");
  assert.ok(bills.classList.contains("tab-enter-forward"), "a later tab enters from the forward edge");

  w.document.querySelector('.tab-btn[data-tab="home"]').click();
  assert.ok(home.classList.contains("tab-enter-back"), "returning uses the opposite direction");
});

test("History uses push and pop motion without delaying either view", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });
  const app = w.document.getElementById("app-view");
  const history = w.document.getElementById("history-view");

  w.document.getElementById("history-toggle").click();
  assert.ok(!history.classList.contains("hidden"));
  assert.ok(history.classList.contains("view-enter-forward"));

  w.document.getElementById("history-back").click();
  assert.ok(!app.classList.contains("hidden"));
  assert.ok(app.classList.contains("view-enter-back"));
});

test("full list renders stay still while a newly added row receives feedback", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 900, paid: false }]
      })
    },
    today: "2026-08-15"
  });

  assert.ok(!w.document.querySelector("#priority-list .swipe-wrapper").classList.contains("item-enter"),
    "existing rows do not replay an entrance after a render");

  w.document.getElementById("pb-name").value = "Internet";
  w.document.getElementById("pb-category").value = "Bills";
  w.document.getElementById("pb-amount").value = "100";
  w.document.getElementById("add-priority").click();

  const rows = w.document.querySelectorAll("#priority-list .swipe-wrapper");
  assert.ok(rows[rows.length - 1].classList.contains("item-enter"),
    "only the row created by this action gets motion feedback");
});

test("reduced motion makes money updates immediate", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    today: "2026-08-15"
  });
  w.matchMedia = () => ({ matches: true });
  const amount = w.document.getElementById("remaining-money");
  amount._shownValue = 100;

  w.__app.run("animateMoneyTo(remainingMoneyEl, 250)");

  assert.match(amount.textContent, /250\.00$/, "the final value is shown synchronously");
  assert.ok(!amount.closest(".card").classList.contains("card-pulse"),
    "no pulse is started when the system asks for reduced motion");
});

test("the stylesheet has compact shared motion tokens and no section stagger", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /--motion-fast:\s*120ms/);
  assert.match(css, /--motion-standard:\s*180ms/);
  assert.match(css, /--motion-emphasis:\s*220ms/);
  assert.doesNotMatch(css, /\.tab-panel\s*>\s*\*\s*\{[^}]*animation/s,
    "switching tabs never animates every child one after another");
});

/* ---------------------------------------------------------------------------
   INSIGHTS, SEARCH, AND PURPOSEFUL STATES
--------------------------------------------------------------------------- */

test("dashboard insights reuse live and archived accounting totals", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.archive]: {
        "2026-7": {
          data: month({ month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
            secondChoice: [{ name: "Old spend", category: "Others", amount: 400, type: "take", date: "2026-07-05T10:00:00.000Z" }] }),
          wallets: [], currency: "RM", closedAt: "2026-08-01T00:00:00.000Z"
        }
      },
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 500, paid: true, date: "2026-08-02T10:00:00.000Z" }],
        secondChoice: [{ name: "Lunch", category: "Food / Drink", amount: 100, type: "take", date: "2026-08-04T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  assert.equal(w.document.getElementById("insight-category").textContent, "Bills");
  assert.match(w.document.getElementById("insight-category-note").textContent, /500\.00 spent/);
  assert.equal(w.document.getElementById("insight-comparison").textContent, "+50%");
  assert.match(w.document.getElementById("insight-daily-note").textContent, /17 days remaining/);
});

test("activity finder filters across main, wallet, transfer, and bill records", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: month({
        priority: [{ name: "Rent", category: "Bills", amount: 500, paid: true, date: "2026-08-02T10:00:00.000Z" }],
        walletData: { w0: { budget: 200, items: [{ name: "Market", amount: 25, type: "take", date: "2026-08-03T10:00:00.000Z" }] } },
        secondChoice: [{ name: "Lunch", category: "Food / Drink", amount: 12, type: "take", date: "2026-08-04T10:00:00.000Z" }]
      })
    },
    today: "2026-08-15"
  });

  const source = w.document.getElementById("activity-source");
  source.value = "w0";
  source.dispatchEvent(new w.Event("change", { bubbles: true }));
  const results = w.document.getElementById("activity-results");
  assert.match(results.textContent, /Market/);
  assert.doesNotMatch(results.textContent, /Lunch|Rent/);

  w.document.getElementById("activity-clear").click();
  const query = w.document.getElementById("activity-query");
  query.value = "rent";
  query.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(results.textContent, /Rent/);
  assert.match(w.document.getElementById("activity-summary").textContent, /1 result/);
});

test("activity search opens from the header before History and closes accessibly", async () => {
  const w = bootApp({ storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() } });
  const searchButton = w.document.getElementById("activity-toggle");
  const historyButton = w.document.getElementById("history-toggle");
  const modal = w.document.getElementById("activity-modal");

  assert.ok(searchButton.compareDocumentPosition(historyButton) & w.Node.DOCUMENT_POSITION_FOLLOWING,
    "the magnifying glass is immediately before History in the header");
  assert.ok(!w.document.getElementById("tab-spending").contains(modal),
    "the finder is global, not another card in Spending");

  searchButton.click();
  assert.ok(!modal.classList.contains("hidden"));
  assert.equal(modal.getAttribute("aria-hidden"), "false");
  await new Promise(resolve => w.requestAnimationFrame(resolve));
  assert.equal(w.document.activeElement.id, "activity-query", "opening puts the cursor in search");

  w.document.getElementById("activity-close").click();
  assert.ok(modal.classList.contains("is-closing"));
  assert.equal(modal.getAttribute("aria-hidden"), "true");
  assert.equal(w.document.activeElement, searchButton, "closing returns focus to the trigger");
});

test("activity search follows the repository modal and form language", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /activity-modal-card[^>]*role="dialog"/);
  assert.match(html, /id="activity-close"[^>]*>Done</,
    "the finder uses the same bottom action language as other modals");
  assert.match(css, /\.activity-modal-card\s*\{[^}]*max-width:360px/s,
    "the finder keeps the established modal width");
  assert.match(css, /\.activity-search-controls input,[\s\S]*?background:#1a1a1a;[\s\S]*?border-radius:10px;/,
    "its controls use the same dark field and radius as transaction forms");
  assert.doesNotMatch(css, /\.activity-modal\s*\{[^}]*align-items:flex-start/s,
    "it no longer invents an oversized top-aligned modal treatment");
});

test("release version is consistent across package, lockfile, UI, and cache", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.equal(pkg.version, "1.37.0");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(html, new RegExp(`setting-version[^>]*>v${pkg.version.replaceAll(".", "\\.")}`));
  assert.match(sw, /CACHE_NAME = "mmt-v64"/);
});

test("the cosmetic system stays shared across cards, navigation, and modals", () => {
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(css, /--radius-card:\s*16px/);
  assert.match(css, /--radius-sheet:\s*20px/);
  assert.match(css, /--space-page:\s*20px/);
  assert.match(css, /\.card\s*\{[^}]*var\(--radius-card\)[^}]*var\(--space-card\)/s);
  assert.match(css, /\.modal-card\s*\{[^}]*var\(--radius-sheet\)[^}]*var\(--shadow-sheet\)/s);
  assert.match(css, /\.tab-btn\.is-active svg\s*\{[^}]*background:\s*#202020/s);
  assert.match(css, /@media \(max-width:380px\)[^{]*\{[^}]*--space-page:\s*16px/s);
});

test("web routes restore tabs and History from stable hash URLs", () => {
  const w = bootApp({
    storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() },
    url: "https://example.org/#bills"
  });
  assert.ok(!w.document.getElementById("tab-bills").classList.contains("hidden"));
  assert.equal(w.__app.settings.activeTab, "bills");

  w.document.querySelector('.tab-btn[data-tab="wallets"]').click();
  assert.equal(w.location.hash, "#wallets");

  w.location.hash = "#history";
  w.dispatchEvent(new w.PopStateEvent("popstate"));
  assert.ok(!w.document.getElementById("history-view").classList.contains("hidden"));
});

test("tab arrows and Escape provide complete keyboard navigation", () => {
  const w = bootApp({ storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month() } });
  const home = w.document.querySelector('.tab-btn[data-tab="home"]');
  home.focus();
  home.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(w.document.activeElement.dataset.tab, "bills");
  assert.equal(w.location.hash, "#bills");

  w.document.getElementById("add-wallet-btn").click();
  const modal = w.document.getElementById("add-wallet-modal");
  assert.ok(!modal.classList.contains("hidden"));
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(modal.classList.contains("is-closing") || modal.classList.contains("hidden"));
});

test("the PWA exposes updates instead of silently replacing an open session", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(html, /id="update-banner"[^>]*aria-live="polite"/);
  assert.match(html, /registration\.waiting/);
  assert.match(html, /postMessage\(\{ type: "SKIP_WAITING" \}\)/);
  assert.match(sw, /event\.request\.mode === "navigate"/);
  assert.match(sw, /event\.data\.type === "SKIP_WAITING"/);
});

test("responsive and cross-browser foundations remain enabled", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(html, /width=device-width, initial-scale=1\.0/);
  assert.match(html, /maximum-scale=1\.0, user-scalable=no/);
  assert.match(css, /html \{ touch-action: manipulation; \}/);
  assert.match(html, /rel="preload" href="app\.js" as="script"/);
  assert.match(css, /@media \(min-width:768px\)/);
  assert.match(css, /@media \(min-width:1100px\)/);
  assert.match(css, /input\[type="number"\][\s\S]*?-moz-appearance:\s*textfield/);
  assert.match(css, /:focus-visible[\s\S]*?outline:\s*2px solid #8c8c8c !important/);
});

test("every primary interaction has compact, reduced-motion-safe feedback", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const helpers = readFileSync(new URL("../ui-helpers.js", import.meta.url), "utf8");

  assert.match(helpers, /function playTransient\(/);
  assert.match(app, /function celebrateForm\(/);
  assert.match(app, /tab-motion-indicator/);
  assert.match(app, /chart-segment-enter/);
  assert.match(app, /pullSpinner\.classList\.add\("is-pulling"\)/);
  assert.match(css, /\.surface-enter\s*\{[^}]*animation:surface-enter/s);
  assert.match(css, /\.form-success\s*\{[^}]*animation:form-success/s);
  assert.match(css, /\.chart-segment-enter\s*\{[^}]*animation:chart-grow/s);
  assert.match(css, /\.tab-motion-indicator\s*\{[^}]*transition:transform/s);
  assert.match(css, /\.pull-spinner\.is-pulling\s*\{[^}]*transform:rotate/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.surface-enter/s);
  assert.match(html, /id="pull-spinner"/);
});

test("empty and loading states explain what happens next", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="app-loading"/);
  const w = bootApp({ storage: { [KEYS.settings]: SETTINGS, [KEYS.data]: month({ income: null }) } });
  assert.match(w.document.getElementById("priority-list").textContent, /Add rent, subscriptions/);
  assert.match(w.document.getElementById("sc-table").textContent, /record your first expense/);
  w.__app.run("renderHistory()");
  assert.match(w.document.getElementById("history-list").textContent, /appear here automatically/);
});

/* REGRESSION: the app flashed white on every open.

   Two causes, one test each. First: the page's black lived only in style.css,
   a separate file the browser has to fetch and parse, so there was a window
   before it applied with no background of its own. */
test("REGRESSION: the background is set before the stylesheet loads", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  const inlineAt = html.indexOf("<style>");
  const linkAt = html.indexOf('rel="stylesheet"');
  assert.ok(inlineAt !== -1, "there is an inline style block");
  assert.ok(inlineAt < linkAt,
    "and it comes BEFORE the stylesheet link, or it cannot paint the first frame");

  const block = html.slice(inlineAt, html.indexOf("</style>", inlineAt));
  assert.match(block, /background:\s*#000/, "it sets the page background");
  assert.match(block, /color-scheme:\s*dark/,
    "and the colour scheme, so the browser's own canvas is dark too");
});

/* Second: iOS paints its startup image while the app opens and paints WHITE
   when it cannot get the file. Nothing precached them, so every cold open went
   to the network for one. */
test("REGRESSION: the launch images are precached for offline start", () => {
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  // Every startup image the markup can ask for must be in the worker's list.
  const referenced = [...html.matchAll(/href="(icons\/splash-[^"]+)"/g)].map(m => m[1]);
  assert.ok(referenced.length > 0, "the markup declares startup images");

  referenced.forEach(src => {
    assert.ok(sw.includes(src),
      `${src} is precached - a cache lookup keys on the whole URL, query included`);
  });

  /* The images must not be able to fail the install: addAll is all-or-nothing,
     and one missing icon stranding every user on the old worker is far worse
     than a launch image fetched from the network. */
  assert.match(sw, /LAUNCH_IMAGES\.map\([\s\S]*?\.catch\(/,
    "and they are added tolerantly, outside the all-or-nothing addAll");
});

test("every declared app icon exists at its advertised size and cache version", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

  manifest.icons.forEach(icon => {
    const [relativePath, query = ""] = icon.src.split("?");
    const [expectedWidth, expectedHeight] = icon.sizes.split("x").map(Number);
    const png = readFileSync(new URL(`../${relativePath}`, import.meta.url));

    assert.equal(png.toString("ascii", 1, 4), "PNG", `${relativePath} is a PNG`);
    assert.equal(png.readUInt32BE(16), expectedWidth, `${relativePath} has the declared width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${relativePath} has the declared height`);
    assert.ok(query, `${relativePath} has a cache-busting version`);
    assert.ok(sw.includes(`./${icon.src}`), `${icon.src} is available offline`);
  });

  const browserIcons = [...html.matchAll(/href="(icons\/icon-[^"]+)"/g)].map(match => match[1]);
  browserIcons.forEach(src => {
    assert.ok(sw.includes(`./${src}`), `${src} used by the browser is available offline`);
  });
});

/* REGRESSION: the same blank-canvas fault as the donut, in History. The
   trend chart was drawn while #history-view was still hidden, so its canvas
   measured zero, fitCanvas declined, and nothing retried - History opened
   permanently chartless. */
test("REGRESSION: History is visible before its trend chart is drawn", () => {
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.archive]: {
        "2026-7": {
          data: { month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01",
                  income: 2000, priority: [], priorityLocked: false, walletData: {},
                  secondChoice: [{ name: "bus", category: "Others", amount: 8, type: "take",
                                   date: "2026-07-05T10:00:00.000Z" }] },
          wallets: [], currency: "RM", closedAt: "2026-08-01T00:00:00.000Z"
        }
      },
      [KEYS.data]: month()
    },
    today: "2026-08-15"
  });

  const view = w.document.getElementById("history-view");
  assert.ok(view.classList.contains("hidden"), "History starts closed");

  /* Assert the ORDER, by checking what the view's state was at the moment
     the chart was asked to draw. Reverting the handler makes this fail. */
  let hiddenWhenDrawn = null;
  w.__app.run(`
    window.__origDraw = drawTrendChart;
    drawTrendChart = function (entries) {
      window.__hiddenWhenDrawn = document.getElementById("history-view").classList.contains("hidden");
      return window.__origDraw(entries);
    };
  `);
  w.document.getElementById("history-toggle").click();
  hiddenWhenDrawn = w.__hiddenWhenDrawn;

  assert.equal(hiddenWhenDrawn, false,
    "the view must already be on screen when the trend chart is drawn");
  assert.ok(!view.classList.contains("hidden"), "and History is open");
  assert.ok(w.document.getElementById("history-list").children.length > 0, "with its rows built");
});
