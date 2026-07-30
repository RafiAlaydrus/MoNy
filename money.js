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

  // Every amount the app stores has to be a positive, finite number. A
  // negative would invert the meaning of its own entry - a "take" of -50
  // would hand you money - and drives category totals below zero, which the
  // books cannot represent.
  function isValidAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  // The smallest budget a wallet can be set to without its balance going
  // negative: whatever it has already paid out, less whatever it took in.
  // Shrinking a budget below this would conjure money out of nothing.
  function minBudgetOf(wd) {
    if (!wd) return 0;
    const committed = (wd.items || []).reduce((sum, i) => {
      return sum + (isWalletInflow(i) ? -Number(i.amount) : Number(i.amount));
    }, 0);
    return Math.max(committed, 0);
  }

  // A Second choice entry that is money coming back out of a wallet rather
  // than new income. Entries written before transfers were tagged only
  // carry the category, so both forms are recognised.
  function isTransferEntry(item) {
    return item.transfer === true || item.category === "Transfer";
  }

  // Money the user got back rather than earned: they fronted a cost and were
  // repaid. Marked explicitly at entry time; entries without the flag predate
  // the question and stay counted as new income.
  function isReimbursement(item) {
    return item.type === "add" && item.newMoney === false && !isTransferEntry(item);
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

  // One pass over a month producing every derived figure, so income and the
  // spending breakdown can never disagree about how much was reimbursed.
  //
  // Reimbursements cancel spending rather than adding to income: their own
  // category first, then the largest remaining categories, because money
  // fronted from a wallet comes back into main under a different label.
  // Anything that finds no spending to cancel really is new money.
  function monthTotalsOf(d, wallets) {
    const categories = {};
    const bump = (cat, amount) => {
      const key = cat || "Others";
      categories[key] = (categories[key] || 0) + Number(amount);
    };

    (d.priority || []).forEach(b => { if (b.paid) bump(b.category, b.amount); });
    (d.secondChoice || []).forEach(i => { if (i.type === "take") bump(i.category, i.amount); });

    let inWallets = 0;
    (wallets || []).forEach(w => {
      const wd = (d.walletData || {})[w.id];
      if (!wd) return;
      const taken = walletTakenOf(wd);
      if (taken > 0) bump(w.name, taken);
      inWallets += walletBalanceOf(wd);
    });

    let excess = 0;
    (d.secondChoice || []).forEach(i => {
      if (!isReimbursement(i)) return;

      let left = Number(i.amount);
      const own = i.category || "Others";
      const order = [own].concat(
        Object.keys(categories)
          .filter(c => c !== own)
          .sort((a, b) => categories[b] - categories[a])
      );

      order.forEach(c => {
        if (left <= 0) return;
        const available = categories[c] || 0;
        const used = Math.min(available, left);
        if (used > 0) { categories[c] = available - used; left -= used; }
      });

      if (left > 0) excess += left;
    });

    // Drop categories the reimbursements emptied, allowing for float dust
    Object.keys(categories).forEach(c => {
      if (categories[c] < 1e-9) delete categories[c];
    });

    const spent = Object.values(categories).reduce((a, b) => a + b, 0);

    let totalIncome = null;
    if (d && d.income !== null && d.income !== undefined) {
      const realAdds = (d.secondChoice || []).reduce((sum, i) => {
        if (i.type !== "add") return sum;
        if (isTransferEntry(i) || isReimbursement(i)) return sum;
        return sum + Number(i.amount);
      }, 0);
      totalIncome = Number(d.income) + realAdds + excess;
    }

    return {
      categories,
      inWallets,
      spent,
      excess,
      totalIncome,
      mainRemaining: mainRemainingOf(d, wallets)
    };
  }

  // Income set on the card, plus money genuinely earned through Second choice.
  // Wallet transfers back and reimbursements are excluded - that money was
  // already counted when it first arrived.
  function totalIncomeOf(d, wallets) {
    if (!d || d.income === null || d.income === undefined) return null;
    return monthTotalsOf(d, wallets).totalIncome;
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

  // What was actually spent per category, net of reimbursements, plus what is
  // still sitting in wallets. Budgeting money into a wallet only moves it;
  // it becomes spending once it is taken out.
  function spendingBreakdownOf(d, wallets) {
    const t = monthTotalsOf(d, wallets);
    return { categories: t.categories, inWallets: t.inWallets, spent: t.spent };
  }

  // Convenience for tests and assertions: does this month balance?
  function reconciles(d, wallets, epsilon = 1e-9) {
    const t = monthTotalsOf(d, wallets);
    if (t.totalIncome === null) return true;
    const sum = t.spent + t.inWallets + t.mainRemaining;
    return Math.abs(sum - t.totalIncome) < epsilon;
  }

  return {
    isWalletInflow,
    isTransferEntry,
    isReimbursement,
    isValidAmount,
    minBudgetOf,
    walletBalanceOf,
    walletSpentOf,
    walletTakenOf,
    totalIncomeOf,
    mainRemainingOf,
    spendingBreakdownOf,
    monthTotalsOf,
    reconciles
  };
});
