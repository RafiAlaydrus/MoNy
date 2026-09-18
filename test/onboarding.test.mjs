import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bootApp, KEYS, stored } from "./harness.mjs";

const SETTINGS = {
  showChart: true, currency: "RM", sortOrder: "newest", budgetLimit: null,
  wallets: [], collapsed: {}, dateOrderMigrated: true, carryOver: true,
  monthStartDay: 1, activeTab: "home"
};

const month = (over = {}) => ({
  month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
  income: 1800, carryOver: 0, carryIn: { main: 0, wallets: {} },
  priority: [], priorityLocked: false, walletData: {}, secondChoice: [], ...over
});

const waitForUi = () => new Promise(resolve => setTimeout(resolve, 35));

function existingStorage(onboarding) {
  const storage = { [KEYS.settings]: SETTINGS, [KEYS.data]: month() };
  if (onboarding) storage[KEYS.onboarding] = onboarding;
  return storage;
}

test("a genuine first run offers onboarding without changing money", async () => {
  const w = bootApp({ storage: {}, today: "2026-08-15" });
  await waitForUi();
  assert.equal(w.document.getElementById("onboarding-welcome").classList.contains("hidden"), false);
  assert.equal(w.document.getElementById("onboarding-welcome-title").textContent, "Welcome to MoNy");
  assert.equal(w.__app.data.income, null);
  assert.equal(stored(w, KEYS.onboarding), null, "the offer itself is not a decision");
});

test("an established user is silently marked complete and never sees Welcome", async () => {
  const w = bootApp({ storage: existingStorage(), today: "2026-08-15" });
  await waitForUi();
  assert.equal(w.document.getElementById("onboarding-welcome").classList.contains("hidden"), true);
  assert.deepEqual(stored(w, KEYS.onboarding), { version: 1, status: "completed" });
});

test("Show me around immediately saves in_progress and each current step", async () => {
  const w = bootApp({ storage: {}, today: "2026-08-15" });
  await waitForUi();
  w.document.getElementById("onboarding-start").click();
  assert.deepEqual(stored(w, KEYS.onboarding), { version: 1, status: "in_progress", step: 1 });
  assert.equal(w.document.getElementById("tutorial-progress").textContent, "1 of 6");
  w.document.getElementById("tutorial-next").click();
  assert.deepEqual(stored(w, KEYS.onboarding), { version: 1, status: "in_progress", step: 2 });
  assert.equal(w.document.getElementById("tutorial-title").textContent, "Available");
});

for (const [step, title, tab] of [
  [1, "Your income", "home"],
  [3, "Bills", "bills"],
  [6, "Protect your data", null]
]) {
  test(`an interrupted walkthrough resumes directly at step ${step}`, async () => {
    const w = bootApp({
      storage: existingStorage({ version: 1, status: "in_progress", step }),
      today: "2026-08-15"
    });
    await waitForUi();
    assert.equal(w.document.getElementById("onboarding-welcome").classList.contains("hidden"), true,
      "Welcome must not be repeated after Show me around");
    assert.equal(w.document.getElementById("tutorial-overlay").classList.contains("hidden"), false);
    assert.equal(w.document.getElementById("tutorial-progress").textContent, `${step} of 6`);
    assert.equal(w.document.getElementById("tutorial-title").textContent, title);
    if (tab) {
      assert.equal(w.document.querySelector(`.tab-panel[data-tab='${tab}']`).classList.contains("hidden"), false);
    } else {
      assert.equal(w.document.getElementById("settings-panel").classList.contains("hidden"), false);
      assert.equal(w.document.getElementById("export-data-btn").closest(".settings-group").hidden, false);
    }
  });
}

test("completion clears saved progress", async () => {
  const w = bootApp({
    storage: existingStorage({ version: 1, status: "in_progress", step: 6 }),
    today: "2026-08-15"
  });
  await waitForUi();
  w.document.getElementById("tutorial-next").click();
  assert.deepEqual(stored(w, KEYS.onboarding), { version: 1, status: "completed" });
  assert.equal("step" in stored(w, KEYS.onboarding), false);
  assert.equal(w.document.getElementById("tutorial-overlay").classList.contains("hidden"), true);
});

test("Bills tutorial targets the visible lock control when Add Bill is hidden", async () => {
  const lockedMonth = month({
    priorityLocked: true,
    priority: [{ name: "Electricity", category: "Bills", amount: 200, paid: false }]
  });
  const w = bootApp({
    storage: {
      [KEYS.settings]: SETTINGS,
      [KEYS.data]: lockedMonth,
      [KEYS.onboarding]: { version: 1, status: "in_progress", step: 3 }
    },
    today: "2026-08-15"
  });
  await waitForUi();
  assert.equal(w.__app.run("tutorialTarget.id"), "priority-lock-badge");
  assert.equal(w.document.getElementById("priority-lock-badge").classList.contains("hidden"), false);
});

test("Welcome Skip and walkthrough Exit both clear saved progress", async () => {
  const fresh = bootApp({ storage: {}, today: "2026-08-15" });
  await waitForUi();
  fresh.document.getElementById("onboarding-skip").click();
  assert.deepEqual(stored(fresh, KEYS.onboarding), { version: 1, status: "skipped" });

  const resumed = bootApp({
    storage: existingStorage({ version: 1, status: "in_progress", step: 4 }),
    today: "2026-08-15"
  });
  await waitForUi();
  resumed.document.dispatchEvent(new resumed.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(resumed.document.getElementById("tutorial-exit").classList.contains("hidden"), false);
  resumed.document.getElementById("tutorial-confirm-exit").click();
  assert.deepEqual(stored(resumed, KEYS.onboarding), { version: 1, status: "skipped" });
  assert.equal("step" in stored(resumed, KEYS.onboarding), false);
});

test("manual Replay is session-only and preserves the automatic decision", async () => {
  const original = { version: 1, status: "skipped" };
  const w = bootApp({ storage: existingStorage(original), today: "2026-08-15" });
  await waitForUi();
  w.document.getElementById("settings-toggle").click();
  w.document.getElementById("replay-tutorial-btn").click();
  assert.equal(w.document.getElementById("tutorial-progress").textContent, "1 of 6");
  assert.deepEqual(stored(w, KEYS.onboarding), original);
  w.document.getElementById("tutorial-next").click();
  w.document.getElementById("tutorial-skip").click();
  assert.deepEqual(stored(w, KEYS.onboarding), original);
  assert.equal(w.document.getElementById("settings-panel").classList.contains("hidden"), false,
    "manual replay returns to the Settings surface that launched it");
});

test("the walkthrough navigates real targets without mutating financial data", async () => {
  const w = bootApp({
    storage: existingStorage({ version: 1, status: "in_progress", step: 1 }),
    today: "2026-08-15"
  });
  await waitForUi();
  const before = w.localStorage.getItem(KEYS.data);
  for (let step = 1; step < 6; step++) w.document.getElementById("tutorial-next").click();
  assert.equal(w.document.getElementById("tutorial-title").textContent, "Protect your data");
  assert.equal(w.document.getElementById("settings-panel").classList.contains("hidden"), false);
  assert.equal(w.localStorage.getItem(KEYS.data), before);
});

test("only a successful brand reset clears onboarding and requests a fresh offer", async () => {
  const w = bootApp({
    storage: existingStorage({ version: 1, status: "completed" }),
    today: "2026-08-15"
  });
  await waitForUi();
  w.document.getElementById("secret-reset").click();
  assert.equal(w.document.getElementById("reset-modal").classList.contains("hidden"), true,
    "one title tap must remain harmless");
  w.document.getElementById("secret-reset").click();
  w.document.getElementById("cancel-reset").click();
  assert.deepEqual(stored(w, KEYS.onboarding), { version: 1, status: "completed" });
  assert.equal(stored(w, KEYS.onboardingTrigger), null);

  w.document.getElementById("secret-reset").click();
  w.document.getElementById("secret-reset").click();
  w.document.getElementById("confirm-reset").click();
  assert.equal(stored(w, KEYS.onboarding), null);
  assert.deepEqual(stored(w, KEYS.onboardingTrigger), { version: 1, reason: "brand_reset" });
});

test("Settings reset and a failed brand reset preserve onboarding", async () => {
  const complete = { version: 1, status: "completed" };
  const settingsReset = bootApp({ storage: existingStorage(complete), today: "2026-08-15" });
  await waitForUi();
  settingsReset.document.getElementById("reset-month-btn").click();
  settingsReset.document.getElementById("confirm-reset").click();
  assert.deepEqual(stored(settingsReset, KEYS.onboarding), complete);
  assert.equal(stored(settingsReset, KEYS.onboardingTrigger), null);

  const failed = bootApp({ storage: existingStorage(complete), today: "2026-08-15" });
  await waitForUi();
  const originalSet = failed.Storage.prototype.setItem;
  failed.Storage.prototype.setItem = function (key, value) {
    if (key === "monthly-money-tracker-recovery-backup") {
      throw new failed.DOMException("Storage full", "QuotaExceededError");
    }
    return originalSet.call(this, key, value);
  };
  failed.document.getElementById("secret-reset").click();
  failed.document.getElementById("secret-reset").click();
  failed.document.getElementById("confirm-reset").click();
  assert.deepEqual(stored(failed, KEYS.onboarding), complete);
  assert.equal(stored(failed, KEYS.onboardingTrigger), null);
});

test("onboarding markup and motion respect dialog accessibility and reduced motion", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(html, /id="tutorial-card"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="tutorial-exit"[\s\S]*role="alertdialog"[^>]*aria-modal="true"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.tutorial-card \{ animation:none; \}/);
  assert.match(css, /@media \(max-width: 680px\), \(max-height: 650px\)[\s\S]*\.tutorial-card/);
});

test("destructive reset and locked-bill controls use their dedicated visual treatments", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(html, /class="setting-btn-action danger">Reset current month/);
  assert.match(css, /\.setting-btn-action\.danger\s*\{[^}]*background:\s*#7f1d1d/s);
  assert.match(html, /<div class="bills-heading-row">[\s\S]*?id="priority-lock-badge"/);
  assert.match(css, /\.bills-heading-row\s*\{[^}]*align-items:\s*center/s);
  assert.match(css, /#priority-list li\.empty-state-rich\s*\{[^}]*display:\s*block/s);
});
