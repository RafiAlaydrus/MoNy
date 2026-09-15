import { test } from "node:test";
import assert from "node:assert/strict";
import { bootApp, KEYS, stored } from "./harness.mjs";

const settings = {
  currency: "RM", wallets: [{ id: "w0", name: "Grocery" }, { id: "w1", name: "Fuel" }],
  categories: { priority: ["Bills", "Others"], secondChoice: ["Others"] },
  dateOrderMigrated: true, monthStartDay: 1, carryOver: true
};
const month = () => ({
  month: "2026-8", cycleStart: "2026-08-01", cycleNext: "2026-09-01",
  income: 1000, carryOver: 0, priority: [], secondChoice: [], priorityLocked: false,
  walletData: { w0: { budget: 300, items: [] }, w1: { budget: 100, items: [] } }
});
function open(t, options = {}) {
  const w = bootApp({ storage: { [KEYS.settings]: settings, [KEYS.data]: month() }, ...options });
  t.after(() => w.close());
  return w;
}
const run = (w, code) => w.__app.run(code);
function failOnce(w, key) {
  const original = w.Storage.prototype.setItem;
  let failed = false;
  w.Storage.prototype.setItem = function (k, v) {
    if (k === key && !failed) { failed = true; throw new w.DOMException("Full", "QuotaExceededError"); }
    return original.call(this, k, v);
  };
}
function state(w) { return [KEYS.data, KEYS.settings, KEYS.archive, KEYS.backup].map(k => w.localStorage.getItem(k)); }

test("one transfer confirmation cannot move money twice", t => {
  const w = open(t);
  run(w, 'openTransferModal(settings.wallets[0], "Move", 50, new Date().toISOString(), () => {})');
  const button = w.document.querySelector('#transfer-destinations button');
  button.click(); button.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 1);
  assert.equal(w.__app.data.secondChoice.length, 1);
  assert.ok(run(w, 'reconciles(data, allWallets())'));
});

test("failed transfer save changes neither stored nor displayed balances", t => {
  const w = open(t);
  const before = JSON.stringify(w.__app.data);
  const disk = state(w);
  failOnce(w, KEYS.data);
  run(w, 'executeTransfer(settings.wallets[0], "w1", "Move", 50, new Date().toISOString())');
  assert.equal(JSON.stringify(w.__app.data), before);
  assert.deepEqual(state(w), disk);
});

test("a repeated shortfall confirmation adds the top-up and expense just once", t => {
  const w = open(t);
  const section = w.document.querySelector('[data-wallet-id="w0"]');
  section.querySelector('[data-role="item-name"]').value = "Groceries";
  section.querySelector('[data-role="item-amount"]').value = "350";
  section.querySelector('[data-role="take-btn"]').click();
  const option = w.document.querySelector('#overspend-options button');
  option.click(); option.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 2);
  assert.equal(run(w, 'getWalletBalance("w0")'), 0);
});

test("rollover failure rolls back all keys and leaves the current cycle intact", t => {
  const w = open(t);
  const before = state(w);
  failOnce(w, KEYS.data);
  w.__setToday('2026-09-01');
  assert.equal(run(w, 'checkCycleRollover()'), false);
  assert.equal(w.__app.data.month, '2026-8');
  assert.deepEqual(state(w), before);
  assert.equal(run(w, 'checkCycleRollover()'), true);
  assert.equal(w.__app.data.carryOver, 1000);
  assert.equal(run(w, 'checkCycleRollover()'), false);
});

test("a stale tab cannot overwrite a newer month even before its storage event arrives", t => {
  const w = open(t);
  const newer = { ...stored(w, KEYS.data), income: 2500 };
  w.localStorage.setItem(KEYS.data, JSON.stringify(newer));
  run(w, 'data.income = 900; saveData()');
  assert.equal(stored(w, KEYS.data).income, 2500);
});

test("both transfer directions persist linked pairs and survive reload", t => {
  const w = open(t);
  run(w, 'executeTransfer(settings.wallets[0], "w1", "Fuel funding", 70, new Date().toISOString())');
  run(w, 'executeTransfer(settings.wallets[1], "main", "Return", 40, new Date().toISOString())');
  const saved = stored(w, KEYS.data);
  assert.equal(saved.walletData.w0.items[0].txId, saved.walletData.w1.items[0].txId);
  assert.equal(saved.walletData.w1.items[1].txId, saved.secondChoice[0].txId);
  assert.equal(run(w, 'getWalletBalance("w0")'), 230);
  assert.equal(run(w, 'getWalletBalance("w1")'), 130);
  assert.equal(run(w, 'getMainRemaining()'), 640);
  assert.equal(run(w, 'totalIncomeOf(data, allWallets())'), 1000);
  const reloaded = open(t, { storage: { [KEYS.data]: saved, [KEYS.settings]: stored(w, KEYS.settings) } });
  assert.ok(run(reloaded, 'reconciles(data, allWallets())'));
  assert.equal(run(reloaded, 'getMainRemaining()'), 640);
});

for (const [destination, amount] of [['w0', 10], ['missing', 10], ['w1', 301], ['w1', -1], ['w1', Infinity]]) {
  test(`invalid transfer rejected: ${destination}, ${amount}`, t => {
    const w = open(t);
    const before = JSON.stringify(w.__app.data);
    assert.equal(run(w, `executeTransfer(settings.wallets[0], "${destination}", "Move", ${amount}, new Date().toISOString())`), false);
    assert.equal(JSON.stringify(w.__app.data), before);
  });
}

test("a failed confirmation remains retryable without duplicate transfer pairs", t => {
  const w = open(t);
  run(w, 'openTransferModal(settings.wallets[0], "Move", 50, new Date().toISOString(), () => {})');
  const button = w.document.querySelector('#transfer-destinations button');
  failOnce(w, KEYS.data);
  button.click();
  assert.equal(w.__app.data.secondChoice.length, 0);
  assert.equal(w.document.getElementById('transfer-modal').classList.contains('is-closing'), false);
  button.click(); button.click();
  assert.equal(w.__app.data.secondChoice.length, 1);
});

test("cancelled and replaced destination buttons cannot submit an older transfer", t => {
  const w = open(t);
  run(w, 'openTransferModal(settings.wallets[0], "Old", 50, new Date().toISOString(), () => {})');
  const old = w.document.querySelector('#transfer-destinations button');
  w.document.getElementById('cancel-transfer').click(); old.click();
  assert.equal(w.__app.data.secondChoice.length, 0);
  run(w, 'openTransferModal(settings.wallets[0], "New", 20, new Date().toISOString(), () => {})');
  old.click();
  assert.equal(w.__app.data.secondChoice.length, 0);
  w.document.querySelector('#transfer-destinations button').click();
  assert.equal(w.__app.data.secondChoice[0].amount, 20);
});

test("a failed top-up plus expense preserves both balances and the entry draft", t => {
  const w = open(t);
  const section = w.document.querySelector('[data-wallet-id="w0"]');
  section.querySelector('[data-role="item-name"]').value = 'Food';
  section.querySelector('[data-role="item-amount"]').value = '350';
  section.querySelector('[data-role="take-btn"]').click();
  failOnce(w, KEYS.data);
  const button = w.document.querySelector('#overspend-options button');
  button.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 0);
  assert.equal(run(w, 'getWalletBalance("w0")'), 300);
  assert.equal(w.document.querySelector('[data-wallet-id="w0"] [data-role="item-name"]').value, 'Food');
  button.click(); button.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 2);
});

for (const key of [KEYS.archive, KEYS.settings, KEYS.data, KEYS.backup, 'monthly-money-tracker-pending-write']) {
  test(`rollover is retryable when ${key} cannot be written`, t => {
    const w = open(t);
    run(w, 'data.priority.push({ name:"Rent", category:"Bills", amount:100, paid:false }); saveData()');
    const before = state(w);
    failOnce(w, key);
    w.__setToday('2026-09-01');
    assert.equal(run(w, 'checkCycleRollover()'), false);
    assert.deepEqual(state(w), before);
    assert.equal(run(w, 'checkCycleRollover()'), true);
    assert.equal(w.__app.data.carryOver, 1000);
    assert.equal(Object.keys(w.__app.archive).length, 1);
    assert.equal(w.__app.archive['2026-8'].data.priority.length, 1);
  });
}

test("an interrupted multi-key rollover is recovered before startup retries it", t => {
  const original = month();
  const originalSettings = JSON.stringify(settings);
  const w = open(t, { today:'2026-09-02', storage: {
    [KEYS.data]: original, [KEYS.settings]: { ...settings, wallets:[] },
    [KEYS.archive]: { '2026-8': { data: original, wallets:settings.wallets } },
    'monthly-money-tracker-pending-write': JSON.stringify([
      [KEYS.archive, null], [KEYS.settings, originalSettings], [KEYS.data, JSON.stringify(original)]
    ])
  } });
  assert.equal(w.__app.data.month, '2026-9');
  assert.equal(w.__app.data.carryOver, 1000);
  assert.equal(w.__app.settings.wallets.length, 2);
  assert.equal(Object.keys(w.__app.archive).length, 1);
  assert.equal(w.localStorage.getItem('monthly-money-tracker-pending-write'), null);
  assert.ok(run(w, 'reconciles(data, allWallets())'));
});

test("startup rollover failure keeps the old month, then recovers on retry", t => {
  const w = open(t, { today:'2026-09-01', beforeBoot: w => failOnce(w, KEYS.archive) });
  assert.equal(w.__app.data.month, '2026-8');
  assert.equal(w.__jsdomErrors.length, 0);
  assert.equal(run(w, 'checkCycleRollover()'), true);
});

test("rollover never replaces an existing archived cycle", t => {
  const archived = { data: { ...month(), income:99 }, wallets:settings.wallets, currency:'RM' };
  const w = open(t, { storage: { [KEYS.settings]: settings, [KEYS.data]: month(), [KEYS.archive]: { '2026-8':archived } } });
  w.__setToday('2026-09-01');
  assert.equal(run(w, 'checkCycleRollover()'), false);
  assert.equal(w.__app.archive['2026-8'].data.income, 99);
  assert.equal(w.__app.data.month, '2026-8');
});

for (const key of [KEYS.settings, KEYS.data]) {
  test(`changing the cycle day rolls back both records if ${key} fails`, t => {
    const w = open(t);
    const before = state(w);
    failOnce(w, key);
    const select = w.document.getElementById('month-start-select');
    select.value = '25';
    select.dispatchEvent(new w.Event('change', { bubbles:true }));
    assert.deepEqual(state(w), before);
    assert.equal(w.__app.settings.monthStartDay, 1);
    assert.equal(w.__app.data.cycleNext, '2026-09-01');
    assert.equal(select.value, '1');
  });
}

test("clock moving backwards and repeated checks cannot reopen or recarry a month", t => {
  const w = open(t);
  w.__setToday('2026-12-15');
  assert.equal(run(w, 'checkCycleRollover()'), true);
  const after = JSON.stringify(w.__app.data);
  w.__setToday('2026-08-01');
  assert.equal(run(w, 'checkCycleRollover()'), false);
  w.__setToday('2026-12-20');
  assert.equal(run(w, 'checkCycleRollover()'), false);
  assert.equal(JSON.stringify(w.__app.data), after);
});

for (const key of [KEYS.settings, KEYS.archive, KEYS.backup]) {
  test(`external ${key} change blocks writes to the month too`, t => {
    const w = open(t);
    const before = stored(w, KEYS.data);
    w.localStorage.setItem(key, JSON.stringify({ changed:true }));
    assert.equal(run(w, 'data.income = 12; saveData()'), false);
    assert.deepEqual(stored(w, KEYS.data), before);
  });
}

test("storage events pause stale tabs; unrelated keys do not", t => {
  const w = open(t);
  w.localStorage.setItem('unrelated', 'x');
  w.dispatchEvent(new w.StorageEvent('storage', { key:'unrelated', newValue:'x' }));
  assert.equal(run(w, 'storageConflict'), false);
  w.localStorage.setItem(KEYS.data, JSON.stringify({ ...month(), income:2000 }));
  w.dispatchEvent(new w.StorageEvent('storage', { key:KEYS.data }));
  assert.equal(run(w, 'storageConflict'), true);
  assert.equal(run(w, 'saveSettings()'), false);
});

function spendingDraft(w, amount = 20) {
  w.document.getElementById('sc-name').value = 'Lunch';
  w.document.getElementById('sc-category').value = 'Others';
  w.document.getElementById('sc-amount').value = String(amount);
}

test('rapid expense taps save once, but an intentionally re-entered identical expense is allowed', t => {
  const w = open(t);
  spendingDraft(w);
  const take = w.document.getElementById('take-money');
  take.click(); take.click();
  assert.equal(w.__app.data.secondChoice.length, 1);
  spendingDraft(w); take.click();
  assert.equal(w.__app.data.secondChoice.length, 2);
});

test('rapid income confirmation taps save once', t => {
  const w = open(t);
  spendingDraft(w);
  w.document.getElementById('add-money').click();
  const confirm = w.document.getElementById('source-new');
  confirm.click(); confirm.click();
  assert.equal(w.__app.data.secondChoice.length, 1);
});

test('rapid priority-bill taps save once', t => {
  const w = open(t);
  w.document.getElementById('pb-name').value = 'Rent';
  w.document.getElementById('pb-category').value = 'Bills';
  w.document.getElementById('pb-amount').value = '100';
  const add = w.document.getElementById('add-priority');
  add.click(); add.click();
  assert.equal(w.__app.data.priority.length, 1);
});

test('rapid wallet entry taps save once', t => {
  const w = open(t);
  const section = w.document.querySelector('[data-wallet-id="w0"]');
  section.querySelector('[data-role="item-name"]').value = 'Food';
  section.querySelector('[data-role="item-amount"]').value = '20';
  const take = section.querySelector('[data-role="take-btn"]');
  take.click(); take.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 1);
});

test('failed ordinary expense keeps the draft and can be retried once', t => {
  const w = open(t);
  spendingDraft(w);
  failOnce(w, KEYS.data);
  w.document.getElementById('take-money').click();
  assert.equal(w.__app.data.secondChoice.length, 0);
  assert.equal(w.document.getElementById('sc-name').value, 'Lunch');
  w.document.getElementById('take-money').click();
  assert.equal(w.__app.data.secondChoice.length, 1);
});

test('an action at midnight rolls over first without submitting a stale confirmation', t => {
  const w = open(t);
  run(w, 'openTransferModal(settings.wallets[0], "Old", 50, new Date().toISOString(), () => {})');
  const button = w.document.querySelector('#transfer-destinations button');
  w.__setToday('2026-09-01');
  button.click(); button.click();
  assert.equal(w.__app.data.month, '2026-9');
  assert.equal(w.__app.data.secondChoice.length, 0);
  assert.equal(w.__app.data.carryOver, 1000);
  assert.equal(w.__app.archive['2026-8'].data.secondChoice.length, 0);
});

test('a pending inline income edit cannot save into the next cycle through blur', t => {
  const w = open(t);
  w.document.getElementById('income-card').click();
  const input = w.document.getElementById('total-income-input');
  input.value = '9000';
  w.__setToday('2026-09-01');
  input.blur();
  assert.equal(w.__app.data.month, '2026-9');
  assert.equal(w.__app.data.income, null);
  assert.equal(w.__app.archive['2026-8'].data.income, 1000);
  assert.equal(input.classList.contains('hidden'), true);
  assert.equal(input.value, '');
});

test('a failed rollover still allows Settings and exporting a recovery file', t => {
  const w = open(t);
  w.__setToday('2026-09-01');
  const original = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function(key, value) {
    if (key === KEYS.archive) throw new Error('Full');
    return original.call(this, key, value);
  };
  assert.equal(run(w, 'checkCycleRollover()'), false);
  w.document.getElementById('settings-toggle').click();
  assert.equal(w.document.getElementById('settings-panel').classList.contains('hidden'), false);
  let exported = false;
  w.URL.createObjectURL = () => { exported = true; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.document.getElementById('export-data-btn').click();
  assert.equal(exported, true);
});

test('failed rollback keeps the journal, blocks further writes, and recovers after restart', t => {
  const w = open(t);
  const original = w.Storage.prototype.setItem;
  let failing = false;
  w.Storage.prototype.setItem = function(key, value) {
    if (key === KEYS.settings) { failing = true; throw new Error('Full'); }
    if (key === KEYS.archive && failing) throw new Error('Rollback unavailable');
    return original.call(this, key, value);
  };
  w.__setToday('2026-09-01');
  assert.equal(run(w, 'checkCycleRollover()'), false);
  assert.equal(run(w, 'storageConflict'), true);
  assert.equal(run(w, 'saveData()'), false);
  const journal = 'monthly-money-tracker-pending-write';
  assert.ok(w.localStorage.getItem(journal));
  const reloaded = open(t, { today:'2026-09-01', storage:Object.fromEntries(
    [KEYS.data, KEYS.settings, KEYS.archive, KEYS.backup, journal]
      .map(key => [key, w.localStorage.getItem(key)]).filter(([, value]) => value !== null)
  ) });
  assert.equal(reloaded.__app.data.month, '2026-9');
  assert.equal(reloaded.__app.data.carryOver, 1000);
  assert.equal(reloaded.localStorage.getItem(journal), null);
});

test('closing a funded wallet is all-or-nothing when saving settings fails', t => {
  const w = open(t);
  const before = JSON.stringify(w.__app.data);
  run(w, 'walletPendingDelete = settings.wallets[0]');
  failOnce(w, KEYS.settings);
  w.document.getElementById('confirm-delete-wallet').click();
  assert.equal(JSON.stringify(w.__app.data), before);
  assert.equal(w.__app.settings.wallets[0].deleted, undefined);
  w.document.getElementById('confirm-delete-wallet').click();
  assert.equal(w.__app.settings.wallets[0].deleted, true);
  assert.equal(run(w, 'getWalletBalance("w0")'), 0);
  assert.equal(run(w, 'getMainRemaining()'), 900);
});

test('month-end and leap-year cycles carry once and keep correct boundaries', t => {
  const w = open(t, { today:'2028-02-28', storage:{
    [KEYS.settings]:{ ...settings, monthStartDay:31 },
    [KEYS.data]:{ ...month(), month:'2028-1', cycleStart:'2028-01-31', cycleNext:'2028-02-29' }
  } });
  assert.equal(run(w, 'checkCycleRollover()'), false);
  w.__setToday('2028-02-29');
  assert.equal(run(w, 'checkCycleRollover()'), true);
  assert.equal(w.__app.data.cycleNext, '2028-03-31');
  assert.equal(w.__app.data.carryOver, 1000);
  w.__setToday('2028-04-30');
  assert.equal(run(w, 'checkCycleRollover()'), true);
  assert.equal(w.__app.data.cycleNext, '2028-05-31');
  assert.equal(w.__app.data.carryOver, 1000);
});

test('wallet-to-wallet shortfall and its expense save as one retryable action', t => {
  const w = open(t);
  const section = w.document.querySelector('[data-wallet-id="w0"]');
  section.querySelector('[data-role="item-name"]').value = 'Food';
  section.querySelector('[data-role="item-amount"]').value = '350';
  section.querySelector('[data-role="take-btn"]').click();
  const button = w.document.querySelector('[aria-label="Move the shortfall from Fuel"]');
  failOnce(w, KEYS.data); button.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 0);
  assert.equal(w.__app.data.walletData.w1.items.length, 0);
  button.click(); button.click();
  assert.equal(w.__app.data.walletData.w0.items.length, 2);
  assert.equal(w.__app.data.walletData.w1.items.length, 1);
  assert.equal(run(w, 'getWalletBalance("w1")'), 50);
  assert.ok(run(w, 'reconciles(data, allWallets())'));
});

test('covering a main expense from a wallet commits exactly one linked transfer and expense', t => {
  const w = open(t);
  spendingDraft(w, 650);
  w.document.getElementById('take-money').click();
  const button = w.document.querySelector('[aria-label="Cover the shortfall from Grocery"]');
  failOnce(w, KEYS.data); button.click();
  assert.equal(w.__app.data.secondChoice.length, 0);
  assert.equal(w.__app.data.walletData.w0.items.length, 0);
  button.click(); button.click();
  assert.equal(w.__app.data.secondChoice.length, 2);
  assert.equal(w.__app.data.walletData.w0.items.length, 1);
  assert.equal(run(w, 'getMainRemaining()'), 0);
  assert.ok(run(w, 'reconciles(data, allWallets())'));
});

test('a bill-payment confirmation still targets the original bill after a failed save and retry', t => {
  const w = open(t);
  run(w, 'data.priority.push({name:"Rent",category:"Bills",amount:650,paid:false}); saveData(); renderPriority()');
  w.document.querySelector('#priority-list input').click();
  const button = w.document.querySelector('[aria-label="Cover the shortfall from Grocery"]');
  failOnce(w, KEYS.data); button.click();
  assert.equal(w.__app.data.priority[0].paid, false);
  button.click(); button.click();
  assert.equal(w.__app.data.priority[0].paid, true);
  assert.equal(w.__app.data.walletData.w0.items.length, 1);
  assert.equal(run(w, 'getMainRemaining()'), 0);
});

test('an exact decimal balance is enough and never renders as a negative zero', t => {
  const w = open(t);
  run(w, `
    data.income = 0.3;
    data.priority = [];
    data.secondChoice = [{ name: "Small spend", category: "Others", amount: 0.1, type: "take", date: new Date().toISOString() }];
    data.walletData = { w0: { budget: 0, items: [] }, w1: { budget: 0, items: [] } };
    saveData(); renderWallets(); calculateRemaining();
  `);

  const section = w.document.querySelector('[data-wallet-id="w0"]');
  section.querySelector('[data-role="item-name"]').value = 'Exact amount';
  section.querySelector('[data-role="item-amount"]').value = '0.2';
  section.querySelector('[data-role="add-btn"]').click();

  assert.equal(w.__app.data.walletData.w0.items.length, 1);
  assert.equal(run(w, 'moneyCents(getMainRemaining())'), 0);
  assert.equal(w.document.getElementById('overspend-modal').classList.contains('hidden'), true);

  run(w, `
    data.income = 0.3;
    data.priority = [{ name: "Exact bill", category: "Bills", amount: 0.3, paid: false }];
    data.secondChoice = [];
    data.walletData = { w0: { budget: 0, items: [] }, w1: { budget: 0, items: [] } };
    calculateRemaining();
  `);
  assert.doesNotMatch(w.document.getElementById('projection-line').textContent, /overspent by RM 0\.00/);
  assert.equal(w.document.getElementById('insight-projected').textContent, 'RM 0.00');
  assert.equal(run(w, 'fmt(-0.00000001)'), '0.00');
});
