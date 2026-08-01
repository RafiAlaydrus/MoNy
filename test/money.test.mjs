/* Run with:  node --test test/     (or: npm test)
 *
 * These exercise money.js directly - the same file the browser loads - so a
 * formula change that breaks the books fails here instead of on a phone.
 *
 * Two conventions worth knowing before adding a test:
 *
 * 1. Every scenario ends with assertReconciles. The invariant is the point;
 *    an assertion about one figure can pass while the month as a whole is
 *    nonsense.
 *
 * 2. Tests named REGRESSION encode a bug that actually shipped. Each one has
 *    been verified to FAIL when its fix is reverted - a test that cannot fail
 *    is worse than no test, because it buys false confidence. If you touch
 *    money.js, break the fix on purpose once and confirm red before trusting
 *    green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/* money.js is a UMD-style CommonJS module, not ESM, and it is loaded here by
   path rather than copied. That is deliberate: the tests must run the exact
   bytes the browser loads, because the one real accounting bug in this
   project's history came from two copies of the same formula drifting apart. */
const require = createRequire(import.meta.url);
const M = require("../money.js");

/* Builds wallet definition objects with predictable ids - W("Grocery","Fuel")
   gives w0 and w1, matching the walletData keys each test writes by hand.
   Wallets live in settings in the real app, so the math functions always take
   them as an argument rather than reading them from the month. */
const W = (...names) => names.map((name, i) => ({ id: `w${i}`, name }));

/* THE invariant: spent + inWallets + mainRemaining === totalIncome.
   Every unit of money is in exactly one of three states - gone, set aside, or
   still in main - and they must add back up to what came in. The epsilon
   absorbs binary float dust (0.3 - 0.1 - 0.2 leaves about -1e-13), and the
   message prints all four figures because knowing WHICH side is wrong is most
   of the diagnosis. */
function assertReconciles(label, d, wallets) {
  const income = M.totalIncomeOf(d, wallets);
  const b = M.spendingBreakdownOf(d, wallets);
  const main = M.mainRemainingOf(d, wallets);
  const sum = b.spent + b.inWallets + main;
  assert.ok(
    Math.abs(sum - income) < 1e-9,
    `${label}: spent ${b.spent} + inWallets ${b.inWallets} + main ${main} = ${sum}, expected totalIncome ${income}`
  );
}

/* ---------------------------------------------------------------------------
   BASELINE - the simplest shapes, which everything else builds on
--------------------------------------------------------------------------- */

/* A month before the user has typed anything. Income is null rather than 0
   because "not set yet" and "earned nothing" render differently, and the
   invariant is vacuously true when there is no income to balance against. */
test("empty month reconciles and reports no income", () => {
  const d = { income: null, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.totalIncomeOf(d, []), null);
  assert.equal(M.mainRemainingOf(d, []), 0);
  assert.ok(M.reconciles(d, []));
});

/* Income set, nothing spent: it should all still be sitting in main. */
test("income only", () => {
  const d = { income: 1000, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.totalIncomeOf(d, []), 1000);
  assert.equal(M.mainRemainingOf(d, []), 1000);
  assertReconciles("income only", d, []);
});

/* A bill is a plan until it is ticked. Listing what you owe must not move any
   money - only `paid: true` spends. */
test("paid bills count as spending, unpaid do not", () => {
  const d = {
    income: 1000,
    priority: [
      { name: "Rent", category: "Bills", amount: 200, paid: true },
      { name: "Wifi", category: "Bills", amount: 50, paid: false }
    ],
    secondChoice: [], walletData: {}
  };
  const b = M.spendingBreakdownOf(d, []);
  assert.equal(b.spent, 200);
  assert.equal(M.mainRemainingOf(d, []), 800);
  assertReconciles("bills", d, []);
});

/* ---------------------------------------------------------------------------
   WALLETS - moving money vs spending it
--------------------------------------------------------------------------- */

/* The distinction the whole wallet feature rests on, and the v1.11.0 bug:
   allocating RM 650 across wallets was reported as RM 650 spent when only
   RM 39.60 had been used. Money in a wallet has left main but is not gone. */
test("budgeting into a wallet is not spending", () => {
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [], secondChoice: [],
    walletData: { w0: { budget: 300, items: [] } }
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 0, "moving money into a wallet must not read as spent");
  assert.equal(b.inWallets, 300);
  assert.equal(M.mainRemainingOf(d, wallets), 700);
  assertReconciles("wallet budget", d, wallets);
});

/* The other half of that rule: a `take` is the moment it becomes spending.
   It is filed under the WALLET's name, not a category, which is why a wallet
   may not be named after one of the five fixed chart categories - the two
   would merge into one slice. */
test("taking from a wallet is spending, attributed to the wallet", () => {
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [], secondChoice: [],
    walletData: { w0: { budget: 300, items: [{ name: "food", amount: 100, type: "take" }] } }
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 100);
  assert.equal(b.categories.Grocery, 100);
  assert.equal(b.inWallets, 200);
  assertReconciles("wallet take", d, wallets);
});

/* ---------------------------------------------------------------------------
   INCOME - what counts as new money, and what only looks like it
--------------------------------------------------------------------------- */

/* Money genuinely earned mid-month raises both income and what you can spend.
   The contrast cases are the two tests below. */
test("real Second choice income raises total income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Freelance", category: "Others", amount: 100, type: "add" }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100);
  assert.equal(M.mainRemainingOf(d, []), 1100);
  assertReconciles("extra income", d, []);
});

/* The v1.13.0 bug. Pulling your own money back out of a wallet was read as
   fresh earnings, so income climbed every time you moved money around. Both
   halves of the transfer are written here because that is what the app
   stores - deleting either half removes both.

   Revert the transfer exclusion in money.js and four tests go red. */
test("REGRESSION: transfer back to Main must not inflate total income", () => {
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [],
    // 50 moved out of the wallet and back into main
    walletData: { w0: { budget: 300, items: [{ name: "back", amount: 50, type: "out", toId: "main" }] } },
    secondChoice: [{ name: "back", category: "Transfer", amount: 50, type: "add", transfer: true }]
  };
  assert.equal(M.totalIncomeOf(d, wallets), 1000, "returning your own money is not new income");
  assert.equal(M.mainRemainingOf(d, wallets), 750);
  assert.equal(M.spendingBreakdownOf(d, wallets).inWallets, 250);
  assertReconciles("transfer to main", d, wallets);
});

/* Data written before `transfer: true` existed is still on people's phones.
   isTransferEntry falls back to the category name so those months keep
   totalling correctly - the reason that fallback can never be removed. */
test("legacy transfer rows without the flag are still excluded from income", () => {
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [],
    walletData: { w0: { budget: 300, items: [{ amount: 50, type: "out", toId: "main" }] } },
    // written before transfers carried an explicit flag
    secondChoice: [{ name: "back", category: "Transfer", amount: 50, type: "add" }]
  };
  assert.equal(M.totalIncomeOf(d, wallets), 1000);
  assertReconciles("legacy transfer to main", d, wallets);
});

/* ---------------------------------------------------------------------------
   TRANSFERS - two linked halves that must never create or destroy money
--------------------------------------------------------------------------- */

/* Shuffling between wallets touches nothing outside them: main is unchanged
   and inWallets still totals the same 400. */
test("wallet to wallet transfer moves money without creating or spending it", () => {
  const wallets = W("Grocery", "Fuel");
  const d = {
    income: 1000, priority: [], secondChoice: [],
    walletData: {
      w0: { budget: 300, items: [{ amount: 50, type: "out", toId: "w1" }] },
      w1: { budget: 100, items: [{ amount: 50, type: "in", fromId: "w0" }] }
    }
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 0);
  assert.equal(b.inWallets, 400, "300 + 100 stays in wallets regardless of the shuffle");
  assert.equal(M.mainRemainingOf(d, wallets), 600);
  assertReconciles("wallet to wallet", d, wallets);
});

/* Both types raise a wallet's balance, but only `add` takes from main - an
   `in` arrived from another wallet, where the money was already accounted
   for. Confusing the two would mint or destroy money on every transfer, which
   is why isWalletInflow exists as its own named predicate. */
test("a wallet 'add' pulls from main, unlike an 'in'", () => {
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [], secondChoice: [],
    walletData: { w0: { budget: 100, items: [{ amount: 50, type: "add" }] } }
  };
  assert.equal(M.mainRemainingOf(d, wallets), 850, "budget 100 + add 50 both leave main");
  assert.equal(M.spendingBreakdownOf(d, wallets).inWallets, 150);
  assertReconciles("wallet add", d, wallets);
});

/* The v1.13.0 bug: deleting a wallet erased the spending it had already done,
   so closing a wallet handed you money back that was long gone.

   The fix is why allWallets() exists alongside activeWallets(): every math
   call must see closed wallets, and only the UI filters them out. */
test("closing a wallet keeps its spending on the books", () => {
  // A wallet is soft-deleted, so it stays in the math while leaving the UI.
  // Its leftover balance is returned to main as a tagged transfer first.
  const wallets = [{ id: "w0", name: "Grocery", deleted: true }];
  const d = {
    income: 1000, priority: [],
    walletData: {
      w0: {
        budget: 300,
        items: [
          { name: "food", amount: 100, type: "take" },
          { name: "Grocery closed", amount: 200, type: "out", toId: "main" }
        ]
      }
    },
    secondChoice: [{ name: "Grocery closed", category: "Transfer", amount: 200, type: "add", transfer: true }]
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 100, "the 100 actually spent must survive closing the wallet");
  assert.equal(b.inWallets, 0);
  assert.equal(M.mainRemainingOf(d, wallets), 900, "only the 100 truly spent is gone");
  assert.equal(M.totalIncomeOf(d, wallets), 1000);
  assertReconciles("closed wallet", d, wallets);
});

/* ---------------------------------------------------------------------------
   REIMBURSEMENTS - money coming back, which cancels spending

   The subtlest rule in the codebase, and the reason the app asks "new money
   or coming back?" instead of guessing. A repayment cannot simply raise
   income: the original cost would stay in `spent` while the cash was back in
   your pocket, and the three states would total more than came in. So it
   cancels the spending instead - own category first, then the largest
   remaining ones, because money fronted from a wallet often comes back into
   main under a different label.
--------------------------------------------------------------------------- */

/* The base case: spend 50, get 50 back, end up exactly where you started.
   Income is untouched, main is whole again, and the category disappears
   entirely rather than lingering at zero. */
test("reimbursement raises remaining without raising income", () => {
  // Fronted RM 50 for a friend's food, then got repaid
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [
      { name: "Friend's food", category: "Food / Drink", amount: 50, type: "take" },
      { name: "Repaid", category: "Food / Drink", amount: 50, type: "add", newMoney: false }
    ]
  };
  assert.equal(M.totalIncomeOf(d, []), 1000, "getting your own money back is not income");
  assert.equal(M.mainRemainingOf(d, []), 1000, "but you do have the money again");
  const b = M.spendingBreakdownOf(d, []);
  assert.equal(b.spent, 0, "you never net-spent it");
  assert.equal(b.categories["Food / Drink"], undefined, "the cancelled category drops out");
  assertReconciles("reimbursement", d, []);
});

/* Paid back more than was owed. The surplus has no spending left to cancel,
   so it genuinely IS new money - this is what monthTotalsOf tracks as
   `excess` and folds into income. Without it the books would not balance for
   an over-payment. */
test("a reimbursement bigger than the spending it cancels is partly new money", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [
      { name: "Snack", category: "Food / Drink", amount: 50, type: "take" },
      { name: "Overpaid", category: "Food / Drink", amount: 80, type: "add", newMoney: false }
    ]
  };
  // 50 cancels the spending, the extra 30 has nothing to cancel so it is income
  assert.equal(M.totalIncomeOf(d, []), 1030);
  assert.equal(M.spendingBreakdownOf(d, []).spent, 0);
  assertReconciles("over-reimbursement", d, []);
});

/* Why the cancellation spills past its own category. The cost was taken from
   the Grocery wallet (filed under "Grocery"), but the repayment arrives in
   main labelled "Food / Drink". A same-category-only rule would find nothing
   to cancel and wrongly book the repayment as income. */
test("a reimbursement spills over to cancel spending in other categories", () => {
  // Fronted the cost from a wallet, repaid into main under a different label
  const wallets = W("Grocery");
  const d = {
    income: 1000, priority: [],
    walletData: { w0: { budget: 300, items: [{ name: "friend's food", amount: 50, type: "take" }] } },
    secondChoice: [{ name: "Repaid", category: "Food / Drink", amount: 50, type: "add", newMoney: false }]
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 0, "the wallet spending is cancelled even though labels differ");
  assert.equal(M.totalIncomeOf(d, wallets), 1000, "no new money appeared");
  assertReconciles("spill-over reimbursement", d, wallets);
});

/* The other answer to the same question - explicitly new money behaves like
   ordinary income and does not cancel anything. */
test("new money is still counted as income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Gig", category: "Others", amount: 100, type: "add", newMoney: true }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100);
  assertReconciles("explicit new money", d, []);
});

/* Rows saved before v1.14.0 carry no newMoney flag at all. isReimbursement
   requires an explicit `false`, so absence means income and old months keep
   the totals they have always shown. Treating a missing flag as "coming back"
   would silently rewrite everyone's history. */
test("adds saved before the question existed still count as income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Old row", category: "Others", amount: 100, type: "add" }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100, "no flag means legacy income, unchanged");
  assertReconciles("legacy add", d, []);
});

/* The two exclusions must not collide. Both a transfer and a reimbursement
   are adds that skip income, but only a reimbursement cancels spending - so
   moving money out of a wallet must leave the paid Bills untouched. This is
   why isReimbursement explicitly excludes transfers rather than just checking
   the newMoney flag. */
test("a wallet transfer back is not treated as a reimbursement", () => {
  // Transfers must not cancel spending - the wallet money was never spent
  const wallets = W("Grocery");
  const d = {
    income: 1000,
    priority: [{ name: "Rent", category: "Bills", amount: 100, paid: true }],
    walletData: { w0: { budget: 300, items: [{ amount: 50, type: "out", toId: "main" }] } },
    secondChoice: [{ name: "back", category: "Transfer", amount: 50, type: "add", transfer: true }]
  };
  assert.equal(M.spendingBreakdownOf(d, wallets).categories.Bills, 100, "the paid bill is untouched");
  assert.equal(M.totalIncomeOf(d, wallets), 1000);
  assertReconciles("transfer is not a reimbursement", d, wallets);
});

/* ---------------------------------------------------------------------------
   EDGE CASES - awkward shapes that must not crash or drift
--------------------------------------------------------------------------- */

/* One month using every feature at once: paid and unpaid bills, takes, real
   income, a transfer to main, a wallet take, a top-up, and a wallet-to-wallet
   move. Individually-correct rules can still interact wrongly, and this is
   the test that would catch that. */
test("everything at once still balances", () => {
  const wallets = W("Grocery", "Fuel");
  const d = {
    income: 1056.17,
    priority: [
      { name: "Rent", category: "Bills", amount: 200, paid: true },
      { name: "Claude", category: "Subscription", amount: 99.9, paid: false }
    ],
    secondChoice: [
      { name: "Debt", category: "Others", amount: 300, type: "take" },
      { name: "LRT", category: "Transport", amount: 30, type: "take" },
      { name: "Gig", category: "Others", amount: 120, type: "add" },
      { name: "back", category: "Transfer", amount: 40, type: "add", transfer: true }
    ],
    walletData: {
      w0: {
        budget: 500,
        items: [
          { name: "sushi", amount: 39.6, type: "take" },
          { name: "top up", amount: 25, type: "add" },
          { name: "back", amount: 40, type: "out", toId: "main" },
          { name: "to fuel", amount: 60, type: "out", toId: "w1" }
        ]
      },
      w1: { budget: 150, items: [{ name: "to fuel", amount: 60, type: "in", fromId: "w0" }] }
    }
  };
  assert.equal(M.totalIncomeOf(d, wallets), 1176.17, "1056.17 + 120 gig, transfer excluded");
  assertReconciles("kitchen sink", d, wallets);
});

/* Deliberately awkward thirds and cents. Binary floats cannot represent them
   exactly, so this guards that the accumulated error stays inside the epsilon
   rather than growing into a visible discrepancy. */
test("fractional amounts do not drift", () => {
  const wallets = W("Grocery");
  const d = {
    income: 100.03, priority: [],
    secondChoice: [{ name: "x", category: "Others", amount: 33.34, type: "take" }],
    walletData: { w0: { budget: 33.33, items: [{ name: "y", amount: 11.11, type: "take" }] } }
  };
  assertReconciles("fractions", d, wallets);
});

/* A wallet that exists but holds nothing. It must contribute zero everywhere
   without being mistaken for missing data or dropped from the totals. */
test("spending is never negative and wallets never silently vanish", () => {
  const wallets = W("Grocery");
  const d = {
    income: 500, priority: [], secondChoice: [],
    walletData: { w0: { budget: 0, items: [] } }
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 0);
  assert.equal(b.inWallets, 0);
  assertReconciles("zero budget wallet", d, wallets);
});

/* ---------------------------------------------------------------------------
   VALIDATION REGRESSIONS - shapes the UI must never be able to produce

   These two work as a pair: the first proves the guard rejects bad input, the
   second proves WHY it has to, by showing the books breaking when it does not.
--------------------------------------------------------------------------- */

/* The bad list is the interesting half. 0 is rejected because a zero-amount
   entry is noise, Infinity because it poisons every downstream total, and
   numeric strings are accepted because that is what an <input> hands over. */
test("REGRESSION: amounts must be positive finite numbers", () => {
  // -50 is truthy, so a plain !!amount check let negatives through and a
  // "take" of -50 handed the user money instead of spending it
  [-50, -0.01, 0, "", "abc", null, undefined, NaN, Infinity, -Infinity].forEach(bad => {
    assert.equal(M.isValidAmount(bad), false, `${String(bad)} should be rejected`);
  });
  [0.01, 1, 50, 1e6, "25", "0.5"].forEach(good => {
    assert.equal(M.isValidAmount(good), true, `${String(good)} should be accepted`);
  });
});

test("REGRESSION: a negative amount would break the books", () => {
  // Proof of why isValidAmount has to be enforced at every entry point: a
  // negative take drives its category below zero, the emptied-category
  // cleanup drops it, and 'spent' silently loses the amount.
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "neg", category: "Others", amount: -50, type: "take" }]
  };
  assert.equal(M.reconciles(d, []), false, "this shape must not be reachable through the UI");
});

/* ---------------------------------------------------------------------------
   BUDGET FLOOR - the other v1.14.2 fix

   A wallet's balance is budget + inflows - outflows, so lowering the budget
   after money has left drags the balance negative and conjures the difference
   into main. minBudgetOf computes how far down is safe.
--------------------------------------------------------------------------- */

/* The exact reported sequence. The second assertion documents the broken
   shape the floor exists to prevent, rather than only asserting the fix. */
test("REGRESSION: a budget cannot shrink below what the wallet already paid out", () => {
  // budget 300, all 300 transferred to main, then budget lowered to 100 gave
  // a -200 balance and more money in main than the income
  const wd = { budget: 300, items: [{ name: "out", amount: 300, type: "out", toId: "main" }] };
  assert.equal(M.minBudgetOf(wd), 300, "300 already left, so 300 is the floor");
  assert.equal(M.walletBalanceOf({ ...wd, budget: 300 }), 0);
  assert.equal(M.walletBalanceOf({ ...wd, budget: 100 }), -200, "the shape the floor prevents");
});

/* The floor is NET, not gross outflow. Money that came back in raises the
   headroom again, so a wallet that spent 250 but was topped up by 100 can go
   as low as 150. Flattening minBudgetOf to count only outflows fails this
   test and the one above. */
test("the budget floor accounts for money that came back in", () => {
  const wd = {
    budget: 300,
    items: [
      { name: "spent", amount: 250, type: "take" },
      { name: "topped up", amount: 100, type: "add" }
    ]
  };
  // paid out 250, took in 100, so only 150 is truly committed
  assert.equal(M.minBudgetOf(wd), 150);
  assert.equal(M.walletBalanceOf({ ...wd, budget: 150 }), 0, "at the floor the balance is exactly zero");
});

/* Nothing committed, no floor - the guard must not restrict a wallet that has
   never been used. */
test("an untouched wallet can have its budget lowered freely", () => {
  assert.equal(M.minBudgetOf({ budget: 500, items: [] }), 0);
});

/* A wallet that received more than it paid out has a NEGATIVE net commitment.
   Without the Math.max clamp the floor would come back below zero, which the
   budget field would then accept as a valid negative budget. */
test("a wallet whose inflows exceed outflows has a zero floor, not negative", () => {
  const wd = { budget: 100, items: [{ name: "in", amount: 400, type: "in", fromId: "x" }] };
  assert.equal(M.minBudgetOf(wd), 0, "floor must never go below zero");
});

/* ---------------------------------------------------------------------------
   OVERSPENDING - going past the balance is allowed, but must stay honest
--------------------------------------------------------------------------- */

/* "Record it anyway". Remaining goes negative and the invariant still holds -
   overspending is a real state to represent, not an error to reject. The
   chart relies on this: it shows an "Overspent" legend line rather than
   clamping remaining to zero, which used to draw a donut larger than income. */
test("overspending keeps the books balanced, it just goes negative", () => {
  // "Record it anyway": remaining may go below zero, but nothing is invented
  const d = {
    income: 1056.17, priority: [], walletData: {},
    secondChoice: [{ name: "big", category: "Others", amount: 2000, type: "take" }]
  };
  assert.equal(M.mainRemainingOf(d, []), 1056.17 - 2000);
  assert.ok(M.mainRemainingOf(d, []) < 0, "this is the overspent state");
  assertReconciles("overspent", d, []);
});

/* Which wallets the overspend prompt may offer. Only full covers qualify, so
   picking one always lands remaining at exactly zero rather than a smaller
   overspend that would need a second prompt. Closed wallets are excluded
   because their money has already been returned to main.

   Three cases in one test: exactly one wallet covering, several sorted
   richest-first, and nothing covering at all. */
test("only wallets that fully cover a shortfall are offered, richest first", () => {
  const wallets = [
    { id: "a", name: "Small" },
    { id: "b", name: "Big" },
    { id: "c", name: "Empty" },
    { id: "d", name: "Closed", deleted: true }
  ];
  const d = {
    income: 1000, priority: [], secondChoice: [],
    walletData: {
      a: { budget: 100, items: [] },
      b: { budget: 800, items: [] },
      c: { budget: 0, items: [] },
      d: { budget: 900, items: [] }
    }
  };
  const covering = M.walletsCovering(d, wallets, 500);
  assert.deepEqual(covering.map(x => x.wallet.name), ["Big"], "only Big covers 500; closed wallets excluded");

  const many = M.walletsCovering(d, wallets, 50);
  assert.deepEqual(many.map(x => x.wallet.name), ["Big", "Small"], "richest first");

  assert.deepEqual(M.walletsCovering(d, wallets, 5000), [], "nothing covers an impossible shortfall");
});

/* The boundary. A wallet holding precisely the shortfall must be offered -
   hence the 1e-9 epsilon in walletsCovering, since float dust could otherwise
   put an exact balance a fraction under the threshold and hide the only
   wallet that could help. */
test("a wallet covering exactly the shortfall qualifies", () => {
  const wallets = [{ id: "a", name: "Exact" }];
  const d = { income: 1000, priority: [], secondChoice: [], walletData: { a: { budget: 250, items: [] } } };
  assert.equal(M.walletsCovering(d, wallets, 250).length, 1, "equal balance must qualify");
});

/* End to end: the state the app writes after the user picks "cover from a
   wallet". A real tagged transfer, both halves sharing a txId, and remaining
   settling at zero rather than merely closer to it.

   Built from real reported figures, which is why they are not round - round
   numbers hide exactly the float problems this needs to catch. */
test("covering a shortfall by transfer lands remaining at zero", () => {
  // Income funds a 1200 wallet and leaves 1056.17 in main, matching the
  // reported case. Spending 2000 is 943.83 short; cover it from the wallet.
  const wallets = [{ id: "a", name: "Pot" }];
  const shortfall = 2000 - 1056.17;
  const d = {
    income: 2256.17, priority: [],
    walletData: { a: { budget: 1200, items: [
      { name: "cover", amount: shortfall, type: "out", toId: "main", txId: "t1" }
    ] } },
    secondChoice: [
      { name: "cover", category: "Transfer", amount: shortfall, type: "add", transfer: true, txId: "t1" },
      { name: "big", category: "Others", amount: 2000, type: "take" }
    ]
  };
  assert.ok(Math.abs(M.mainRemainingOf(d, wallets)) < 1e-9, "remaining should be ~0, got " + M.mainRemainingOf(d, wallets));
  assert.equal(M.totalIncomeOf(d, wallets), 2256.17, "the covering transfer is not income");
  assertReconciles("covered shortfall", d, wallets);
});

/* ---------------------------------------------------------------------------
   CARRY-OVER - money brought forward from the previous month

   The rule that makes these work: carried money is available to spend, so it
   must appear on BOTH sides of the invariant - in totalIncome and in
   mainRemaining. Put it in only one and the books break immediately.

   Wallet balances are carried as each wallet's opening BUDGET, not as extra
   main balance, because mainRemainingOf already subtracts budgets. The
   carryOver figure covers the whole amount, main and wallets together.
--------------------------------------------------------------------------- */

/* The reported case: a month closed with money left, the next opened empty.
   Income is still null here - it is the 1st and nothing has been earned yet -
   which is exactly why monthIsUnset has to treat carry-over as making a month
   real, or the whole month reads as zero. */
test("carry-over alone makes a month real and lands in main", () => {
  const d = {
    income: null, carryOver: 882,
    priority: [], secondChoice: [], walletData: {}
  };
  assert.equal(M.monthIsUnset(d), false, "money in hand is not an empty month");
  assert.equal(M.totalIncomeOf(d, []), 882);
  assert.equal(M.mainRemainingOf(d, []), 882, "the money is spendable");
  assertReconciles("carry-over only", d, []);
});

/* A genuinely empty month must still report null, not zero-with-carry-over. */
/* REGRESSION: the secret reset left the money behind.

   resetData() in app.js clears the month field by field, and when carryOver
   was added it was not added to that list. The month emptied but
   mainRemaining stayed at 0 + carryOver, so the balance reappeared and the
   reset looked like it had done nothing at all.

   This pins the SHAPE resetData has to produce. It cannot call resetData
   directly - that lives in app.js and touches the DOM - so the guard is the
   arithmetic: a month still carrying a balance is NOT empty, and only becomes
   empty once carryOver is cleared as well. Any field added to a month in
   future must be cleared in resetData or this contract breaks again. */
test("REGRESSION: a reset month must clear carry-over too, or the money returns", () => {
  const everyOtherFieldCleared = {
    month: "2026-8", income: null, carryOver: 882,
    priority: [], priorityLocked: false, walletData: {}, secondChoice: []
  };
  assert.equal(M.mainRemainingOf(everyOtherFieldCleared, []), 882,
    "clearing every field EXCEPT carryOver leaves the balance behind - the bug");

  const properlyReset = { ...everyOtherFieldCleared, carryOver: 0 };
  assert.equal(M.monthIsUnset(properlyReset, []), true, "a properly reset month is unset");
  assert.equal(M.mainRemainingOf(properlyReset, []), 0, "and holds nothing");
  assert.equal(M.totalIncomeOf(properlyReset, []), null);
  assert.ok(M.reconciles(properlyReset, []));
});

test("no income and no carry-over is still an unset month", () => {
  const d = { income: null, carryOver: 0, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.monthIsUnset(d), true);
  assert.equal(M.totalIncomeOf(d, []), null);
  assert.ok(M.reconciles(d, []));
});

/* Carry-over stacks on top of income earned this month. */
test("carry-over adds to income rather than replacing it", () => {
  const d = {
    income: 3000, carryOver: 882,
    priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true }],
    secondChoice: [], walletData: {}
  };
  assert.equal(M.totalIncomeOf(d, []), 3882);
  assert.equal(M.mainRemainingOf(d, []), 2982);
  assertReconciles("carry-over plus income", d, []);
});

/* Wallet money brought forward. The wallet opens with a budget equal to what
   it closed holding, and carryOver covers main AND that budget - so the money
   is counted once, not twice. This is the arrangement most likely to be got
   wrong by a later change, which is why it asserts every figure. */
test("wallet balances carried as opening budgets do not double count", () => {
  const wallets = W("Grocery");
  const d = {
    income: null, carryOver: 1082,          // 882 main + 200 wallet
    priority: [], secondChoice: [],
    walletData: { w0: { budget: 200, items: [] } }
  };
  assert.equal(M.totalIncomeOf(d, wallets), 1082);
  assert.equal(M.mainRemainingOf(d, wallets), 882, "the wallet's 200 is not also in main");
  assert.equal(M.spendingBreakdownOf(d, wallets).inWallets, 200);
  assert.equal(M.spendingBreakdownOf(d, wallets).spent, 0, "carrying money is not spending");
  assertReconciles("wallet carry-over", d, wallets);
});

/* Spending carried money behaves like spending any other money. */
test("spending from a carried balance keeps the books straight", () => {
  const wallets = W("Grocery");
  const d = {
    income: 3000, carryOver: 1082,
    priority: [],
    secondChoice: [{ name: "LRT", category: "Transport", amount: 45, type: "take" }],
    walletData: { w0: { budget: 200, items: [{ name: "food", amount: 50, type: "take" }] } }
  };
  const b = M.spendingBreakdownOf(d, wallets);
  assert.equal(b.spent, 95, "45 from main plus 50 from the carried wallet");
  assert.equal(b.inWallets, 150);
  assertReconciles("spending carried money", d, wallets);
});

/* Months saved before carry-over existed have no such field at all. They must
   read exactly as they always did - this is what stops the change rewriting
   everyone's history. */
test("a month with no carryOver field behaves as it always did", () => {
  const d = { income: 1000, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.carryOverOf(d), 0);
  assert.equal(M.totalIncomeOf(d, []), 1000);
  assertReconciles("legacy month", d, []);
});

/* Junk in the field must not poison a month's totals. */
test("a malformed carryOver is treated as none", () => {
  [null, undefined, NaN, Infinity, -50, "abc", ""].forEach(bad => {
    assert.equal(M.carryOverOf({ carryOver: bad }), 0, `${String(bad)} should read as 0`);
  });
  assert.equal(M.carryOverOf({ carryOver: "250" }), 250, "numeric strings are accepted");
});

/* What the rollover hands to the next month: main plus every wallet. */
test("closing balance totals main and wallets together", () => {
  const wallets = W("Grocery", "Fuel");
  const d = {
    income: 3000, priority: [{ name: "Rent", category: "Bills", amount: 900, paid: true }],
    secondChoice: [],
    walletData: { w0: { budget: 500, items: [{ name: "food", amount: 120, type: "take" }] },
                  w1: { budget: 200, items: [] } }
  };
  const c = M.closingBalanceOf(d, wallets);
  assert.equal(c.main, 1400, "3000 - 900 bill - 500 - 200 budgeted");
  assert.equal(c.wallets.w0, 380);
  assert.equal(c.wallets.w1, 200);
  assert.equal(c.total, 1980);
});

/* An overspent month carries nothing rather than starting the next in debt.
   Debt would be a second way to go negative, hidden inside a figure the user
   never entered. */
test("an overspent month carries nothing forward", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "big", category: "Others", amount: 2000, type: "take" }]
  };
  assert.ok(M.mainRemainingOf(d, []) < 0, "this month is overspent");
  assert.equal(M.closingBalanceOf(d, []).total, 0, "nothing to carry, and no debt either");
});

/* End to end: close a month, open the next from it, and confirm the money
   that survived is exactly what was left. */
test("a carried month opens holding what the last one closed with", () => {
  const wallets = W("Grocery");
  const july = {
    income: 2056, priority: [{ name: "Rent", category: "Bills", amount: 960, paid: true }],
    secondChoice: [], walletData: { w0: { budget: 200, items: [] } }
  };
  const closing = M.closingBalanceOf(july, wallets);
  assert.equal(closing.main, 896);
  assert.equal(closing.total, 1096);

  const august = {
    income: null, carryOver: closing.total,
    priority: [], secondChoice: [],
    walletData: { w0: { budget: closing.wallets.w0, items: [] } }
  };
  assert.equal(M.mainRemainingOf(august, wallets), 896, "main reopens with what it had");
  assert.equal(M.spendingBreakdownOf(august, wallets).inWallets, 200, "so does the wallet");
  assertReconciles("rolled month", august, wallets);
});

/* A wallet defined in settings but with no slot in this month's walletData -
   the normal state for a wallet created but not yet used, and for every
   wallet at the start of a fresh month. Every function must treat the missing
   slot as empty rather than throwing on undefined. */
test("a wallet missing from walletData is ignored, not crashed on", () => {
  const wallets = W("Grocery", "Ghost");
  const d = {
    income: 200, priority: [], secondChoice: [],
    walletData: { w0: { budget: 50, items: [] } }
  };
  assert.equal(M.mainRemainingOf(d, wallets), 150);
  assertReconciles("missing wallet data", d, wallets);
});
