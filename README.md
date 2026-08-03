# MoNy — Monthly Money Tracker

A simple, private, offline-first money tracker for one month at a time.
No account, no sign-up, no server, no ads. Everything you enter stays on
your own phone.

**Open it here: https://rafialaydrus.github.io/MoNy/**

---

## Table of contents

1. [What this app does](#what-this-app-does)
2. [How to use it on your phone — no install needed](#how-to-use-it-on-your-phone--no-install-needed)
3. [The four places your money lives](#the-four-places-your-money-lives)
4. [Full feature list](#full-feature-list)
5. [Getting started — first month](#getting-started--first-month)
6. [Priority bills](#priority-bills)
7. [Wallets](#wallets)
8. [Second choice (everyday spending)](#second-choice-everyday-spending)
9. [Editing and deleting entries](#editing-and-deleting-entries)
10. [Overspending](#overspending)
11. [The chart](#the-chart)
12. [Budget cycles](#budget-cycles-not-everyone-gets-paid-on-the-1st)
13. [Carrying money into a new month](#carrying-money-into-a-new-month)
14. [Month history](#month-history)
15. [Settings](#settings)
16. [Backing up and moving your data](#backing-up-and-moving-your-data)
17. [Privacy](#privacy)
18. [FAQ](#faq)

---

## What this app does

MoNy tracks one calendar month of money at a time. You:

- Set your income for the month
- List the bills you have to pay ("Priority")
- Optionally split money into named **wallets** for things like groceries or
  fuel
- Log everyday spending and small extra income ("Second choice")

When a new month starts, the finished month is automatically filed away in
**History** and a fresh, empty month begins — you don't have to do anything
to "close" a month.

There's a live donut chart showing where your money went, a **Remaining**
figure that updates instantly as you spend, and a history view with trends
across every month you've tracked.

---

## How to use it on your phone — no install needed

You do **not** need to install anything, create an account, or download
anything from an app store. MoNy is just a webpage that happens to work like
an app.

1. Open your phone's browser (Safari on iPhone, Chrome on Android).
2. Go to **https://rafialaydrus.github.io/MoNy/**
3. Start using it right away.

That's it. Everything you type is saved automatically to that browser, on
that phone, and will still be there the next time you open the page — even
if you close the tab, lock your phone, or turn it off. It works offline
after the first visit, too, so you can log an expense with no signal.

**A few things to know when using it straight from the browser (not
installed):**

- **Use the same browser every time.** Your data lives inside that one
  browser app (e.g. Safari). If you open the link in a different browser
  (say, Chrome instead of Safari) it will look empty — it's a separate,
  fresh copy, not a different view of the same data.
- **Don't use Private/Incognito mode.** Private browsing usually wipes
  storage when you close the tab, which means your entries would disappear.
- **Don't clear your browser's site data/cookies for this page.** That
  deletes everything you've entered. (Clearing *history* alone is fine —
  it's *site data/storage* that matters.)
- **Bookmark the page** so you can get back to it quickly without retyping
  the address. On iPhone: tap the Share icon → "Add Bookmark". On Android:
  tap the ⋮ menu → "Add bookmark" or "Add to bookmarks".
- If you'd rather have it feel like a real app (its own icon, full-screen, no
  browser bar) later, your browser's "Add to Home Screen" option does that —
  but it is entirely optional. Everything above works fine without it.
- **Back up your data occasionally** (see [Backing up and moving your
  data](#backing-up-and-moving-your-data)) — since everything lives only on
  this one phone in this one browser, a lost phone means lost data unless
  you've exported a backup.

---

## The four places your money lives

| Place | Meaning |
|---|---|
| **Total Income** | What you earned this month — what you type in, plus any genuine extra income you log |
| **Priority** | Fixed bills for the month, ticked off as you pay them |
| **Wallets** | Named sub-budgets carved out of your balance (e.g. Grocery, Fuel), each with its own balance and history |
| **Second choice** | Everyday money in and out, with a category |

**Remaining** is what's left in your main balance after the bills you've
paid, the money you've handed to wallets, and your Second choice spending.

---

## Full feature list

- Set and edit your monthly income at any time
- **Budget cycles** — choose the day your month starts (e.g. the 25th, if
  that's payday), not just the 1st
- **Carry your leftover balance forward** into the new month automatically,
  both your main balance and every wallet
- **Projected balance** — see what you'll have left once every unpaid bill
  is paid
- **Tap any entry to edit it** — bills, wallet transactions, Second choice
  entries
- Add priority bills with a category, tick them off as paid, swipe to
  delete, and lock the list once it's set for the month
- **"Copy Last Priority"** — reuse last month's bill list instead of
  retyping it
- Unlimited named wallets — add, rename, close, set a budget, add money to
  one, take money out, or transfer between them
- Wallet-to-wallet and wallet-to-main transfers, always linked so both sides
  stay in sync
- Second choice entries with a category and an optional back-date, for
  logging something from a day or two ago
- Asks whether money you're adding is **new income** or **money coming back
  to you** (a repayment), so your income figure stays accurate
- Warns you before an action would put you over budget, and offers ways to
  handle it
- Swipe to delete on every list, with a 3-second undo
- Clean monochrome design with a colourful donut chart and a monthly trend
  chart
- **Month history** — every past month archived automatically, with a full
  breakdown, trends, and storage usage
- **Export and import** your entire dataset as a single JSON file
- Optional budget-limit warning and an overspent warning
- Works fully offline once loaded
- Pull down to refresh, keyboard-aware pop-ups, respects reduced-motion
  settings

---

## Getting started — first month

1. Open the app.
2. Tap the **Total Income** field and enter what you earned this month, then
   confirm.
3. Add your bills under **Priority** — name, category, amount — then tap
   **+ Add**.
4. Optionally set up a **wallet** (see below) for something like groceries.
5. Log day-to-day spending under **Second choice** as it happens.

Your **Remaining** figure and the donut chart update instantly with every
change.

---

## Priority bills

This is your fixed, must-pay list for the month — rent, subscriptions,
loan payments, whatever recurs.

- Add a bill with a **name**, **category**, and **amount**.
- Tick the checkbox once you've actually paid it — this is what deducts it
  from your Remaining balance. Adding a bill doesn't deduct anything by
  itself; ticking it does.
- **Swipe left** on a bill to delete it (with 3 seconds to undo).
- **Tap** a bill to edit its details.
- **Lock the list** once your bills are finalized for the month, to stop
  yourself from editing it by accident. This is one-way for the month — the
  only way to unlock it early is the hidden reset (see [FAQ](#faq)).
- **"Copy Last Priority"** appears when your list is empty and unlocked — it
  pulls in last month's bills so you don't have to retype recurring ones.

If ticking a bill would put you over budget, MoNy will ask you how you'd
like to handle it — see [Overspending](#overspending).

---

## Wallets

Wallets are named sub-budgets you carve out of your main balance — for
example "Grocery" or "Fuel" — each with its own running balance and its own
transaction history.

- **Add a wallet** from Settings, giving it a name.
- **Set a budget** for a wallet — this moves that much money out of your
  main balance and into the wallet. It's not spending yet, it's just set
  aside.
- **Add** money to a wallet (moves more from main into it) or **Take** money
  out (this *is* counted as spending).
- **Transfer** money from one wallet to another, or from a wallet back to
  your main balance — both sides of a transfer are always linked, so
  deleting one half removes the other automatically.
- **Rename** a wallet any time — old transfer labels update to match.
- **Close a wallet** when you're done with it. Any leftover balance is
  automatically transferred back to your main balance first, so nothing is
  lost, and its spending history stays on the books.
- Tap any wallet entry to edit it; swipe to delete it.

Money you *budget into* a wallet isn't spending — you've only moved it. It
only counts as spent once you actually **take** it out.

---

## Second choice (everyday spending)

This is your free-form log for day-to-day money in and out that doesn't fit
Priority or a wallet — a coffee, a taxi ride, a bit of freelance income, a
friend paying you back.

- **Take**: money that left your pocket — give it a name, category, and
  amount.
- **Add**: money that came in. MoNy will ask whether this is:
  - **New income** — genuinely new money, which raises your Total Income, or
  - **Money coming back to you** — a reimbursement, which doesn't count as
    new income but does put the cash back in your Remaining balance and
    cancels out the original spending it repaid.
- Every entry supports an **optional back-date**, for logging something you
  forgot to enter on the actual day.
- Tap an entry to edit it; swipe to delete it.

---

## Editing and deleting entries

- **Tap** any bill, wallet transaction, or Second choice row to load it back
  into the form and edit it. Saving overwrites that entry in place.
- **Swipe left** on any row to delete it — you get a 3-second **undo** toast
  before the deletion is final.
- A few things can't be edited or deleted individually because there's no
  single transaction behind them:
  - **Transfers** — since a transfer is really two linked halves, editing
    one side alone would create or destroy money. Delete it (which removes
    both halves) and re-enter it instead.
  - **"Brought forward" rows** — these just display money carried over from
    last month; they aren't real entries.

---

## Overspending

If an action would push your Remaining balance below zero — ticking a bill,
taking money in Second choice, or adding money to a wallet — MoNy stops and
offers you a choice:

1. **Cover it from a wallet** that has enough to fully cover the shortfall
   (a real transfer from that wallet back to main)
2. **Record it anyway** — your Remaining goes negative, and the app clearly
   marks the month as overspent rather than hiding it
3. **Cancel**

---

## The chart

A hand-drawn donut chart (no images, no library) shows:

- One slice per spending category, biggest first
- An "In wallets" slice for money set aside but not yet spent
- A "Remaining" slice for what's left
- An "Overspent" line instead of a slice if you've gone over, since going
  over your income isn't a share of it

Tap the chart icon to show or hide it. There's also a monthly **trend chart**
in History, comparing spending across your last several months.

---

## Budget cycles (not everyone gets paid on the 1st)

By default your month runs the 1st to the end of the month, like a
calendar. If you get paid on a different day — say the 25th — you can set
your month to start on the 25th instead, in Settings. Your "month" then runs
25th to 24th.

Changing this only affects the *next* cycle onward — it won't cut your
current month short.

---

## Carrying money into a new month

By default, whatever you have left at the end of a month — your main
balance plus every wallet's balance — carries forward into the new month
automatically, so you don't start every month back at zero. You can turn
this off in Settings if you'd rather each month start fresh.

If a month ends overspent, nothing carries forward into debt — the new
month simply starts at zero.

Each history entry shows a "Brought forward" line so you can always see
where a month's opening balance came from.

---

## Month history

Every finished month is filed away automatically — you never need to
manually "close" a month. In **History** you get:

- A full breakdown per month: income, spending by category, money in
  wallets, remaining balance
- A trend chart across your recent months
- Average / lowest / highest spending stats
- How much storage each month is using
- The ability to delete any past month (with undo)

---

## Settings

- **Currency** — choose from RM, $, S$, €, £, ¥, ₩, Rp
- **Chart** — show or hide the donut chart
- **Sort order** — oldest or newest first in your transaction lists
- **Budget limit** — get warned when your Remaining balance drops below a
  figure you choose
- **Carry balance forward** — on by default; turn off to start every month
  at zero
- **Month start day** — pick any day 1–31 for when your budgeting month
  begins
- **Wallets** — add, rename, or close wallets from here

---

## Backing up and moving your data

Since your data lives only in this one browser on this one phone, it's
worth backing it up now and then, and definitely before you get a new phone.

- **Export**: Settings → Export. This downloads a single JSON file with
  everything — your current month, all history, and your settings.
- **Import**: Settings → Import, then choose a previously exported file.
  Importing **replaces everything currently in the app** with what's in the
  file, so only import a file you trust and mean to restore.
- To move to a new phone or a different browser, export from the old one and
  import into the new one.

---

## Privacy

- No account, no sign-up, no login.
- No server — nothing you type is ever sent anywhere. All your financial
  data stays in your browser's local storage, on your device, until you
  choose to export it yourself.
- No analytics, no tracking, no ads.
- The only way your data leaves your phone is if *you* export it and share
  that file yourself.

---

## FAQ

**Do I need to install anything?**
No. Just open the link in your phone's browser and start using it. See
[How to use it on your phone](#how-to-use-it-on-your-phone--no-install-needed).

**Will I lose my data if I close the tab or turn off my phone?**
No — it's saved automatically as you go. It will still be there next time
you open the same link in the same browser.

**Can I use it on more than one phone?**
Each browser/device keeps its own separate copy. Use Export/Import to move
data between them; there's no automatic syncing.

**What happens if I clear my browser's data or storage?**
Your entries for this app will be permanently deleted, unless you exported a
backup first.

**I locked my Priority list by mistake / want to start the month over.**
Double-tapping the header opens a hidden reset that clears the current
month's data (after backing up your bill list for reuse). Past months in
History are unaffected.

**Is there a way to undo a delete?**
Yes — every swipe-to-delete shows a 3-second undo toast. Only the most
recent deletion can be undone.
