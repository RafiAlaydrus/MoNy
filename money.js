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

  // Wallets that could cover a shortfall on their own, richest first. Only
  // wallets that cover it in full are offered, so choosing one always lands
  // the main balance back at zero rather than a smaller overspend.
  function walletsCovering(d, wallets, shortfall) {
    return (wallets || [])
      .filter(w => !w.deleted)
      .map(w => ({ wallet: w, balance: walletBalanceOf((d.walletData || {})[w.id]) }))
      .filter(x => x.balance >= shortfall - 1e-9)
      .sort((a, b) => b.balance - a.balance);
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

  /* The carried balance split by where it landed: what stayed in main, and
     what reopened inside each wallet. carryOver holds the same money as a
     single total and remains the figure the maths uses - this is only the
     breakdown, so the history rows can say where each part came from.

     Absent on months carried before the split was stored; those report zero
     and simply show no rows rather than guessing at a division. */
  function carryInOf(d) {
    const c = (d && d.carryIn) || {};
    const main = Number(c.main);
    const wallets = {};
    Object.keys(c.wallets || {}).forEach(id => {
      const v = Number(c.wallets[id]);
      if (Number.isFinite(v) && v > 0) wallets[id] = v;
    });
    return { main: Number.isFinite(main) && main > 0 ? main : 0, wallets };
  }

  // Bills listed but not yet ticked off - what is still owed this month.
  function unpaidPriorityOf(d) {
    return ((d && d.priority) || []).reduce(
      (sum, b) => sum + (b.paid ? 0 : Number(b.amount) || 0), 0);
  }

  /* What the main balance will be once every outstanding bill is paid.

     A FORECAST, not a state: no money has moved, so this deliberately takes
     no part in the invariant and nothing else is derived from it. It exists
     so the balance after bills can be seen without ticking them, and it
     converges on mainRemaining as they are ticked. */
  function projectedRemainingOf(d, wallets) {
    if (monthIsUnset(d)) return 0;
    return mainRemainingOf(d, wallets) - unpaidPriorityOf(d);
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

  /* ---------------------------------------------------------------------
     BUDGET CYCLES

     A "month" does not have to start on the 1st. Someone paid on the 25th
     budgets from the 25th, so a cycle runs from the chosen day of one
     calendar month to the day before the next one starts.

     Two formats, deliberately different so they cannot be confused:
       - cycle start dates are "YYYY-MM-DD", zero padded, so plain string
         comparison orders them correctly
       - archive keys stay "YYYY-M", unpadded, exactly as before - a cycle is
         keyed by the calendar month it STARTS in

     The key property, which the tests check exhaustively: every calendar
     month contains exactly one cycle start, so every day belongs to exactly
     one cycle. No gaps, no overlaps, and no two cycles can ever compete for
     the same archive key.
     --------------------------------------------------------------------- */

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // Days in a 1-based month. Day 0 of the next month is the last of this one,
  // which handles leap years without a special case.
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /* The day a cycle actually starts in a given month, clamped to months that
     are too short. Choose the 31st and February starts on the 28th - or the
     29th in a leap year - and April on the 30th. Without this a cycle would
     silently roll into the following month. */
  function clampStartDay(year, month, chosenDay) {
    const d = Math.floor(Number(chosenDay));
    if (!Number.isFinite(d) || d < 1) return 1;
    return Math.min(d, daysInMonth(year, month));
  }

  // The start date of the cycle that begins in a given calendar month.
  function cycleStartInMonth(year, month, chosenDay) {
    return `${year}-${pad2(month)}-${pad2(clampStartDay(year, month, chosenDay))}`;
  }

  function parseYmd(s) {
    const [y, m, d] = String(s).split("-").map(Number);
    return { y, m, d };
  }

  // "2026-08-05" -> "2026-8". The archive key is the month the cycle starts in.
  function cycleKeyOf(startDate) {
    const { y, m } = parseYmd(startDate);
    return `${y}-${m}`;
  }

  /* When the cycle after this one begins: the chosen day in the NEXT calendar
     month. Always a month ahead, which is what guarantees one cycle start per
     month and therefore one cycle per archive key. */
  function nextCycleStartOf(startDate, chosenDay) {
    const { y, m } = parseYmd(startDate);
    let ny = y, nm = m + 1;
    if (nm > 12) { nm = 1; ny += 1; }
    return cycleStartInMonth(ny, nm, chosenDay);
  }

  /* Which cycle a given date falls in. Before this month's start day the date
     still belongs to the cycle that began last month. Used to open the very
     first month, and to sanity-check a stored cycle. */
  function cycleStartForDate(dateStr, chosenDay) {
    const { y, m, d } = parseYmd(dateStr);
    if (d >= clampStartDay(y, m, chosenDay)) return cycleStartInMonth(y, m, chosenDay);
    let py = y, pm = m - 1;
    if (pm < 1) { pm = 12; py -= 1; }
    return cycleStartInMonth(py, pm, chosenDay);
  }

  /* The last day of a cycle: the day before the next one starts. Display
     only - the rollover compares against the next start, never against this. */
  function cycleEndOf(startDate, chosenDay) {
    const { y, m, d } = parseYmd(nextCycleStartOf(startDate, chosenDay));
    const prev = new Date(y, m - 1, d - 1);
    return `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}-${pad2(prev.getDate())}`;
  }

  // Money brought forward from the previous month: what was left in main plus
  // whatever the wallets still held when it closed. Zero for a month that
  // started from nothing, and for every month saved before carry-over existed.
  //
  // It has to count as income for the month it lands in, even though it was
  // not earned there, because the invariant has only one place to put money
  // that is available to spend. The Total income card shows it on its own
  // "Brought forward" line rather than folding it into earnings.
  function carryOverOf(d) {
    if (!d) return 0;
    const n = Number(d.carryOver);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // A month with no income typed and nothing brought forward has not been
  // started yet, and reports null rather than zero. Carry-over alone is enough
  // to make a month real - the first of the month with money still in hand is
  // not an empty month.
  function monthIsUnset(d) {
    return (!d || d.income === null || d.income === undefined) && carryOverOf(d) === 0;
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
    if (!monthIsUnset(d)) {
      const realAdds = (d.secondChoice || []).reduce((sum, i) => {
        if (i.type !== "add") return sum;
        if (isTransferEntry(i) || isReimbursement(i)) return sum;
        return sum + Number(i.amount);
      }, 0);
      // Income may be null while carry-over is not, on the 1st of a month
      // before anything has been earned, so it is coerced rather than read
      // directly.
      totalIncome = (Number(d.income) || 0) + realAdds + excess + carryOverOf(d);
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
    if (monthIsUnset(d)) return null;
    return monthTotalsOf(d, wallets).totalIncome;
  }

  // What is left in the main balance: income, minus paid bills, minus money
  // handed over to wallets, plus or minus Second choice movements.
  function mainRemainingOf(d, wallets) {
    if (monthIsUnset(d)) return 0;

    /* Carry-over lands in main, exactly like the income figure. Wallet
       balances brought forward are NOT added here - they are written as each
       wallet's opening budget, which this function already subtracts, and
       counting them twice would invent money. */
    let remaining = (Number(d.income) || 0) + carryOverOf(d);

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

  /* What a month leaves behind when it closes: cash still in main plus every
     wallet balance. This is the figure the next month opens with, and it is
     computed here rather than in app.js so the rollover and the tests agree
     on it. Never negative - an overspent month carries nothing forward rather
     than starting the next one in debt, which would be a second, hidden way
     to go negative. */
  function closingBalanceOf(d, wallets) {
    if (monthIsUnset(d)) return { main: 0, wallets: {}, total: 0 };

    const main = Math.max(mainRemainingOf(d, wallets), 0);
    const walletBalances = {};
    let walletTotal = 0;

    (wallets || []).forEach(w => {
      const bal = walletBalanceOf((d.walletData || {})[w.id]);
      if (bal > 0) {
        walletBalances[w.id] = bal;
        walletTotal += bal;
      }
    });

    return { main, wallets: walletBalances, total: main + walletTotal };
  }

  return {
    isWalletInflow,
    isTransferEntry,
    isReimbursement,
    isValidAmount,
    carryOverOf,
    carryInOf,
    unpaidPriorityOf,
    projectedRemainingOf,
    monthIsUnset,
    closingBalanceOf,
    daysInMonth,
    clampStartDay,
    cycleStartInMonth,
    cycleKeyOf,
    nextCycleStartOf,
    cycleStartForDate,
    cycleEndOf,
    minBudgetOf,
    walletsCovering,
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
