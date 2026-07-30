/* =========================
   MONEY MATH (SHARED)

   Pure functions over one month's data. No DOM, no storage, no globals of
   its own. Loaded as a browser global by index.html and required directly
   by test/money.test.mjs, so the app and its tests run the same formulas
   instead of two copies that can drift apart.

   The invariant every function below has to preserve:

     spent + inWallets + mainRemaining === totalIncome
========================= */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  // Wallet items that raise a wallet's balance: "add" pulls from the main
  // balance, "in" arrives from another wallet.
  function isWalletInflow(item) {
    return item.type === "add" || item.type === "in";
  }

  // A Second choice entry that is money coming back out of a wallet rather
  // than new income. Entries written before transfers were tagged only
  // carry the category, so both forms are recognised.
  function isTransferEntry(item) {
    return item.transfer === true || item.category === "Transfer";
  }

  // What a wallet currently holds.
  function walletBalanceOf(wd) {
    if (!wd) return 0;
    return (wd.items || []).reduce((bal, i) => {
      return bal + (isWalletInflow(i) ? Number(i.amount) : -Number(i.amount));
    }, Number(wd.budget) || 0);
  }

  // Net outflow from a wallet, used for its progress bar.
  function walletSpentOf(wd) {
    if (!wd) return 0;
    return (wd.items || []).reduce((sum, i) => {
      return sum + (isWalletInflow(i) ? -Number(i.amount) : Number(i.amount));
    }, 0);
  }

  // Money actually taken out of a wallet and spent. Transfers out move money
  // somewhere else that still counts it, so they are not spending.
  function walletTakenOf(wd) {
    if (!wd) return 0;
    return (wd.items || []).reduce((sum, i) => {
      return sum + (i.type === "take" ? Number(i.amount) : 0);
    }, 0);
  }

  // Income set on the card plus real money received through Second choice.
  // Transfers back from a wallet are excluded: that money was already
  // counted as income when it first arrived.
  function totalIncomeOf(d) {
    if (!d || d.income === null || d.income === undefined) return null;
    const adds = (d.secondChoice || []).reduce((sum, i) => {
      if (i.type !== "add" || isTransferEntry(i)) return sum;
      return sum + Number(i.amount);
    }, 0);
    return Number(d.income) + adds;
  }

  // What is left in the main balance: income, minus paid bills, minus money
  // handed over to wallets, plus or minus Second choice movements.
  function mainRemainingOf(d, wallets) {
    if (!d || d.income === null || d.income === undefined) return 0;

    let remaining = Number(d.income);

    (d.priority || []).forEach(b => {
      if (b.paid) remaining -= Number(b.amount);
    });

    (wallets || []).forEach(w => {
      const wd = (d.walletData || {})[w.id];
      if (!wd) return;
      if (wd.budget) remaining -= Number(wd.budget);
      (wd.items || []).forEach(i => {
        if (i.type === "add") remaining -= Number(i.amount);
      });
    });

    (d.secondChoice || []).forEach(i => {
      remaining += i.type === "add" ? Number(i.amount) : -Number(i.amount);
    });

    return remaining;
  }

  // Splits a month into what was actually spent per category and what is
  // still sitting in wallets. Budgeting money into a wallet only moves it;
  // it becomes spending once it is taken out.
  function spendingBreakdownOf(d, wallets) {
    const categories = {};

    (d.priority || []).forEach(b => {
      if (b.paid) {
        const cat = b.category || "Others";
        categories[cat] = (categories[cat] || 0) + Number(b.amount);
      }
    });

    (d.secondChoice || []).forEach(i => {
      if (i.type === "take") {
        const cat = i.category || "Others";
        categories[cat] = (categories[cat] || 0) + Number(i.amount);
      }
    });

    let inWallets = 0;
    (wallets || []).forEach(w => {
      const wd = (d.walletData || {})[w.id];
      if (!wd) return;

      const spentHere = walletTakenOf(wd);
      if (spentHere > 0) categories[w.name] = (categories[w.name] || 0) + spentHere;
      inWallets += walletBalanceOf(wd);
    });

    const spent = Object.values(categories).reduce((a, b) => a + b, 0);
    return { categories, inWallets, spent };
  }

  // Convenience for tests and assertions: does this month balance?
  function reconciles(d, wallets, epsilon = 1e-9) {
    const income = totalIncomeOf(d);
    if (income === null) return true;
    const b = spendingBreakdownOf(d, wallets);
    const sum = b.spent + b.inWallets + mainRemainingOf(d, wallets);
    return Math.abs(sum - income) < epsilon;
  }

  return {
    isWalletInflow,
    isTransferEntry,
    walletBalanceOf,
    walletSpentOf,
    walletTakenOf,
    totalIncomeOf,
    mainRemainingOf,
    spendingBreakdownOf,
    reconciles
  };
});
