import { test } from "node:test";
import assert from "node:assert/strict";
import { bootApp, KEYS, stored } from "./harness.mjs";

const RECOVERY_KEY = "monthly-money-tracker-recovery-backup";
const SNAPSHOT_KEY = "monthly-money-tracker-latest-backup";
const settings = {
  showChart: false, currency: "RM", sortOrder: "oldest", budgetLimit: null,
  wallets: [{ id: "w0", name: "Grocery" }], collapsed: {}, dateOrderMigrated: true,
  carryOver: true, monthStartDay: 1
};
const month = (overrides = {}) => ({
  month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
  income: 3000, carryOver: 0, carryIn: { main: 0, wallets: {} },
  priority: [], priorityLocked: false, walletData: {}, secondChoice: [], ...overrides
});
const backup = (overrides = {}) => ({
  app: "monthly-money-tracker", formatVersion: 1,
  data: month({ income: 1250 }), settings, archive: {}, priorityBackup: [], ...overrides
});
function openApp(t, storage = {}) {
  const w = bootApp({ storage: { [KEYS.settings]: settings, [KEYS.data]: month(), ...storage } });
  t.after(() => w.close());
  return w;
}
async function selectFile(w, value) {
  const input = w.document.getElementById("import-file");
  const file = new w.File([typeof value === "string" ? value : JSON.stringify(value)], "backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event("change"));
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const check = () => {
      if (!w.document.getElementById("import-modal-text").textContent.startsWith("Checking ")) resolve();
      else if (Date.now() > deadline) reject(new Error("The file preview did not finish"));
      else setTimeout(check, 5);
    };
    check();
  });
}

test("invalid JSON and unsupported backups show inline errors without changing data", async t => {
  const w = openApp(t);
  const before = w.localStorage.getItem(KEYS.data);
  for (const value of ["{invalid", backup({ app: "another-app" }), backup({ formatVersion: 99 }), backup({ settings: { ...settings, recurring: [null] } })]) {
    await selectFile(w, value);
    assert.equal(w.document.getElementById("import-modal").classList.contains("hidden"), false);
    assert.equal(w.document.getElementById("import-error").classList.contains("hidden"), false);
    assert.ok(w.document.getElementById("import-error").textContent);
    assert.equal(w.document.getElementById("confirm-import").disabled, true);
    assert.equal(w.__app.run("pendingImport"), null);
    assert.equal(w.localStorage.getItem(KEYS.data), before);
  }
  assert.deepEqual(w.__alerts, []);
});

test("a valid file previews cycle and record counts and cancellation leaves storage intact", async t => {
  const w = openApp(t);
  const before = w.localStorage.getItem(KEYS.data);
  const file = backup({ data: month({
    priority: [{ name: "Rent", category: "Bills", amount: 100, paid: false }],
    secondChoice: [{ name: "Tea", category: "Food", amount: 4, type: "take" }],
    walletData: { w0: { budget: 20, items: [{ name: "Bread", amount: 3, type: "take" }] } }
  }), archive: { "2026-7": { data: month({ month: "2026-7" }) } } });
  await selectFile(w, file);
  const preview = w.document.getElementById("import-preview");
  assert.match(preview.textContent, /2026-08-01 to 2026-09-01/);
  const values = [...preview.querySelectorAll("strong")].map(el => el.textContent);
  assert.deepEqual(values.slice(2), ["1", "1", "1 / 1", "1", "0"]);
  assert.equal(w.document.getElementById("confirm-import").disabled, false);
  assert.equal(w.localStorage.getItem(KEYS.data), before);
  w.document.getElementById("cancel-import").click();
  assert.equal(w.__app.run("pendingImport"), null);
  assert.equal(w.localStorage.getItem(KEYS.data), before);
  assert.equal(w.localStorage.getItem(RECOVERY_KEY), null);
});

test("confirmed import replaces omitted data and preserves an independent recovery copy", async t => {
  const w = openApp(t, { [KEYS.backup]: [{ name: "Old bill", category: "Bills", amount: 80 }] });
  const before = JSON.parse(JSON.stringify(w.__app.data));
  const file = backup();
  delete file.settings;
  delete file.archive;
  delete file.priorityBackup;
  await selectFile(w, file);
  w.document.getElementById("confirm-import").click();
  assert.equal(stored(w, KEYS.data).income, 1250);
  assert.equal(stored(w, KEYS.settings), null);
  assert.equal(stored(w, KEYS.archive), null);
  assert.equal(stored(w, KEYS.backup), null);
  const recovery = stored(w, RECOVERY_KEY);
  assert.deepEqual(recovery.data, before);
  assert.equal(recovery.reason, "import");
  assert.equal(recovery.priorityBackup[0].name, "Old bill");
  w.__app.run("saveSnapshot()");
  assert.deepEqual(stored(w, RECOVERY_KEY), recovery, "automatic backups cannot overwrite the recovery copy");
});

test("an import storage failure rolls back earlier keys and leaves the preview open", async t => {
  const w = openApp(t);
  const keys = [KEYS.data, KEYS.settings, KEYS.archive, KEYS.backup, RECOVERY_KEY];
  const before = keys.map(key => w.localStorage.getItem(key));
  await selectFile(w, backup());
  const originalSet = w.Storage.prototype.setItem;
  let failed = false;
  w.Storage.prototype.setItem = function (key, value) {
    if (key === KEYS.settings && !failed) { failed = true; throw new w.DOMException("Storage full", "QuotaExceededError"); }
    return originalSet.call(this, key, value);
  };
  w.document.getElementById("confirm-import").click();
  assert.ok(failed);
  assert.deepEqual(keys.map(key => w.localStorage.getItem(key)), before);
  assert.match(w.document.getElementById("import-error").textContent, /existing data is unchanged/);
  assert.equal(w.document.getElementById("import-modal").classList.contains("hidden"), false);
  assert.ok(w.__app.run("pendingImport"), "the user can retry after freeing storage");
});

test("restore validates local backups and restores exactly the snapshot that was previewed", t => {
  const w = openApp(t);
  w.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ data: { month: "wrong" } }));
  w.document.getElementById("restore-backup-btn").click();
  assert.match(w.document.getElementById("data-control-feedback").textContent, /cannot be restored/);
  assert.equal(w.__app.run("pendingRestore"), null);
  w.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(backup()));
  w.document.getElementById("restore-backup-btn").click();
  w.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(backup({ data: month({ income: 9000 }) })));
  w.document.getElementById("confirm-restore-backup").click();
  assert.equal(stored(w, KEYS.data).income, 1250);
  assert.equal(stored(w, RECOVERY_KEY).data.income, 3000);
});

test("Settings reset requires confirmation and preserves settings, archives, cycle, and a recovery copy", t => {
  const w = openApp(t, { [KEYS.data]: month({
    carryOver: 40,
    priority: [{ name: "Rent", category: "Bills", amount: 100, paid: true }]
  }), [KEYS.archive]: { "2026-7": { data: month({ month: "2026-7" }) } } });
  const before = stored(w, KEYS.data);
  const recoveryBefore = JSON.parse(JSON.stringify(w.__app.data));
  const beforeSettings = w.localStorage.getItem(KEYS.settings);
  const beforeArchive = w.localStorage.getItem(KEYS.archive);
  w.document.getElementById("reset-month-btn").click();
  assert.equal(w.document.getElementById("reset-modal").classList.contains("hidden"), false);
  assert.deepEqual(stored(w, KEYS.data), before);
  w.document.getElementById("cancel-reset").click();
  assert.deepEqual(stored(w, KEYS.data), before);
  w.document.getElementById("reset-month-btn").click();
  w.document.getElementById("confirm-reset").click();
  const cleared = stored(w, KEYS.data);
  assert.equal(cleared.income, null);
  assert.equal(cleared.carryOver, 0);
  assert.deepEqual(cleared.priority, []);
  assert.equal(cleared.cycleStart, before.cycleStart);
  assert.equal(cleared.cycleNext, before.cycleNext);
  assert.equal(w.localStorage.getItem(KEYS.settings), beforeSettings);
  assert.equal(w.localStorage.getItem(KEYS.archive), beforeArchive);
  assert.deepEqual(stored(w, RECOVERY_KEY).data, recoveryBefore);
  assert.equal(stored(w, RECOVERY_KEY).reason, "reset");
});

test("a reset cannot clear money when the recovery copy cannot be saved", t => {
  const w = openApp(t);
  const before = w.localStorage.getItem(KEYS.data);
  const originalSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) {
    if (key === RECOVERY_KEY) throw new w.DOMException("Storage full", "QuotaExceededError");
    return originalSet.call(this, key, value);
  };
  w.document.getElementById("reset-month-btn").click();
  w.document.getElementById("confirm-reset").click();
  assert.equal(w.localStorage.getItem(KEYS.data), before);
  assert.equal(w.__app.data.income, 3000);
  assert.match(w.document.getElementById("reset-error").textContent, /existing data is unchanged/);
});
