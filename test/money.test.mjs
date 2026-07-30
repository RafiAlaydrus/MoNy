/* Run with:  node --test test/
 *
 * These exercise money.js directly - the same file the browser loads - so a
 * formula change that breaks the books fails here instead of on a phone.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const M = require("../money.js");

const W = (...names) => names.map((name, i) => ({ id: `w${i}`, name }));

// Every scenario must satisfy: spent + inWallets + mainRemaining === totalIncome
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

test("empty month reconciles and reports no income", () => {
  const d = { income: null, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.totalIncomeOf(d, []), null);
  assert.equal(M.mainRemainingOf(d, []), 0);
  assert.ok(M.reconciles(d, []));
});

test("income only", () => {
  const d = { income: 1000, priority: [], secondChoice: [], walletData: {} };
  assert.equal(M.totalIncomeOf(d, []), 1000);
  assert.equal(M.mainRemainingOf(d, []), 1000);
  assertReconciles("income only", d, []);
});

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

test("real Second choice income raises total income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Freelance", category: "Others", amount: 100, type: "add" }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100);
  assert.equal(M.mainRemainingOf(d, []), 1100);
  assertReconciles("extra income", d, []);
});

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

test("new money is still counted as income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Gig", category: "Others", amount: 100, type: "add", newMoney: true }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100);
  assertReconciles("explicit new money", d, []);
});

test("adds saved before the question existed still count as income", () => {
  const d = {
    income: 1000, priority: [], walletData: {},
    secondChoice: [{ name: "Old row", category: "Others", amount: 100, type: "add" }]
  };
  assert.equal(M.totalIncomeOf(d, []), 1100, "no flag means legacy income, unchanged");
  assertReconciles("legacy add", d, []);
});

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

test("fractional amounts do not drift", () => {
  const wallets = W("Grocery");
  const d = {
    income: 100.03, priority: [],
    secondChoice: [{ name: "x", category: "Others", amount: 33.34, type: "take" }],
    walletData: { w0: { budget: 33.33, items: [{ name: "y", amount: 11.11, type: "take" }] } }
  };
  assertReconciles("fractions", d, wallets);
});

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

test("a wallet missing from walletData is ignored, not crashed on", () => {
  const wallets = W("Grocery", "Ghost");
  const d = {
    income: 200, priority: [], secondChoice: [],
    walletData: { w0: { budget: 50, items: [] } }
  };
  assert.equal(M.mainRemainingOf(d, wallets), 150);
  assertReconciles("missing wallet data", d, wallets);
});
