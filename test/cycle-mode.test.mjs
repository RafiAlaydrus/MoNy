import { test } from "node:test";
import assert from "node:assert/strict";
import { bootApp, KEYS, stored } from "./harness.mjs";

const settings = {
  showChart: true, currency: "RM", sortOrder: "newest", budgetLimit: 250,
  wallets: [{ id: "w1", name: "Grocery" }], monthStartDay: 1, carryOver: true,
  recurring: [{ name: "Rent", category: "Bills", amount: 100, type: "bill" }]
};
const month = (over = {}) => ({
  month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
  income: 300, carryOver: 0, carryIn: { main: 0, wallets: {} },
  priority: [{ name: "Power", category: "Bills", amount: 50, paid: true, date: "2026-08-10T12:00:00Z" }],
  priorityLocked: false,
  walletData: { w1: { budget: 100, items: [{ name: "Food", amount: 40, type: "take", date: "2026-08-11T12:00:00Z" }] } },
  secondChoice: [{ name: "Coffee", category: "Food", amount: 20, type: "take", date: "2026-08-12T12:00:00Z" }],
  ...over
});
const storage = (over = {}) => ({ [KEYS.settings]: settings, [KEYS.data]: month(), ...over });
const snapshotStorage = w => Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => {
  const key = w.localStorage.key(i);
  return [key, w.localStorage.getItem(key)];
}));

test("cycle mode requires confirmation and cancel changes nothing", () => {
  const w = bootApp({ storage: storage() });
  const toggle = w.document.getElementById("cycle-enabled-toggle");
  toggle.checked = false;
  toggle.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(toggle.checked, true);
  assert.notEqual(stored(w, KEYS.settings).cycleEnabled, false);
  assert.equal(w.document.getElementById("cycle-mode-modal").classList.contains("hidden"), false);
  w.document.getElementById("cancel-cycle-mode").click();
  assert.equal(w.__app.settings.cycleEnabled, true);
  assert.equal(stored(w, KEYS.data).income, 300);
});

test("the Settings confirmation controls both transitions and updates visible controls", () => {
  const w = bootApp({ storage: storage() });
  const toggle = w.document.getElementById("cycle-enabled-toggle");
  toggle.checked = false;
  toggle.dispatchEvent(new w.Event("change", { bubbles: true }));
  w.document.getElementById("confirm-cycle-mode").click();
  assert.equal(w.__app.settings.cycleEnabled, false);
  assert.equal(toggle.checked, false);
  assert.equal(w.document.getElementById("monthly-start-row").classList.contains("hidden"), true);
  assert.equal(w.document.getElementById("reset-month-btn").textContent, "Reset current tracking");
  toggle.checked = true;
  toggle.dispatchEvent(new w.Event("change", { bubbles: true }));
  w.document.getElementById("confirm-cycle-mode").click();
  assert.equal(w.__app.settings.cycleEnabled, true);
  assert.equal(toggle.checked, true);
  assert.equal(w.document.getElementById("history-toggle").classList.contains("hidden"), false);
  assert.equal(w.__jsdomErrors.length, 0);
});

test("endless mode preserves the ledger and cannot roll over, even after a reload", () => {
  const w = bootApp({ storage: storage() });
  assert.equal(w.__app.run("switchCycleMode(false).ok"), true);
  assert.equal(stored(w, KEYS.data).secondChoice.length, 1);
  assert.equal(stored(w, KEYS.data).walletData.w1.items.length, 1);
  assert.equal(w.document.getElementById("current-month").textContent, "Endless tracking");
  assert.equal(w.document.getElementById("history-toggle").classList.contains("hidden"), true);
  assert.equal(w.document.getElementById("open-recurring-panel-btn").classList.contains("hidden"), true);
  assert.equal(w.document.getElementById("insight-daily").closest("[data-insight]").classList.contains("hidden"), true);
  w.__setToday("2026-11-20");
  assert.equal(w.__app.run("checkCycleRollover()"), false);
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
  assert.equal(stored(w, KEYS.archive), null);
  const reopened = bootApp({ storage: snapshotStorage(w), today: "2026-11-20", url: "https://example.org/#history" });
  assert.equal(reopened.__app.data.month, "2026-8");
  assert.equal(reopened.__app.settings.cycleEnabled, false);
  assert.equal(reopened.location.hash, "#home");
  assert.equal(reopened.__jsdomErrors.length, 0);
});

test("an endless ledger does not roll over if its settings record is damaged", () => {
  const w = bootApp({ storage: storage() });
  assert.equal(w.__app.run("switchCycleMode(false).ok"), true);
  const saved = snapshotStorage(w);
  saved[KEYS.settings] = "{damaged";
  const reopened = bootApp({ storage: saved, today: "2027-02-03" });
  assert.equal(reopened.__app.settings.cycleEnabled, false);
  assert.equal(reopened.__app.data.month, "2026-8");
  assert.equal(reopened.__app.data.secondChoice.length, 1);
  assert.equal(stored(reopened, KEYS.archive), null);
  assert.equal(reopened.__jsdomErrors.length, 0);
});

test("turning cycles back on archives the full endless period and preserves each balance", () => {
  const w = bootApp({ storage: storage() });
  assert.equal(w.__app.run("switchCycleMode(false).ok"), true);
  w.__setToday("2026-10-20");
  assert.equal(w.__app.run("switchCycleMode(true).ok"), true);
  const d = w.__app.data;
  assert.equal(d.cycleStart, "2026-10-20");
  assert.equal(d.cycleNext, "2026-11-01");
  assert.equal(d.income, null);
  assert.equal(d.carryOver, 190);
  assert.equal(d.carryIn.main, 130);
  assert.equal(d.walletData.w1.budget, 60);
  assert.equal(d.priority.length, 0, "recurring bills wait until the next natural boundary");
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), 130);
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
  assert.equal(stored(w, "monthly-money-tracker-endless-archive").length, 1);
  assert.equal(stored(w, "monthly-money-tracker-endless-archive")[0].data.secondChoice.length, 1);
  assert.equal(w.document.getElementById("history-toggle").classList.contains("hidden"), false);
  w.__app.run("renderHistory()");
  assert.match(w.document.getElementById("history-list").textContent, /Endless period/);
  const endlessHead = w.document.querySelector("#history-list .history-row-main[role='button']");
  endlessHead.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(endlessHead.getAttribute("aria-expanded"), "true");
  assert.match(endlessHead.parentNode.querySelector(".history-detail").textContent, /Coffee/);
  assert.equal(endlessHead.parentNode.querySelector(".history-delete"), null);
  assert.equal(w.__app.run("validateImport({data, settings, archive, endlessArchive})"), null);
  const reopened = bootApp({ storage: snapshotStorage(w), today: "2026-10-20" });
  assert.equal(reopened.__app.run("mainRemainingOf(data, allWallets())"), 130);
  assert.equal(reopened.__app.run("reconciles(data, allWallets())"), true);
});

test("a negative main balance survives re-enabling without a fake transaction", () => {
  const d = month({ income: 100, priority: [], secondChoice: [{ name: "Expense", category: "Others", amount: 50, type: "take" }], walletData: { w1: { budget: 80, items: [] } } });
  const w = bootApp({ storage: storage({ [KEYS.data]: d }) });
  w.__app.run("switchCycleMode(false)");
  assert.equal(w.__app.run("switchCycleMode(true).ok"), true);
  assert.equal(w.__app.data.carryOver, 50);
  assert.equal(w.__app.data.signedCarry, true);
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), -30);
  assert.equal(w.__app.run("walletBalanceOf(data.walletData.w1)"), 80);
  assert.equal(w.__app.data.secondChoice.length, 0);
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
  assert.equal(w.__app.run("validateImport({data, settings, archive, endlessArchive})"), null);
});

test("failed transition rolls back settings, ledger, archive and recovery", () => {
  const w = bootApp({ storage: storage() });
  w.__app.run("switchCycleMode(false)");
  const before = snapshotStorage(w);
  const proto = Object.getPrototypeOf(w.localStorage);
  const original = proto.setItem;
  proto.setItem = function (key, value) {
    if (key === "monthly-money-tracker-endless-archive") throw new Error("quota");
    return original.call(this, key, value);
  };
  try {
    assert.equal(w.__app.run("switchCycleMode(true).ok"), false);
    assert.equal(w.__app.settings.cycleEnabled, false);
    assert.equal(w.__app.data.secondChoice.length, 1);
    assert.equal(stored(w, "monthly-money-tracker-endless-archive"), null);
    assert.equal(w.localStorage.getItem(KEYS.data), before[KEYS.data]);
    assert.equal(w.localStorage.getItem(KEYS.settings), before[KEYS.settings]);
  } finally {
    proto.setItem = original;
  }
  assert.equal(w.__app.run("switchCycleMode(true).ok"), true);
});

test("endless backup validation rejects malformed periods without changing records", () => {
  const w = bootApp({ storage: storage() });
  w.__app.run("switchCycleMode(false)");
  w.__app.run("switchCycleMode(true)");
  const backup = { data: w.__app.data, settings: w.__app.settings, archive: w.__app.archive,
    endlessArchive: stored(w, "monthly-money-tracker-endless-archive") };
  assert.equal(w.__app.run(`validateImport(${JSON.stringify(backup)})`), null);
  backup.endlessArchive[0].data.priority = "broken";
  assert.match(w.__app.run(`validateImport(${JSON.stringify(backup)})`), /priority bills list/);
});

test("an empty endless ledger accepts expenses and keeps a zero opening income", () => {
  const empty = month({ income: null, priority: [], walletData: {}, secondChoice: [] });
  const w = bootApp({ storage: storage({ [KEYS.data]: empty, [KEYS.settings]: { ...settings, wallets: [] } }) });
  assert.equal(w.__app.run("switchCycleMode(false).ok"), true);
  assert.equal(w.__app.data.income, 0);
  assert.equal(w.document.getElementById("home-summary").classList.contains("hidden"), false);
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
  const again = bootApp({ storage: snapshotStorage(w), today: "2027-02-03" });
  assert.equal(again.__app.data.income, 0);
  assert.equal(again.__app.settings.cycleEnabled, false);
});

test("re-enable defers the first boundary to next month, keeping archive keys unique", () => {
  const w = bootApp({ storage: storage({ [KEYS.settings]: { ...settings, monthStartDay: 25 } }), today: "2026-08-15" });
  w.__app.run("switchCycleMode(false)");
  w.__setToday("2026-09-20");
  assert.equal(w.__app.run("switchCycleMode(true).ok"), true);
  assert.equal(w.__app.data.cycleStart, "2026-09-20");
  assert.equal(w.__app.data.cycleNext, "2026-10-25");
  w.__setToday("2026-10-25");
  assert.equal(w.__app.run("checkCycleRollover()"), true);
  assert.equal(w.__app.data.cycleStart, "2026-10-25");
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
});

test("multiple mode changes preserve every endless period and old monthly archive", () => {
  const old = { "2026-7": { data: month({ month: "2026-7", cycleStart: "2026-07-01", cycleNext: "2026-08-01" }), wallets: settings.wallets, currency: "RM" } };
  const w = bootApp({ storage: storage({ [KEYS.archive]: old }) });
  for (let n = 0; n < 2; n++) {
    assert.equal(w.__app.run("switchCycleMode(false).ok"), true);
    assert.equal(w.__app.run("switchCycleMode(true).ok"), true);
  }
  assert.equal(stored(w, "monthly-money-tracker-endless-archive").length, 2);
  assert.deepEqual(Object.keys(stored(w, KEYS.archive)), ["2026-7"]);
  w.__app.run("renderHistory()");
  assert.equal(w.document.querySelectorAll("#history-list .history-row").length, 3);
  assert.equal(w.__app.run("reconciles(data, allWallets())"), true);
});

test("restoring an endless backup replaces the separate archive without losing mode", () => {
  const w = bootApp({ storage: storage() });
  w.__app.run("switchCycleMode(false)");
  w.__app.run("switchCycleMode(true)");
  const backup = { data: w.__app.data, settings: w.__app.settings, archive: w.__app.archive,
    endlessArchive: stored(w, "monthly-money-tracker-endless-archive") };
  assert.equal(w.__app.run(`replaceBackupData(${JSON.stringify(backup)}, "import").ok`), true);
  assert.equal(stored(w, "monthly-money-tracker-endless-archive").length, 1);
  const again = bootApp({ storage: snapshotStorage(w) });
  assert.equal(again.__app.settings.cycleEnabled, true);
  assert.equal(again.__app.run("validateImport({data, settings, archive, endlessArchive})"), null);
});

test("a colliding monthly archive blocks re-enable without moving balances", () => {
  const w = bootApp({ storage: storage() });
  w.__app.run("switchCycleMode(false)");
  w.__app.archive["2026-8"] = { data: month(), wallets: settings.wallets, currency: "RM" };
  const oldMain = w.__app.run("mainRemainingOf(data, allWallets())");
  const result = w.__app.run("switchCycleMode(true)");
  assert.equal(result.ok, false);
  assert.match(result.message, /already exists/);
  assert.equal(w.__app.settings.cycleEnabled, false);
  assert.equal(w.__app.run("mainRemainingOf(data, allWallets())"), oldMain);
  assert.equal(stored(w, "monthly-money-tracker-endless-archive"), null);
});
