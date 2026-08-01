/* =========================
   STORAGE & MONTH SETUP
========================= */

const STORAGE_KEY = "monthly-money-tracker";
const SETTINGS_KEY = "monthly-money-tracker-settings";
const BACKUP_PRIORITY_KEY = "monthly-money-tracker-priority-backup";
const ARCHIVE_KEY = "monthly-money-tracker-archive";

/* Persistence. Declared before anything writes, because the migrations below
   already save. A quota failure is surfaced once instead of losing data
   silently. */
let storageWarned = false;

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (!storageWarned) {
      storageWarned = true;
      alert(
        "Couldn't save - storage for this app is full.\n\n" +
        "Export your data from Settings, then delete old months from History " +
        "to free space. Changes since this message are not saved."
      );
    }
    console.error("localStorage write failed", err);
    return false;
  }
}

/* One wrapper per stored key. Every write in the app goes through these three
   rather than touching localStorage directly, so a full-storage failure is
   caught in one place instead of silently dropping data at 36 call sites. */
function saveData() { return save(STORAGE_KEY, data); }
function saveSettings() { return save(SETTINGS_KEY, settings); }
function saveArchive() { return save(ARCHIVE_KEY, archive); }

const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
  showChart: false,
  currency: "RM",
  sortOrder: "newest",
  budgetLimit: null,
  wallets: []
};
// Default missing settings
if (!settings.currency) settings.currency = "RM";
if (!settings.sortOrder) settings.sortOrder = "oldest";
if (settings.budgetLimit === undefined) settings.budgetLimit = null;
if (!settings.collapsed) settings.collapsed = {};
/* Carry the closing balance into the next month. Defaults ON, including for
   existing installs, because the alternative is money silently disappearing
   on the 1st - which is what it did before this existed. Set to false for a
   clean slate each month. */
if (settings.carryOver === undefined) settings.carryOver = true;
// Backdating made date order meaningful, so switch existing installs to
// oldest-first once. The Sort transactions setting still overrides it.
if (!settings.dateOrderMigrated) {
  settings.sortOrder = "oldest";
  settings.dateOrderMigrated = true;
  saveSettings();
}
// The archive replaced the old keep-data option
if ("keepData" in settings) {
  delete settings.keepData;
  saveSettings();
}

let archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY)) || {};

function genWalletId() {
  return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* A new month. `carry` is the closing balance of the month just ended, from
   closingBalanceOf() - main plus every wallet.

   Wallet money is restored as each wallet's opening BUDGET, not as extra main
   balance, because mainRemainingOf already subtracts budgets. carryOver holds
   the whole figure, main and wallets together, so the money is counted exactly
   once. Get this pairing wrong in either direction and the month either
   invents money or loses it. */
function freshMonthData(carry) {
  const walletData = {};
  if (carry && carry.wallets) {
    Object.keys(carry.wallets).forEach(id => {
      walletData[id] = { budget: carry.wallets[id], items: [] };
    });
  }
  return {
    month: currentMonthKey,
    income: null,
    carryOver: carry ? carry.total : 0,
    priority: [],
    priorityLocked: false,
    walletData,
    secondChoice: []
  };
}

// Number of wallet transactions in a month (new or legacy shape)
function walletItemsCount(d) {
  if (d.walletData) {
    return Object.values(d.walletData).reduce((n, wd) => n + (wd.items || []).length, 0);
  }
  return (d.groceryItems || []).length;
}

// Returns true if a month holds anything worth archiving
function monthHasContent(d) {
  const hasBudgets = d.walletData
    ? Object.values(d.walletData).some(wd => Number(wd.budget) > 0)
    : Number(d.groceryBudget) > 0;
  /* Carry-over counts as content. A month where you spent nothing but were
     holding money brought forward is still a real month, and skipping it here
     would leave a hole in the history for a month that genuinely happened. */
  return d.income !== null ||
    carryOverOf(d) > 0 ||
    (d.priority || []).length > 0 ||
    walletItemsCount(d) > 0 ||
    hasBudgets ||
    (d.secondChoice || []).length > 0;
}

let data = JSON.parse(localStorage.getItem(STORAGE_KEY));

// Migrate the old single Second Wallet into the wallets list
if (!settings.wallets) {
  settings.wallets = [];
  const hadWalletData = data &&
    (Number(data.groceryBudget) > 0 || (data.groceryItems || []).length > 0);
  if (settings.secondWalletEnabled !== false || hadWalletData) {
    settings.wallets.push({ id: genWalletId(), name: settings.secondWalletName || "Second Wallet" });
  }
  delete settings.secondWalletEnabled;
  delete settings.secondWalletName;
  saveSettings();
}

if (data && !data.walletData) {
  data.walletData = {};
  const first = settings.wallets[0];
  if (first && (Number(data.groceryBudget) > 0 || (data.groceryItems || []).length > 0)) {
    data.walletData[first.id] = {
      budget: data.groceryBudget !== undefined ? data.groceryBudget : null,
      items: data.groceryItems || []
    };
  }
  delete data.groceryBudget;
  delete data.groceryItems;
  saveData();
}

if (!data) {
  data = freshMonthData();
} else if (data.month !== currentMonthKey) {
  if (monthHasContent(data)) {
    archive[data.month] = {
      data,
      wallets: settings.wallets.map(w => ({ id: w.id, name: w.name })),
      currency: settings.currency,
      closedAt: new Date().toISOString()
    };
    saveArchive();
  }
  if ((data.priority || []).length > 0) {
    localStorage.setItem(BACKUP_PRIORITY_KEY, JSON.stringify(data.priority));
  }
  /* What the closing month leaves behind, measured BEFORE closed wallets are
     purged below - a wallet closed during the month has already returned its
     balance to main, but reading after the purge would risk missing anything
     that had not. */
  const carry = settings.carryOver === false
    ? null
    : closingBalanceOf(data, settings.wallets || []);

  // Closed wallets only needed to survive the month they were closed in;
  // their figures are in the archive now.
  if (settings.wallets.some(w => w.deleted)) {
    settings.wallets = settings.wallets.filter(w => !w.deleted);
    saveSettings();
  }

  /* Only carry balances for wallets that still exist. A wallet closed in the
     old month must not reappear holding money in the new one. */
  if (carry) {
    const live = new Set(settings.wallets.map(w => w.id));
    Object.keys(carry.wallets).forEach(id => {
      if (!live.has(id)) delete carry.wallets[id];
    });
    carry.total = carry.main + Object.values(carry.wallets).reduce((a, b) => a + b, 0);
  }

  data = freshMonthData(carry);
  saveData();
}

/* MIGRATION: back-fill carry-over for a month that already rolled over.

   Carry-over shipped after some months had already started, so the month on
   screen can be missing the balance the previous one left behind. This runs
   once for such a month and reads the figure straight out of the archive.

   Three guards make it safe to run on every load:

   - `carryOver` being ABSENT is what marks a month as not yet back-filled.
     It is written as a number afterwards, even when that number is 0, so this
     never applies twice and never keeps re-adding money.
   - Only the immediately preceding month counts. Reopening the app after
     skipping a month must not resurrect a balance from further back.
   - A wallet is only re-opened if it is untouched this month (no budget, no
     items). Anything already entered wins, and only the wallets actually
     seeded are counted into the total - so a budget set by hand is never
     overwritten and never double counted. */
if (data && data.carryOver === undefined) {
  let restored = null;

  if (settings.carryOver !== false) {
    const [y, m] = currentMonthKey.split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${m - 1}`;
    const prev = archive[prevKey];

    if (prev) {
      const prevEntry = normalizeArchiveEntry(prev);
      const closing = closingBalanceOf(prevEntry.data, prevEntry.wallets || []);
      const live = new Set((settings.wallets || []).map(w => w.id));
      const seeded = {};

      Object.keys(closing.wallets).forEach(id => {
        if (!live.has(id)) return;
        const wd = data.walletData && data.walletData[id];
        const untouched = !wd || (!wd.budget && (wd.items || []).length === 0);
        if (untouched) seeded[id] = closing.wallets[id];
      });

      const walletTotal = Object.values(seeded).reduce((a, b) => a + b, 0);
      if (closing.main > 0 || walletTotal > 0) {
        restored = { main: closing.main, wallets: seeded, total: closing.main + walletTotal };
      }
    }
  }

  if (restored) {
    data.walletData = data.walletData || {};
    Object.keys(restored.wallets).forEach(id => {
      data.walletData[id] = data.walletData[id] || { budget: null, items: [] };
      data.walletData[id].budget = restored.wallets[id];
    });
    data.carryOver = restored.total;
  } else {
    // Nothing to restore, but stamp the field so this never runs again.
    data.carryOver = 0;
  }
  saveData();
}

/* =========================
   DOM REFERENCES (SAFE)
========================= */

const monthText = document.getElementById("current-month");

const incomeCard = document.getElementById("income-card");
const incomeDisplay = document.getElementById("total-income-display");
const incomeInput = document.getElementById("total-income-input");
const remainingMoneyEl = document.getElementById("remaining-money");

const priorityList = document.getElementById("priority-list");
const addPriorityBtn = document.getElementById("add-priority");
const savePriorityBtn = document.getElementById("save-priority");

const priorityModal = document.getElementById("priority-modal");
const confirmPriorityBtn = document.getElementById("confirm-priority");
const cancelPriorityBtn = document.getElementById("cancel-priority");

const walletsContainer = document.getElementById("wallets-container");

const scName = document.getElementById("sc-name");
const scCategory = document.getElementById("sc-category");
const scAmount = document.getElementById("sc-amount");
const scDate = document.getElementById("sc-date");
const addMoneyBtn = document.getElementById("add-money");
const takeMoneyBtn = document.getElementById("take-money");
const scTable = document.getElementById("sc-table");

const chartCanvas = document.getElementById("summary-chart");
const chartCtx = chartCanvas ? chartCanvas.getContext("2d") : null;
const chartLegend = document.getElementById("chart-legend");

// Only the chart and its legend use color - the rest of the app stays monochrome
const CATEGORY_COLORS = {
  "Bills": "#e74c3c",
  "Subscription": "#e67e22",
  "Food / Drink": "#9b59b6",
  "Transport": "#16a085",
  "Others": "#8a8a8a",
};

const CHART_IN_WALLETS_COLOR = "#f1c40f";
const CHART_REMAINING_COLOR = "#3498db";
const CHART_OVERSPENT_COLOR = "#c0392b";

/* Wallet slice colours. The UI is otherwise greyscale; the chart is the one
   place colour is allowed, because same-shade slices are indistinguishable.
   The ramp cycles, so a sixth wallet reuses the first colour - acceptable
   since the legend is labelled and nobody runs six wallets. */
const WALLET_COLOR_RAMP = ["#2ecc71", "#e84393", "#00b8d9", "#a29bfe", "#fdcb6e"];
function walletColor(index) { return WALLET_COLOR_RAMP[index % WALLET_COLOR_RAMP.length]; }

// Returns the current currency symbol
function cur() { return settings.currency; }

// Formats a number with 2 decimals
function fmt(n) { return Number(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Rounds to a whole number, for compact summaries where cents would be noise
function fmtWhole(n) { return Math.round(Number(n)).toLocaleString("en"); }

// Escapes text before it goes into innerHTML. Names are free text, so an
// unescaped quote or angle bracket would otherwise corrupt the markup.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Every wallet, including closed ones. Closed wallets stay in the money math
// so the spending they already recorded is not silently un-spent.
function allWallets() { return settings.wallets; }

// Wallets the user should still see and be able to use.
function activeWallets() { return settings.wallets.filter(w => !w.deleted); }

// Turns an optional YYYY-MM-DD picker value into a stored timestamp. Empty
// means now; a picked day keeps the current time of day so several entries
// backdated to the same day still order by when they were added. The date is
// built in local time so it renders as the day the user actually picked.
function resolveDate(value) {
  const now = new Date();
  if (!value) return now.toISOString();

  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return now.toISOString();

  return new Date(
    y, m - 1, d,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()
  ).toISOString();
}

// Greys out a date input while it is empty so it reads as a placeholder
function wireDateInput(el) {
  const sync = () => el.classList.toggle("is-empty", !el.value);
  el.addEventListener("input", sync);
  el.addEventListener("change", sync);
  sync();
}

// Builds the bar that shows or hides a transaction table, remembering the choice
function buildTableToggle(key, table) {
  const bar = document.createElement("button");
  bar.className = "table-toggle";
  bar.innerHTML = `
    <span>History</span>
    <svg class="chev" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 5.25 7 8.75l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  function apply() {
    const collapsed = !!settings.collapsed[key];
    table.classList.toggle("hidden", collapsed);
    bar.classList.toggle("collapsed", collapsed);
    bar.setAttribute("aria-expanded", String(!collapsed));
    bar.setAttribute("aria-label", collapsed ? "Show history" : "Hide history");
  }

  bar.addEventListener("click", () => {
    settings.collapsed[key] = !settings.collapsed[key];
    saveSettings();
    apply();
  });

  apply();
  return bar;
}

/* =========================
   UNDO TOAST
========================= */

const undoToast = document.getElementById("undo-toast");
const undoText = document.getElementById("undo-text");
const undoBtn = document.getElementById("undo-btn");
const undoBar = document.getElementById("undo-bar");
let undoTimeout = null;
let undoCallback = null;

// Shows an undo toast for 3 seconds
function showUndo(message, onExpire, onUndo) {
  if (undoTimeout) { clearTimeout(undoTimeout); }

  undoText.textContent = message;
  undoToast.classList.remove("hidden", "fading");

  undoBar.style.transition = "none";
  undoBar.style.width = "100%";
  requestAnimationFrame(() => {
    undoBar.style.transition = "width 3s linear";
    undoBar.style.width = "0%";
  });

  undoCallback = onUndo;
  undoTimeout = setTimeout(() => {
    undoToast.classList.add("fading");
    setTimeout(() => {
      undoToast.classList.add("hidden");
      undoToast.classList.remove("fading");
      onExpire();
      undoTimeout = null;
      undoCallback = null;
    }, 300);
  }, 3000);
}

// Hides the undo toast
function hideUndo() {
  undoToast.classList.add("fading");
  setTimeout(() => {
    undoToast.classList.add("hidden");
    undoToast.classList.remove("fading");
  }, 300);
}

undoBtn.addEventListener("click", () => {
  if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }
  hideUndo();
  if (undoCallback) { undoCallback(); undoCallback = null; }
});

/* =========================
   HEADER
========================= */

monthText.textContent = now.toLocaleString("default", {
  month: "long",
  year: "numeric"
});

/* =========================
   INCOME (WORKING)
========================= */

/* Renders the income display.

   Shows what was EARNED this month, with carry-over subtracted back out.
   totalIncomeOf has to include carried money - the invariant needs every
   spendable ringgit on that side of the equation - but the card would then
   read "Total income RM 1,096" on the 1st of a month when nothing had been
   earned at all, which is not true. The carried amount gets its own
   "Brought forward" line under Remaining instead.

   Same principle as refusing to count a reimbursement as income: money you
   already had is not money you made. */
function renderIncome() {
  const total = totalIncomeOf(data, allWallets());
  const earned = total === null ? null : total - carryOverOf(data);
  incomeDisplay.textContent = earned !== null ? `${cur()} ${fmt(earned)}` : `${cur()} 0`;
}

incomeCard.addEventListener("click", () => {
  incomeInput.classList.remove("hidden");
  incomeInput.value = data.income ?? "";
  incomeInput.focus();
});

// Saves the income input
function saveIncome() {
  const value = Number(incomeInput.value);

  if (!isValidAmount(value)) {
    incomeInput.classList.add("hidden");
    return;
  }

  data.income = value;
  saveData();

  incomeInput.classList.add("hidden");
  renderIncome();
  calculateRemaining();
}

incomeInput.addEventListener("blur", saveIncome);
incomeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") incomeInput.blur();
});

/* =========================
   PRIORITY BILLS
========================= */

// Builds a single priority bill list item
function buildPriorityItem(bill) {
  const wrapper = document.createElement("div");
  wrapper.className = "swipe-wrapper";

  const deleteLayer = document.createElement("div");
  deleteLayer.className = "swipe-delete-bg";
  deleteLayer.textContent = "Delete";

  const li = document.createElement("li");
  li.innerHTML = `
    <label style="display:flex; gap:8px;">
      <input type="checkbox" ${bill.paid ? "checked" : ""} />
      ${esc(bill.name)} (${esc(bill.category)})
    </label>
    <strong>${esc(cur())} ${fmt(bill.amount)}</strong>
  `;

  const checkbox = li.querySelector("input");
  checkbox.addEventListener("change", (e) => {
    const commit = () => {
      bill.paid = e.target.checked;
      saveData();
      calculateRemaining();
    };

    // Paying a bill takes money out of the main balance, so it can overspend
    // just like a Second choice take
    if (e.target.checked) {
      const available = getMainRemaining();
      if (Number(bill.amount) > available) {
        askOverspend({
          amount: Number(bill.amount),
          available,
          label: `Paying "${bill.name}"`,
          transferName: bill.name,
          proceed: commit,
          onCancel: () => { checkbox.checked = false; }
        });
        return;
      }
    }
    commit();
  });

  if (!data.priorityLocked) {
    attachSwipeToDelete(wrapper, li, () => {
      // Resolve the position at delete time. Capturing an index here would go
      // stale after any earlier deletion and remove the wrong bill.
      const index = data.priority.indexOf(bill);
      if (index === -1) return;
      data.priority.splice(index, 1);

      renderPriority();
      calculateRemaining();

      showUndo(
        `"${bill.name}" deleted`,
        () => saveData(),
        () => {
          data.priority.splice(Math.min(index, data.priority.length), 0, bill);
          saveData();
          renderPriority();
          calculateRemaining();
        }
      );
    });
  }

  wrapper.appendChild(deleteLayer);
  wrapper.appendChild(li);
  return wrapper;
}

// Shared swipe-left-to-delete gesture. Calls onDelete once the row is dragged
// far enough; the caller is responsible for the data change and the undo.
function attachSwipeToDelete(wrapper, el, onDelete) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;
  let decided = false;

  /* Transition is cleared for the duration of the drag so the row tracks the
     finger exactly; it is put back on touchend to animate the release. */
  el.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    swiping = true;
    decided = false;
    el.style.transition = "none";
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    /* Direction lock, resolved once per gesture on the first 8px of movement.
       Without it, any attempt to scroll the page while a finger happens to
       start on a row drags the row sideways instead.

       Mostly vertical: give up on the swipe entirely and let the page scroll.
       Mostly horizontal: commit to swiping and stop re-testing, so a curved
       drag does not flip modes halfway through.

       All three listeners are passive, so this cannot call preventDefault -
       abandoning the gesture is the only way to hand scrolling back to the
       browser, which is exactly what clearing `swiping` does. */
    if (!decided) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { swiping = false; return; }
      if (Math.abs(dx) > 8) decided = true;
    }

    currentX = dx;
    /* Left only - this is delete, and there is nothing behind the right edge.
       The -120px clamp gives the drag a rubber-band end stop. */
    if (currentX < 0) {
      el.style.transform = `translateX(${Math.max(currentX, -120)}px)`;
    }
  }, { passive: true });

  el.addEventListener("touchend", () => {
    if (!swiping) return;
    swiping = false;
    el.style.transition = "transform 0.3s ease";

    /* Past the 80px threshold the swipe counts. The row slides out and its
       wrapper collapses its own height at the same time, so the list closes
       the gap rather than leaving a hole.

       onDelete only stages the removal - it shows the undo toast, and the
       change is committed to storage when that toast expires. */
    if (currentX < -80) {
      el.style.transform = "translateX(-100%)";
      el.style.opacity = "0";
      wrapper.style.transition = "max-height 0.3s ease, opacity 0.3s ease";
      wrapper.style.maxHeight = "0";
      wrapper.style.overflow = "hidden";
      onDelete();
    } else {
      /* Not far enough - spring back. */
      el.style.transform = "translateX(0)";
    }
  }, { passive: true });
}

// Renders the priority bills list
function renderPriority() {
  priorityList.innerHTML = "";

  if (data.priority.length === 0) {
    priorityList.innerHTML = '<li class="empty-state">No priority bills added yet.</li>';
    return;
  }

  data.priority.forEach(bill => {
    const wrapper = buildPriorityItem(bill);
    wrapper.classList.add("item-enter");
    priorityList.appendChild(wrapper);
    requestAnimationFrame(() => wrapper.classList.add("item-enter-active"));
  });
}

// Updates the priority lock UI
function updatePriorityLockUI() {
  const form = document.getElementById("priority-form");
  const lockBadge = document.getElementById("priority-lock-badge");
  if (data.priorityLocked) {
    if (form) form.style.display = "none";
    if (lockBadge) lockBadge.classList.remove("hidden");
  }
}

savePriorityBtn.addEventListener("click", () => {
  if (data.priority.length === 0) return;
  priorityModal.classList.remove("hidden");
});

cancelPriorityBtn.addEventListener("click", () => {
  priorityModal.classList.add("hidden");
});

confirmPriorityBtn.addEventListener("click", () => {
  data.priorityLocked = true;
  saveData();
  priorityModal.classList.add("hidden");
  renderPriority();
  updatePriorityLockUI();
});

addPriorityBtn.addEventListener("click", () => {
  if (data.priorityLocked) return;

  const pbName = document.getElementById("pb-name");
  const pbCategory = document.getElementById("pb-category");
  const pbAmount = document.getElementById("pb-amount");

  const name = pbName.value.trim();
  const category = pbCategory.value;
  const amount = Number(pbAmount.value);

  const fields = [
    { el: pbName, valid: !!name },
    { el: pbCategory, valid: !!category },
    { el: pbAmount, valid: isValidAmount(amount) },
  ];

  let hasError = false;
  fields.forEach(f => {
    if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
    else f.el.classList.remove("input-error");
  });
  if (hasError) return;

  data.priority.push({ name, category, amount, paid: false, date: new Date().toISOString() });
  saveData();

  pbName.value = "";
  pbCategory.selectedIndex = 0;
  pbAmount.value = "";
  fields.forEach(f => f.el.classList.remove("input-error"));

  const emptyItem = priorityList.querySelector(".empty-state");
  if (emptyItem) emptyItem.remove();
  const wrapper = buildPriorityItem(data.priority[data.priority.length - 1]);
  wrapper.classList.add("item-enter");
  priorityList.appendChild(wrapper);
  requestAnimationFrame(() => wrapper.classList.add("item-enter-active"));
  calculateRemaining();
});

/* =========================
   COPY LAST PRIORITY
========================= */

const copyLastBtn = document.getElementById("copy-last-priority");
const backupPriority = JSON.parse(localStorage.getItem(BACKUP_PRIORITY_KEY));

// Shows or hides the "Copy Last Priority" button
function updateCopyLastBtn() {
  if (backupPriority && backupPriority.length > 0 && data.priority.length === 0 && !data.priorityLocked) {
    copyLastBtn.classList.remove("hidden");
  } else {
    copyLastBtn.classList.add("hidden");
  }
}

copyLastBtn.addEventListener("click", () => {
  data.priority = backupPriority.map(b => ({
    name: b.name,
    category: b.category,
    amount: b.amount,
    paid: false,
    date: new Date().toISOString()
  }));
  saveData();
  copyLastBtn.classList.add("hidden");
  renderPriority();
  calculateRemaining();
});

updateCopyLastBtn();

/* =========================
   WALLETS (MULTIPLE)
========================= */

// Ensures a wallet has a data slot for this month
function ensureWalletData(id) {
  if (!data.walletData[id]) data.walletData[id] = { budget: null, items: [] };
  return data.walletData[id];
}

// Balance and spending both come from money.js so the app and its tests
// agree on the arithmetic
function getWalletBalance(id) { return walletBalanceOf(ensureWalletData(id)); }
function getWalletSpent(id) { return walletSpentOf(ensureWalletData(id)); }

// Resolves a transfer counterparty's current name, falling back to the stored one
function transferPartyName(id, fallback) {
  if (id === "main") return "Main";
  const w = settings.wallets.find(w => w.id === id);
  if (w) return w.name;
  return fallback || "deleted wallet";
}

// Removes a transfer's matching half so money is never created or destroyed
// by deleting only one side. Both halves share a txId.
function removeTransferCounterparts(txId, exceptItem) {
  if (!txId) return 0;
  let removed = 0;

  Object.values(data.walletData).forEach(wd => {
    for (let i = (wd.items || []).length - 1; i >= 0; i--) {
      const it = wd.items[i];
      if (it !== exceptItem && it.txId === txId) { wd.items.splice(i, 1); removed++; }
    }
  });
  for (let i = data.secondChoice.length - 1; i >= 0; i--) {
    const it = data.secondChoice[i];
    if (it !== exceptItem && it.txId === txId) { data.secondChoice.splice(i, 1); removed++; }
  }

  return removed;
}

// Restores a whole-month snapshot taken before a deletion. Simpler and safer
// than un-splicing both halves of a transfer in the right order.
function restoreSnapshot(snapshot) {
  const revived = JSON.parse(snapshot);
  // Mutate in place so nothing holds a stale reference to the old object
  Object.keys(data).forEach(k => { delete data[k]; });
  Object.assign(data, revived);
  saveData();
  renderWallets();
  renderSecondChoice();
  renderPriority();
  calculateRemaining();
}

// Deletes one wallet transaction (plus the other half if it was a transfer)
function deleteWalletItem(wallet, item, tbody, section) {
  const wd = ensureWalletData(wallet.id);
  const index = wd.items.indexOf(item);
  if (index === -1) return;

  const snapshot = JSON.stringify(data);

  wd.items.splice(index, 1);
  const pairedRemoved = removeTransferCounterparts(item.txId, item);

  if (pairedRemoved) {
    renderWallets();
  } else {
    renderWalletItemsTable(wallet, tbody, section);
    renderWalletCard(wallet, section);
  }
  renderSecondChoice();
  calculateRemaining();

  showUndo(
    pairedRemoved ? `"${item.name}" transfer deleted` : `"${item.name}" deleted`,
    () => saveData(),
    () => restoreSnapshot(snapshot)
  );
}

// Builds a single wallet transaction row
function buildWalletItemRow(item, wallet, tbody, section) {
  const row = document.createElement("tr");
  const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";

  let label = esc(item.name);
  if (item.type === "out") {
    label = `${esc(item.name)} → ${esc(transferPartyName(item.toId, item.toName))}`;
  } else if (item.type === "in") {
    label = `${esc(item.name)} ← ${esc(transferPartyName(item.fromId, item.fromName))}`;
  }

  row.innerHTML = `
    <td>${label}</td>
    <td class="date-stamp">${dateStr}</td>
    <td>${isWalletInflow(item) ? "+" : "-"} ${esc(cur())} ${fmt(item.amount)}</td>
  `;

  if (wallet) {
    makeRowDeletable(row, () => deleteWalletItem(wallet, item, tbody, section));
  }
  return row;
}

// Wraps a table row so it can be swiped away (touch) or double-clicked (mouse)
function makeRowDeletable(row, onDelete) {
  row.classList.add("row-deletable");

  let startX = 0, startY = 0, dx = 0, active = false, decided = false;

  row.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0; active = true; decided = false;
    row.style.transition = "none";
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (!active) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 8) { active = false; return; }
      if (Math.abs(mx) > 8) decided = true;
    }
    dx = mx;
    if (dx < 0) row.style.transform = `translateX(${Math.max(dx, -110)}px)`;
  }, { passive: true });

  row.addEventListener("touchend", () => {
    if (!active) return;
    active = false;
    row.style.transition = "transform 0.25s ease, opacity 0.25s ease";
    if (dx < -70) {
      row.style.transform = "translateX(-100%)";
      row.style.opacity = "0";
      onDelete();
    } else {
      row.style.transform = "translateX(0)";
    }
  }, { passive: true });

  // Desktop fallback, since there is no swipe with a mouse
  row.addEventListener("dblclick", () => {
    if (confirm("Delete this entry?")) onDelete();
  });
}

// Renders a wallet's transaction table
function renderWalletItemsTable(wallet, tbody, section) {
  tbody.innerHTML = "";
  const wd = ensureWalletData(wallet.id);

  if (wd.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No items yet.</td></tr>';
    return;
  }

  const sorted = [...wd.items];
  if (settings.sortOrder === "newest") {
    sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } else {
    sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  const host = section || tbody.closest(".wallet-section");
  sorted.forEach(item => {
    const row = buildWalletItemRow(item, wallet, tbody, host);
    row.classList.add("item-enter");
    tbody.appendChild(row);
    requestAnimationFrame(() => row.classList.add("item-enter-active"));
  });
}

// Updates a wallet's progress bar
function updateWalletBar(wallet, section) {
  const wrapper = section.querySelector("[data-role='bar-wrapper']");
  const fill = section.querySelector("[data-role='bar-fill']");
  const label = section.querySelector("[data-role='bar-label']");
  const wd = ensureWalletData(wallet.id);

  if (!wd.budget || wd.budget <= 0) {
    wrapper.classList.add("hidden");
    return;
  }

  wrapper.classList.remove("hidden");
  const budget = Number(wd.budget);
  const spent = getWalletSpent(wallet.id);
  const pct = Math.min(Math.max((spent / budget) * 100, 0), 100);

  fill.style.width = `${pct}%`;
  label.textContent = `${Math.round(pct)}% spent`;

  if (pct < 50) {
    fill.style.background = "#6f6f6f";
  } else if (pct < 75) {
    fill.style.background = "#b0b0b0";
  } else {
    fill.style.background = "#ffffff";
  }
  label.style.color = pct >= 75 ? "#e8e8e8" : "";
}

// Refreshes a wallet's balance card and bar
function renderWalletCard(wallet, section) {
  // Same count-up and pulse the Remaining card uses, so adding or taking
  // money reads the same way in every wallet
  animateMoneyTo(section.querySelector("[data-role='balance']"), getWalletBalance(wallet.id));
  section.querySelector("[data-role='budget-label']").textContent = `${wallet.name} Balance`;
  section.querySelector(".wallet-section-title").textContent = wallet.name;
  updateWalletBar(wallet, section);
}

// Builds one wallet's full section (card, form, table) and wires its events
function buildWalletSection(wallet) {
  const section = document.createElement("section");
  section.className = "wallet-section";
  section.dataset.walletId = wallet.id;
  section.innerHTML = `
    <h3 class="wallet-section-title">${esc(wallet.name)}</h3>
    <div class="card wallet-card" data-role="card">
      <span data-role="budget-label">${esc(wallet.name)} Balance</span>
      <h2 data-role="balance">${esc(cur())} 0</h2>
      <input type="number" inputmode="decimal" data-role="budget-input" placeholder="Set budget (${esc(cur())})" class="hidden" />
      <p class="budget-hint hidden" data-role="budget-hint"></p>
      <div class="spend-bar-wrapper hidden" data-role="bar-wrapper">
        <div class="spend-bar-track"><div class="spend-bar-fill" data-role="bar-fill"></div></div>
        <span class="spend-bar-label" data-role="bar-label">0% spent</span>
      </div>
    </div>
    <div class="second-form wallet-form">
      <input type="text" data-role="item-name" placeholder="Item name" />
      <input type="number" inputmode="decimal" data-role="item-amount" placeholder="Amount (${esc(cur())})" />
      <div class="date-field">
        <input type="date" data-role="item-date" class="is-empty" aria-label="Date, optional, defaults to today" />
        <span class="date-placeholder">Date (Optional)</span>
      </div>
      <div class="actions">
        <button data-role="add-btn" aria-label="Add money to ${esc(wallet.name)}">+ Add</button>
        <button data-role="take-btn" aria-label="Take money from ${esc(wallet.name)}">- Take</button>
      </div>
      <button data-role="transfer-btn" class="transfer-btn" aria-label="Transfer money from ${esc(wallet.name)}">Transfer</button>
    </div>
    <table>
      <thead><tr><th>Item</th><th>Date</th><th>Amount</th></tr></thead>
      <tbody data-role="table"></tbody>
    </table>
  `;

  const card = section.querySelector("[data-role='card']");
  const budgetInput = section.querySelector("[data-role='budget-input']");
  const budgetHint = section.querySelector("[data-role='budget-hint']");
  const nameInput = section.querySelector("[data-role='item-name']");
  const amountInput = section.querySelector("[data-role='item-amount']");
  const dateInput = section.querySelector("[data-role='item-date']");
  const tbody = section.querySelector("[data-role='table']");

  wireDateInput(dateInput);

  const tableEl = section.querySelector("table");
  tableEl.parentNode.insertBefore(buildTableToggle(wallet.id, tableEl), tableEl);

  card.addEventListener("click", (e) => {
    if (e.target === budgetInput) return;
    budgetInput.classList.remove("hidden");
    budgetInput.classList.remove("input-error");
    budgetHint.classList.add("hidden");
    budgetInput.value = ensureWalletData(wallet.id).budget ?? "";
    budgetInput.focus();
  });

  budgetInput.addEventListener("input", () => {
    budgetInput.classList.remove("input-error");
    budgetHint.classList.add("hidden");
  });

  function saveBudget() {
    const value = Number(budgetInput.value);
    if (!isValidAmount(value)) {
      budgetInput.classList.add("hidden");
      return;
    }
    const wd = ensureWalletData(wallet.id);
    const oldBudget = Number(wd.budget) || 0;

    // Cannot budget more than the main balance can cover
    const available = getMainRemaining() + oldBudget;
    if (value > available) {
      budgetInput.classList.add("input-error");
      budgetHint.textContent = `Only ${cur()} ${fmt(available)} available to budget.`;
      budgetHint.classList.remove("hidden");
      return;
    }

    // ...nor less than the wallet has already paid out, which would push its
    // balance negative and invent the difference in the main balance
    const floor = minBudgetOf(wd);
    if (value < floor) {
      budgetInput.classList.add("input-error");
      budgetHint.textContent = `${cur()} ${fmt(floor)} has already left this wallet, so the budget can't go below that.`;
      budgetHint.classList.remove("hidden");
      return;
    }

    budgetInput.classList.remove("input-error");
    budgetHint.classList.add("hidden");
    wd.budget = value;
    saveData();
    budgetInput.classList.add("hidden");
    renderWalletCard(wallet, section);
    calculateRemaining();
  }
  budgetInput.addEventListener("blur", saveBudget);
  budgetInput.addEventListener("keydown", (e) => { if (e.key === "Enter") budgetInput.blur(); });

  // Writes the item. `rebuilt` is true when a covering transfer has already
  // re-rendered every wallet section, which detaches the nodes cached above -
  // so the incremental row insert must be skipped in that case.
  function commitItem(type, name, amount, dateValue, rebuilt) {
    const wd = ensureWalletData(wallet.id);
    wd.items.push({ name, amount, type, date: resolveDate(dateValue) });
    saveData();

    if (rebuilt) {
      renderWallets();
      calculateRemaining();
      return;
    }

    nameInput.value = "";
    amountInput.value = "";
    dateInput.value = "";
    dateInput.classList.add("is-empty");
    [nameInput, amountInput].forEach(el => el.classList.remove("input-error"));

    if (dateValue) {
      // A picked date can belong anywhere in the list, so re-sort the table
      renderWalletItemsTable(wallet, tbody, section);
    } else {
      const emptyRow = tbody.querySelector("td.empty-state");
      if (emptyRow) emptyRow.closest("tr").remove();
      const newItem = wd.items[wd.items.length - 1];
      const row = buildWalletItemRow(newItem, wallet, tbody, section);
      row.classList.add("item-enter");
      if (settings.sortOrder === "newest") {
        tbody.prepend(row);
      } else {
        tbody.appendChild(row);
      }
      requestAnimationFrame(() => row.classList.add("item-enter-active"));
    }

    renderWalletCard(wallet, section);
    calculateRemaining();
  }

  function addItem(type) {
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    const dateValue = dateInput.value;

    const fields = [
      { el: nameInput, valid: !!name },
      { el: amountInput, valid: isValidAmount(amount) },
    ];
    let hasError = false;
    fields.forEach(f => {
      if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
      else f.el.classList.remove("input-error");
    });
    if (hasError) return;

    // Taking more than the wallet holds would push its balance negative, which
    // the books cannot represent. Raise the budget first instead.
    if (type === "take" && amount > getWalletBalance(wallet.id)) {
      amountInput.classList.add("input-error");
      return;
    }

    // Moving money into a wallet can outrun the main balance
    if (type === "add" && amount > getMainRemaining()) {
      askOverspend({
        amount,
        available: getMainRemaining(),
        label: `Adding ${cur()} ${fmt(amount)} to ${wallet.name}`,
        transferName: name,
        excludeWalletId: wallet.id,
        proceed: () => commitItem(type, name, amount, dateValue, true)
      });
      return;
    }

    commitItem(type, name, amount, dateValue, false);
  }

  section.querySelector("[data-role='add-btn']").addEventListener("click", () => addItem("add"));
  section.querySelector("[data-role='take-btn']").addEventListener("click", () => addItem("take"));
  section.querySelector("[data-role='transfer-btn']").addEventListener("click", () => {
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);

    const fields = [
      { el: nameInput, valid: !!name },
      { el: amountInput, valid: isValidAmount(amount) },
    ];
    let hasError = false;
    fields.forEach(f => {
      if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
      else f.el.classList.remove("input-error");
    });
    if (hasError) return;

    // A transfer credits the destination, so it cannot exceed what this wallet holds
    if (amount > getWalletBalance(wallet.id)) {
      amountInput.classList.add("input-error");
      return;
    }

    openTransferModal(wallet, name, amount, resolveDate(dateInput.value), () => {
      nameInput.value = "";
      amountInput.value = "";
      dateInput.value = "";
      dateInput.classList.add("is-empty");
    });
  });
  [nameInput, amountInput].forEach(el => {
    el.addEventListener("input", () => el.classList.remove("input-error"));
  });

  renderWalletItemsTable(wallet, tbody, section);
  renderWalletCard(wallet, section);

  return section;
}

// Rebuilds every wallet section on the main page
function renderWallets() {
  walletsContainer.innerHTML = "";
  activeWallets().forEach(wallet => {
    walletsContainer.appendChild(buildWalletSection(wallet));
  });
}

/* =========================
   WALLET TRANSFER
========================= */

const transferModal = document.getElementById("transfer-modal");
const transferSummary = document.getElementById("transfer-summary");
const transferDestinations = document.getElementById("transfer-destinations");
const cancelTransferBtn = document.getElementById("cancel-transfer");

// Moves money out of a wallet into Main or another wallet. Both halves share a
// txId so deleting either one takes the other with it.
function executeTransfer(sourceWallet, destId, name, amount, date) {
  const destName = transferPartyName(destId);
  const txId = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  ensureWalletData(sourceWallet.id).items.push({
    name, amount, type: "out", toId: destId, toName: destName, date, txId
  });

  if (destId === "main") {
    // Returned money re-enters the main balance and shows in Second choice.
    // transfer:true keeps it out of Total Income - it is not new money.
    data.secondChoice.push({
      name, category: "Transfer", amount, type: "add", date, txId, transfer: true
    });
  } else {
    // Wallet-to-wallet money already left main, so it must not be deducted again
    ensureWalletData(destId).items.push({
      name, amount, type: "in", fromId: sourceWallet.id, fromName: sourceWallet.name, date, txId
    });
  }

  saveData();
  renderWallets();
  renderSecondChoice();
  calculateRemaining();
}

// Opens the destination picker for a pending transfer
function openTransferModal(wallet, name, amount, date, onDone) {
  transferSummary.textContent = `Move ${cur()} ${fmt(amount)} from ${wallet.name} to:`;
  transferDestinations.innerHTML = "";

  const destinations = [
    { id: "main", name: "Main wallet", sub: "Shows in Second choice" },
    ...activeWallets()
      .filter(w => w.id !== wallet.id)
      .map(w => ({ id: w.id, name: w.name, sub: `Balance ${cur()} ${fmt(getWalletBalance(w.id))}` }))
  ];

  destinations.forEach(dest => {
    const btn = document.createElement("button");
    btn.className = "transfer-dest-btn";
    btn.setAttribute("aria-label", `Transfer to ${dest.name}`);
    btn.innerHTML = `${esc(dest.name)}<span class="transfer-dest-sub">${esc(dest.sub)}</span>`;
    btn.addEventListener("click", () => {
      executeTransfer(wallet, dest.id, name, amount, date);
      transferModal.classList.add("hidden");
      onDone();
    });
    transferDestinations.appendChild(btn);
  });

  transferModal.classList.remove("hidden");
}

cancelTransferBtn.addEventListener("click", () => {
  transferModal.classList.add("hidden");
});

/* =========================
   OVERSPEND PROMPT
========================= */

const overspendModal = document.getElementById("overspend-modal");
const overspendSummary = document.getElementById("overspend-summary");
const overspendOptions = document.getElementById("overspend-options");
const cancelOverspendBtn = document.getElementById("cancel-overspend");
let overspendCancel = null;

// Asks what to do when an action would spend past the main balance: cover the
// shortfall from a wallet that can fully absorb it, record it anyway and let
// Remaining go negative, or cancel. `proceed` performs the original action.
function askOverspend({ amount, available, label, transferName, proceed, onCancel, excludeWalletId }) {
  // Round to cents so the covering transfer stores a clean figure rather than
  // float dust like 943.8299999999999
  const shortfall = Math.round((amount - available) * 100) / 100;

  overspendSummary.textContent =
    `${label} is ${cur()} ${fmt(shortfall)} more than the ${cur()} ${fmt(available)} you have left.`;
  overspendOptions.innerHTML = "";

  // A wallet cannot fund money being moved into itself
  const candidates = allWallets().filter(w => w.id !== excludeWalletId);

  walletsCovering(data, candidates, shortfall).forEach(({ wallet, balance }) => {
    const btn = document.createElement("button");
    btn.className = "transfer-dest-btn";
    btn.setAttribute("aria-label", `Cover the shortfall from ${wallet.name}`);
    btn.innerHTML = `Cover ${esc(cur())} ${fmt(shortfall)} from ${esc(wallet.name)}` +
      `<span class="transfer-dest-sub">Has ${esc(cur())} ${fmt(balance)}. Moves it to your main balance first.</span>`;
    btn.addEventListener("click", () => {
      closeOverspend();
      // A real tagged transfer, so it is excluded from income and deleting
      // either half removes both
      executeTransfer(wallet, "main", `Cover ${transferName}`, shortfall, new Date().toISOString());
      proceed();
    });
    overspendOptions.appendChild(btn);
  });

  const anyway = document.createElement("button");
  anyway.className = "transfer-dest-btn";
  anyway.setAttribute("aria-label", "Record it anyway and go overspent");
  anyway.innerHTML = `Record it anyway` +
    `<span class="transfer-dest-sub">Remaining goes to ${esc(cur())} ${fmt(available - amount)}.</span>`;
  anyway.addEventListener("click", () => { closeOverspend(); proceed(); });
  overspendOptions.appendChild(anyway);

  overspendCancel = onCancel || null;
  overspendModal.classList.remove("hidden");
}

function closeOverspend() {
  overspendModal.classList.add("hidden");
  overspendCancel = null;
}

cancelOverspendBtn.addEventListener("click", () => {
  const cb = overspendCancel;
  closeOverspend();
  if (cb) cb();
});

/* =========================
   SECOND CHOICE
========================= */

// Deletes one Second choice entry (plus the wallet half if it was a transfer)
function deleteSecondChoiceItem(item) {
  const index = data.secondChoice.indexOf(item);
  if (index === -1) return;

  const snapshot = JSON.stringify(data);

  data.secondChoice.splice(index, 1);
  const pairedRemoved = removeTransferCounterparts(item.txId, item);

  renderSecondChoice();
  if (pairedRemoved) renderWallets();
  calculateRemaining();

  showUndo(
    pairedRemoved ? `"${item.name}" transfer deleted` : `"${item.name}" deleted`,
    () => saveData(),
    () => restoreSnapshot(snapshot)
  );
}

// Builds a single second choice table row
function buildSecondChoiceRow(item) {
  const row = document.createElement("tr");
  const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  // Mark money that came back, so months later it is clear which additions
  // were repayments rather than earnings
  const mark = isReimbursement(item)
    ? ' <span class="returned-mark" title="Money coming back, not income">&#8617;</span>'
    : "";

  row.innerHTML = `
    <td>${esc(item.name)}${mark}</td>
    <td>${esc(item.category)}</td>
    <td class="date-stamp">${dateStr}</td>
    <td>${item.type === "add" ? "+" : "-"} ${esc(cur())} ${fmt(item.amount)}</td>
  `;
  makeRowDeletable(row, () => deleteSecondChoiceItem(item));
  return row;
}

// Renders the second choice transactions table
function renderSecondChoice() {
  scTable.innerHTML = "";

  if (data.secondChoice.length === 0) {
    scTable.innerHTML = '<tr><td colspan="4" class="empty-state">No transactions yet.</td></tr>';
    return;
  }

  const sorted = [...data.secondChoice];
  if (settings.sortOrder === "newest") {
    sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } else {
    sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  sorted.forEach(item => {
    const row = buildSecondChoiceRow(item);
    row.classList.add("item-enter");
    scTable.appendChild(row);
    requestAnimationFrame(() => row.classList.add("item-enter-active"));
  });
}

// Validates the Second choice form, marking any bad fields. Returns the
// values when they are all usable.
function readSecondChoiceForm() {
  const name = scName.value.trim();
  const category = scCategory.value;
  const amount = Number(scAmount.value);

  const fields = [
    { el: scName, valid: !!name },
    { el: scCategory, valid: !!category },
    { el: scAmount, valid: isValidAmount(amount) },
  ];

  let hasError = false;
  fields.forEach(f => {
    if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
    else f.el.classList.remove("input-error");
  });
  if (hasError) return null;

  return { name, category, amount, fields };
}

// Adds a second choice transaction. For an "add", newMoney says whether it
// counts as income or is money coming back to you.
function addSecondChoice(type, newMoney) {
  const form = readSecondChoiceForm();
  if (!form) return;
  const { name, category, amount, fields } = form;

  const backdated = !!scDate.value;
  const entry = { name, category, amount, type, date: resolveDate(scDate.value) };
  if (type === "add") entry.newMoney = newMoney !== false;
  data.secondChoice.push(entry);
  saveData();

  scName.value = "";
  scCategory.selectedIndex = 0;
  scAmount.value = "";
  scDate.value = "";
  scDate.classList.add("is-empty");
  fields.forEach(f => f.el.classList.remove("input-error"));

  if (backdated) {
    // A picked date can belong anywhere in the list, so re-sort the table
    renderSecondChoice();
  } else {
    const emptyRow = scTable.querySelector("td.empty-state");
    if (emptyRow) emptyRow.closest("tr").remove();
    const newSc = data.secondChoice[data.secondChoice.length - 1];
    const scRow = buildSecondChoiceRow(newSc);
    scRow.classList.add("item-enter");
    if (settings.sortOrder === "newest") {
      scTable.prepend(scRow);
    } else {
      scTable.appendChild(scRow);
    }
    requestAnimationFrame(() => scRow.classList.add("item-enter-active"));
  }

  calculateRemaining();
}

/* =========================
   NEW MONEY vs MONEY COMING BACK
========================= */

const sourceModal = document.getElementById("source-modal");
const sourceSummary = document.getElementById("source-summary");
const sourceNewBtn = document.getElementById("source-new");
const sourceBackBtn = document.getElementById("source-back");
const cancelSourceBtn = document.getElementById("cancel-source");

// Asks whether an addition is income or money returning, because a repayment
// should raise what you have left without inflating what you earned.
addMoneyBtn.addEventListener("click", () => {
  const form = readSecondChoiceForm();
  if (!form) return;
  sourceSummary.textContent = `Adding ${cur()} ${fmt(form.amount)} - is this new money, or money coming back to you?`;
  sourceModal.classList.remove("hidden");
});

sourceNewBtn.addEventListener("click", () => {
  sourceModal.classList.add("hidden");
  addSecondChoice("add", true);
});

sourceBackBtn.addEventListener("click", () => {
  sourceModal.classList.add("hidden");
  addSecondChoice("add", false);
});

cancelSourceBtn.addEventListener("click", () => sourceModal.classList.add("hidden"));
takeMoneyBtn.addEventListener("click", () => {
  const form = readSecondChoiceForm();
  if (!form) return;

  const available = getMainRemaining();
  if (form.amount > available) {
    askOverspend({
      amount: form.amount,
      available,
      label: `This ${cur()} ${fmt(form.amount)}`,
      transferName: form.name,
      proceed: () => addSecondChoice("take")
    });
    return;
  }
  addSecondChoice("take");
});

// Clears error highlight on input
document.querySelectorAll(".second-form input, .second-form select").forEach(el => {
  el.addEventListener("input", () => el.classList.remove("input-error"));
  el.addEventListener("change", () => el.classList.remove("input-error"));
});

/* =========================
   CALCULATION
========================= */

// Returns the main remaining balance
function getMainRemaining() {
  return mainRemainingOf(data, allWallets());
}

// Counts a money figure to its new value and pulses the card it sits in, so a
// change reads as movement rather than a snap. The previous value and a
// cancellation token live on the element, so any number of cards can use this
// independently - a freshly rendered element simply has no previous value and
// is set instantly.
function animateMoneyTo(el, to) {
  const from = el._shownValue;
  el._shownValue = to;

  if (from === undefined || from === null || from === to) {
    el.textContent = `${cur()} ${fmt(to)}`;
    return;
  }

  const card = el.closest(".card");
  if (card) {
    card.classList.remove("card-pulse");
    void card.offsetWidth;
    card.classList.add("card-pulse");
  }

  const token = (el._animToken || 0) + 1;
  el._animToken = token;

  const start = performance.now();
  const duration = 350;
  function tick(now) {
    if (el._animToken !== token) return;
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = `${cur()} ${fmt(from + (to - from) * eased)}`;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Animates the remaining balance toward a new value and pulses the card
function updateRemainingDisplay(to) {
  animateMoneyTo(remainingMoneyEl, to);
}

// Recalculates and renders the remaining balance, bars, and warnings
/* The "Brought forward" line under Remaining. Hidden entirely when there is
   nothing carried, so a month started from scratch shows no empty row. States
   the figure and nothing else - it is information, not congratulation. */
function renderCarryOverLine() {
  const el = document.getElementById("carry-over-line");
  if (!el) return;
  const carried = carryOverOf(data);
  el.classList.toggle("hidden", carried <= 0);
  if (carried > 0) {
    el.textContent = `Brought forward ${cur()} ${fmt(carried)}`;
  }
}

function calculateRemaining(skipChart = false) {
  renderIncome();
  renderCarryOverLine();

  /* monthIsUnset rather than a bare income check: on the 1st, income is null
     while carry-over is not, and that month has a real balance to show. A
     plain `income === null` test here would blank the card and make the
     carried money look like it had vanished all over again. */
  if (monthIsUnset(data)) {
    remainingMoneyEl._shownValue = 0;
    remainingMoneyEl.textContent = `${cur()} ${fmt(0)}`;
    return;
  }

  let remaining = getMainRemaining();

  updateRemainingDisplay(remaining);

  const income = totalIncomeOf(data, allWallets());
  const spent = income - remaining;
  const pct = Math.min(Math.max((spent / income) * 100, 0), 100);
  const fill = document.getElementById("spend-bar-fill");
  const label = document.getElementById("spend-bar-label");
  const limitMark = document.getElementById("spend-bar-limit");

  fill.style.width = `${pct}%`;
  label.textContent = `${Math.round(pct)}% spent`;

  if (pct < 50) {
    fill.style.background = "#6f6f6f";
  } else if (pct < 75) {
    fill.style.background = "#b0b0b0";
  } else {
    fill.style.background = "#ffffff";
  }
  label.style.color = pct >= 75 ? "#e8e8e8" : "";

  if (settings.budgetLimit && income > 0) {
    const limitSpendPct = ((income - settings.budgetLimit) / income) * 100;
    limitMark.style.left = `${Math.min(Math.max(limitSpendPct, 0), 100)}%`;
    limitMark.classList.remove("hidden");
  } else {
    limitMark.classList.add("hidden");
  }

  const warningEl = document.getElementById("budget-warning");
  if (warningEl) {
    // Being overspent is the more serious state, so it takes precedence over
    // the budget-limit warning
    if (remaining < 0) {
      warningEl.textContent = `Overspent by ${cur()} ${fmt(-remaining)}`;
      warningEl.classList.remove("hidden");
    } else if (settings.budgetLimit && remaining <= settings.budgetLimit) {
      warningEl.textContent = `Warning: Remaining is below ${cur()} ${fmt(settings.budgetLimit)}`;
      warningEl.classList.remove("hidden");
    } else {
      warningEl.classList.add("hidden");
    }
  }
  if (!skipChart) renderChart();
}


/* =========================
   CHART
========================= */

// Renders the donut chart with category breakdown
function renderChart() {
  if (!settings.showChart || !chartCtx) return;

  const canvas = chartCanvas;
  const ctx = chartCtx;
  const legend = chartLegend;

  const income = totalIncomeOf(data, allWallets()) || 0;
  if (income === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = canvas.width;
    const center = size / 2;

    /* Empty-state ring. Two arcs drawn in opposite directions and closed into
       one path punches the hole out of the middle - the reverse winding is
       what makes it a donut rather than a filled disc. Same trick as the real
       slices below. */
    ctx.beginPath();
    ctx.arc(center, center, size / 2 - 10, 0, Math.PI * 2);
    ctx.arc(center, center, (size / 2 - 10) * 0.55, Math.PI * 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();

    ctx.fillStyle = "#555";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No data yet", center, center);

    legend.innerHTML = '<span style="color:#555;font-size:13px;">Set your income to get started.</span>';
    return;
  }

  /* allWallets() rather than activeWallets(): a closed wallet's spending is
     still spending, and dropping it here would shrink the donut below the
     income it is dividing up. */
  const breakdown = spendingBreakdownOf(data, allWallets());

  /* Wallet slices are keyed by NAME, because that is how monthTotalsOf files
     them under categories. The consequence is that closing a wallet and
     making a new one with the same name merges the two in this chart. */
  const walletColorMap = {};
  allWallets().forEach((w, i) => { walletColorMap[w.name] = walletColor(i); });

  const spent = breakdown.spent;
  const inWallets = Math.max(breakdown.inWallets, 0);

  /* rawRemaining keeps its sign for the overspend check below; `remaining` is
     the clamped version used for the slice, since a negative slice angle
     would sweep backwards over the others. */
  const rawRemaining = getMainRemaining();
  const remaining = Math.max(rawRemaining, 0);

  /* Biggest categories first, so the eye lands on the largest slice at the
     top of the donut. Colour precedence: the five fixed chart categories win,
     then wallets by name, then a neutral grey for anything unrecognised -
     which is also why a wallet may not be named after a fixed category. */
  const segments = Object.entries(breakdown.categories)
    .sort((a, b) => b[1] - a[1])
    .map(([label, amount]) => ({
      label,
      amount,
      color: CATEGORY_COLORS[label] || walletColorMap[label] || "#6a6a6a",
    }));

  // Money budgeted to a wallet has left the main balance but is not spent yet
  if (inWallets > 0) {
    segments.push({ label: "In wallets", amount: inWallets, color: CHART_IN_WALLETS_COLOR });
  }

  if (remaining > 0) {
    segments.push({ label: "Remaining", amount: remaining, color: CHART_REMAINING_COLOR });
  }

  // An overspend has no slice - it is not a share of income - but the legend
  // has to say so, otherwise the donut silently looks like a full division of
  // money that was never there.
  const overspentBy = rawRemaining < 0 ? -rawRemaining : 0;

  /* Income set but nothing moved yet: one full Remaining slice, so the canvas
     shows a complete ring instead of dividing by a total of zero below. */
  if (segments.length === 0) {
    segments.push({ label: "Remaining", amount: income, color: CHART_REMAINING_COLOR });
  }

  const size = canvas.width;
  const center = size / 2;
  const radius = size / 2 - 10;
  const innerRadius = radius * 0.55;

  /* Slices are sized against the sum of the segments, NOT against income.
     The two are equal in a balanced month, and when overspent the overspend
     is deliberately absent from `segments` - so dividing by income would
     leave a gap in the ring rather than a full circle. */
  const total = segments.reduce((sum, s) => sum + s.amount, 0);

  ctx.clearRect(0, 0, size, size);

  /* Start at the top. Canvas angles begin at 3 o'clock, so -90deg rotates the
     first slice up to 12 o'clock where a donut is expected to start. */
  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    const sliceAngle = (seg.amount / total) * Math.PI * 2;
    /* Outer arc forwards, inner arc backwards, closed into one path - the
       same reverse-winding donut trick as the empty state above. */
    ctx.beginPath();
    ctx.arc(center, center, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(center, center, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${cur()} ${fmt(spent)}`, center, center - 8);
  ctx.font = "12px -apple-system, sans-serif";
  ctx.fillStyle = "#888";
  ctx.fillText("total spent", center, center + 12);

  legend.innerHTML = segments.map(s => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="legend-dot" style="background:${s.color}"></span>
        <span>${esc(s.label)}</span>
      </div>
      <span class="legend-amount">${esc(cur())} ${fmt(s.amount)}</span>
    </div>
  `).join("") + (overspentBy > 0 ? `
    <div class="legend-item legend-overspent">
      <div class="legend-left">
        <span class="legend-dot" style="background:${CHART_OVERSPENT_COLOR}"></span>
        <span>Overspent</span>
      </div>
      <span class="legend-amount">${esc(cur())} ${fmt(overspentBy)}</span>
    </div>
  ` : "");
}

/* =========================
   INITIAL RENDER
========================= */

wireDateInput(scDate);

const scTableEl = scTable.closest("table");
scTableEl.parentNode.insertBefore(buildTableToggle("secondChoice", scTableEl), scTableEl);

renderIncome();
renderPriority();
renderWallets();
renderSecondChoice();
updatePriorityLockUI();
calculateRemaining();

/* =========================
   SETTINGS PANEL
========================= */

const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

// Closes settings when clicking outside
document.addEventListener("click", (e) => {
  if (!settingsPanel.contains(e.target) && !settingsToggle.contains(e.target)) {
    settingsPanel.classList.add("hidden");
  }
});

const chartToggle = document.getElementById("chart-toggle");
const chartSection = document.getElementById("chart-section");

chartToggle.checked = settings.showChart;
if (settings.showChart) chartSection.classList.remove("hidden");

chartToggle.addEventListener("change", () => {
  settings.showChart = chartToggle.checked;
  saveSettings();

  if (settings.showChart) {
    chartSection.classList.remove("hidden");
    renderChart();
  } else {
    chartSection.classList.add("hidden");
  }
});

/* =========================
   CURRENCY SETTING
========================= */

/* Carry balance forward. Takes effect at the NEXT rollover - switching it off
   does not claw back money already carried into the month on screen, which
   would delete a balance the user can see. */
const carryOverToggle = document.getElementById("carry-over-toggle");
if (carryOverToggle) {
  carryOverToggle.checked = settings.carryOver !== false;
  carryOverToggle.addEventListener("change", () => {
    settings.carryOver = carryOverToggle.checked;
    saveSettings();
  });
}

const currencySelect = document.getElementById("currency-select");
currencySelect.value = settings.currency;

currencySelect.addEventListener("change", () => {
  settings.currency = currencySelect.value;
  saveSettings();
  renderIncome();
  renderPriority();
  renderWallets();
  renderSecondChoice();
  calculateRemaining();
});

/* =========================
   SORT SETTING
========================= */

const sortSelect = document.getElementById("sort-select");
sortSelect.value = settings.sortOrder;

sortSelect.addEventListener("change", () => {
  settings.sortOrder = sortSelect.value;
  saveSettings();
  renderWallets();
  renderSecondChoice();
});

/* =========================
   BUDGET LIMIT SETTING
========================= */

const budgetLimitInput = document.getElementById("budget-limit-input");
budgetLimitInput.value = settings.budgetLimit || "";

budgetLimitInput.addEventListener("change", () => {
  const val = Number(budgetLimitInput.value);
  settings.budgetLimit = val > 0 ? val : null;
  if (!val) budgetLimitInput.value = "";
  saveSettings();
  calculateRemaining(true);
});

/* =========================
   WALLETS SETTING
========================= */

const RESERVED_CATEGORY_NAMES = ["bills", "subscription", "food / drink", "transport", "others"];

const walletsSettingsList = document.getElementById("wallets-settings-list");
const walletsCountEl = document.getElementById("wallets-count");
const addWalletBtn = document.getElementById("add-wallet-btn");

const addWalletModal = document.getElementById("add-wallet-modal");
const addWalletNameInput = document.getElementById("add-wallet-name");
const addWalletError = document.getElementById("add-wallet-error");
const confirmAddWalletBtn = document.getElementById("confirm-add-wallet");
const cancelAddWalletBtn = document.getElementById("cancel-add-wallet");

const deleteWalletModal = document.getElementById("delete-wallet-modal");
const deleteWalletText = document.getElementById("delete-wallet-text");
const confirmDeleteWalletBtn = document.getElementById("confirm-delete-wallet");
const cancelDeleteWalletBtn = document.getElementById("cancel-delete-wallet");
let walletPendingDelete = null;

// Checks a candidate wallet name against reserved category names and existing wallets
function walletNameConflict(name, excludeId) {
  const norm = name.trim().toLowerCase();
  if (!norm) return "empty";
  if (RESERVED_CATEGORY_NAMES.includes(norm)) return "reserved";
  if (activeWallets().some(w => w.id !== excludeId && w.name.trim().toLowerCase() === norm)) return "duplicate";
  return null;
}

// Renders the wallet list inside settings
function renderWalletsSettings() {
  const shown = activeWallets();
  walletsCountEl.textContent = shown.length === 1 ? "1 wallet" : `${shown.length} wallets`;

  walletsSettingsList.innerHTML = "";
  if (shown.length === 0) {
    walletsSettingsList.innerHTML = '<p class="wallets-empty">No wallets yet.</p>';
    return;
  }

  shown.forEach(wallet => {
    const row = document.createElement("div");
    row.className = "wallet-setting-row";
    row.innerHTML = `
      <input type="text" class="setting-input-wide wallet-name-input" value="${esc(wallet.name)}" />
      <button class="wallet-delete-btn" aria-label="Delete ${esc(wallet.name)}">✕</button>
    `;

    const input = row.querySelector(".wallet-name-input");
    input.addEventListener("input", () => input.classList.remove("input-error"));
    input.addEventListener("blur", () => {
      const newName = input.value.trim();
      if (!newName || newName === wallet.name) {
        input.value = wallet.name;
        return;
      }
      if (walletNameConflict(newName, wallet.id)) {
        input.classList.add("input-error");
        input.value = wallet.name;
        return;
      }
      wallet.name = newName;
      saveSettings();
      renderWallets();
      renderChart();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

    row.querySelector(".wallet-delete-btn").addEventListener("click", () => {
      walletPendingDelete = wallet;
      const leftover = getWalletBalance(wallet.id);
      const spent = walletTakenOf(data.walletData[wallet.id]);

      const parts = [`Close "${wallet.name}"?`];
      if (leftover > 0) parts.push(`Its remaining ${cur()} ${fmt(leftover)} returns to your main balance.`);
      if (spent > 0) parts.push(`The ${cur()} ${fmt(spent)} already spent from it stays in this month's totals.`);
      parts.push("It disappears from this screen and cannot be reopened.");

      deleteWalletText.textContent = parts.join(" ");
      deleteWalletModal.classList.remove("hidden");
    });

    walletsSettingsList.appendChild(row);
  });
}

addWalletBtn.addEventListener("click", () => {
  addWalletNameInput.value = "";
  addWalletNameInput.classList.remove("input-error");
  addWalletError.classList.add("hidden");
  addWalletModal.classList.remove("hidden");
  addWalletNameInput.focus();
});

function confirmAddWallet() {
  const name = addWalletNameInput.value.trim();
  const conflict = walletNameConflict(name);

  if (conflict === "empty") {
    addWalletNameInput.classList.add("input-error");
    return;
  }
  if (conflict === "duplicate") {
    addWalletError.textContent = `A wallet named "${name}" already exists.`;
    addWalletError.classList.remove("hidden");
    addWalletNameInput.classList.add("input-error");
    return;
  }
  if (conflict === "reserved") {
    addWalletError.textContent = `"${name}" is a reserved category name. Choose another.`;
    addWalletError.classList.remove("hidden");
    addWalletNameInput.classList.add("input-error");
    return;
  }

  settings.wallets.push({ id: genWalletId(), name });
  saveSettings();
  addWalletModal.classList.add("hidden");
  renderWallets();
  renderWalletsSettings();
  calculateRemaining();
}

confirmAddWalletBtn.addEventListener("click", confirmAddWallet);
addWalletNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmAddWallet(); });
addWalletNameInput.addEventListener("input", () => {
  addWalletNameInput.classList.remove("input-error");
  addWalletError.classList.add("hidden");
});
cancelAddWalletBtn.addEventListener("click", () => addWalletModal.classList.add("hidden"));

cancelDeleteWalletBtn.addEventListener("click", () => {
  deleteWalletModal.classList.add("hidden");
  walletPendingDelete = null;
});

confirmDeleteWalletBtn.addEventListener("click", () => {
  if (!walletPendingDelete) return;
  const wallet = walletPendingDelete;

  // Return whatever is left to the main balance as a real transfer, so the
  // money is accounted for rather than just vanishing with the wallet.
  const leftover = getWalletBalance(wallet.id);
  if (leftover > 0) {
    executeTransfer(wallet, "main", `${wallet.name} closed`, leftover, new Date().toISOString());
  }

  // Soft delete: the record and its transactions stay in the books so any
  // spending already made from this wallet is not silently un-spent. Closed
  // wallets are dropped for good at the next month rollover.
  wallet.deleted = true;

  saveSettings();
  saveData();
  deleteWalletModal.classList.add("hidden");
  walletPendingDelete = null;
  renderWallets();
  renderWalletsSettings();
  calculateRemaining();
});

renderWalletsSettings();

/* =========================
   IMPORT DATA
========================= */

const importBtn = document.getElementById("import-data-btn");
const importFile = document.getElementById("import-file");
const importModal = document.getElementById("import-modal");
const importModalText = document.getElementById("import-modal-text");
const confirmImportBtn = document.getElementById("confirm-import");
const cancelImportBtn = document.getElementById("cancel-import");
let pendingImport = null;

// Accepts only files that really look like one of our exports, so a wrong
// pick can't quietly replace a month with nonsense.
function validateImport(obj) {
  if (!obj || typeof obj !== "object") return "That file isn't valid JSON data.";
  const d = obj.data;
  if (!d || typeof d !== "object") return "That file has no month data in it.";
  if (!("income" in d)) return "That file is missing the income field.";
  if (!Array.isArray(d.priority)) return "That file is missing the priority bills list.";
  if (!Array.isArray(d.secondChoice)) return "That file is missing the Second choice list.";
  if (d.walletData && typeof d.walletData !== "object") return "That file's wallet data is malformed.";
  if (obj.settings && typeof obj.settings !== "object") return "That file's settings are malformed.";
  if (obj.archive && typeof obj.archive !== "object") return "That file's history is malformed.";
  if (obj.priorityBackup && !Array.isArray(obj.priorityBackup)) return "That file's saved priority bills are malformed.";
  return null;
}

// Writes a key when the file carries content for it and clears it otherwise,
// so the app after an import matches the file exactly rather than blending
// the file's contents with whatever was already there.
function replaceKey(key, value, hasContent) {
  if (!hasContent) { localStorage.removeItem(key); return true; }
  return save(key, value);
}

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (err) {
      alert("Couldn't read that file - it isn't valid JSON.");
      importFile.value = "";
      return;
    }

    const problem = validateImport(parsed);
    if (problem) {
      alert(problem);
      importFile.value = "";
      return;
    }

    pendingImport = parsed;

    const months = parsed.archive ? Object.keys(parsed.archive).length : 0;
    const walletCount = parsed.settings && Array.isArray(parsed.settings.wallets)
      ? parsed.settings.wallets.filter(w => !w.deleted).length : 0;
    const savedBills = Array.isArray(parsed.priorityBackup) ? parsed.priorityBackup.length : 0;

    const contents = [
      parsed.data.month ? `the month of ${monthLabel(parsed.data.month)}` : "one month",
      `${walletCount} wallet${walletCount === 1 ? "" : "s"}`,
      `${months} archived month${months === 1 ? "" : "s"}`
    ];
    if (savedBills > 0) contents.push(`${savedBills} saved priority bill${savedBills === 1 ? "" : "s"}`);

    const stamp = parsed.exportedAt
      ? ` Exported ${new Date(parsed.exportedAt).toLocaleString("default", { dateStyle: "medium", timeStyle: "short" })}.`
      : "";

    importModalText.textContent =
      `The app will be replaced with exactly what this file holds: ${contents.join(", ")}.` +
      `${stamp} Anything not in the file is cleared, and your current data cannot be recovered afterwards.`;

    importModal.classList.remove("hidden");
    importFile.value = "";
  };
  reader.onerror = () => {
    alert("Couldn't read that file.");
    importFile.value = "";
  };
  reader.readAsText(file);
});

cancelImportBtn.addEventListener("click", () => {
  importModal.classList.add("hidden");
  pendingImport = null;
});

confirmImportBtn.addEventListener("click", () => {
  if (!pendingImport) return;
  const p = pendingImport;

  const ok =
    save(STORAGE_KEY, p.data) &&
    replaceKey(SETTINGS_KEY, p.settings, !!p.settings) &&
    replaceKey(ARCHIVE_KEY, p.archive, !!p.archive && Object.keys(p.archive).length > 0) &&
    replaceKey(BACKUP_PRIORITY_KEY, p.priorityBackup, Array.isArray(p.priorityBackup) && p.priorityBackup.length > 0);

  pendingImport = null;
  importModal.classList.add("hidden");
  if (ok) location.reload();
});

/* =========================
   EXPORT DATA
========================= */

document.getElementById("export-data-btn").addEventListener("click", () => {
  // Everything the app persists, so an import can rebuild it exactly. The
  // priority backup is included too - it is what "Copy Last Priority" reads.
  const exportObj = {
    app: "monthly-money-tracker",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data,
    settings,
    archive,
    priorityBackup: JSON.parse(localStorage.getItem(BACKUP_PRIORITY_KEY)) || []
  };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `money-tracker-${currentMonthKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* =========================
   HISTORY (ARCHIVE VIEW)
========================= */

const appView = document.getElementById("app-view");
const historyView = document.getElementById("history-view");
const historyToggle = document.getElementById("history-toggle");
const historyBack = document.getElementById("history-back");
const historyList = document.getElementById("history-list");
const historyCount = document.getElementById("history-count");
const trendStats = document.getElementById("trend-stats");
const trendCanvas = document.getElementById("trend-chart");
const trendCtx = trendCanvas ? trendCanvas.getContext("2d") : null;
const storageLine = document.getElementById("storage-line");
const deleteArchiveBtn = document.getElementById("delete-archive-btn");

// Formats a byte count for display
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// localStorage stores UTF-16, so ~2 bytes per character
function bytesOfString(str) {
  return str ? str.length * 2 : 0;
}

function bytesOfKey(key) {
  return bytesOfString(localStorage.getItem(key));
}

// "2026-7" -> "July 2026"
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

// "2026-7" -> "Jul"
function monthShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "short" });
}

// Archive keys in chronological order
function sortedArchiveKeys() {
  return Object.keys(archive).sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return ay - by || am - bm;
  });
}

// Normalizes an archived entry (new multi-wallet shape or legacy single-wallet shape)
function normalizeArchiveEntry(entry) {
  if (entry.wallets) return entry;

  const wallets = entry.walletEnabled ? [{ id: "_legacy", name: entry.walletName || "Second Wallet" }] : [];
  const d = { ...entry.data, walletData: {} };
  if (entry.walletEnabled && (Number(entry.data.groceryBudget) > 0 || (entry.data.groceryItems || []).length > 0)) {
    d.walletData["_legacy"] = { budget: entry.data.groceryBudget, items: entry.data.groceryItems || [] };
  }
  return { data: d, wallets, currency: entry.currency, closedAt: entry.closedAt };
}

// Income, spending, remaining, and category totals for an archived month.
// Uses the same money.js formulas as the live month.
function summarizeEntry(rawEntry) {
  const entry = normalizeArchiveEntry(rawEntry);
  const b = spendingBreakdownOf(entry.data, entry.wallets);
  return {
    income: totalIncomeOf(entry.data, entry.wallets),
    spent: b.spent,
    inWallets: b.inWallets,
    remaining: mainRemainingOf(entry.data, entry.wallets),
    totals: b.categories
  };
}

// Draws the monthly spending bar chart
/* Bar chart of spending per month, drawn by hand on a canvas - no library.
   `entries` is oldest-first and its last element is the in-progress month,
   flagged `live`, which is drawn dimmed because it is not comparable to a
   finished month yet. */
function drawTrendChart(entries) {
  if (!trendCtx) return;
  const W = trendCanvas.width;
  const H = trendCanvas.height;
  /* padTop leaves room for the value labels that sit above the tallest bar;
     padBottom for the month names under the axis. */
  const padTop = 22;
  const padBottom = 26;
  const padSide = 14;
  const chartH = H - padTop - padBottom;
  const baseY = H - padBottom;

  trendCtx.clearRect(0, 0, W, H);

  /* Baseline. The 0.5 offset puts a 1px stroke on a whole pixel instead of
     straddling two, which would render as a soft 2px grey smear. */
  trendCtx.strokeStyle = "#2a2a2a";
  trendCtx.lineWidth = 1;
  trendCtx.beginPath();
  trendCtx.moveTo(padSide, baseY + 0.5);
  trendCtx.lineTo(W - padSide, baseY + 0.5);
  trendCtx.stroke();

  /* Axis only - nothing to plot. */
  if (entries.length === 0) return;

  /* Bars scale against the tallest month including the live one, so the
     current month is never drawn taller than the canvas. The floor of 1
     avoids dividing by zero in a month where nothing has been spent. */
  const max = Math.max(...entries.map(e => e.spent), 1);

  /* Highlighting the biggest month is judged on FINISHED months only. A
     part-way-through month should not be crowned the highest spender just
     because it happens to lead on the 3rd. */
  const maxArchived = Math.max(...entries.filter(e => !e.live).map(e => e.spent), 0);

  /* Each month gets an equal slot; the bar occupies 60% of it so there is
     always a gap. The 44px cap stops two or three months rendering as absurd
     slabs across the full width. */
  const slot = (W - padSide * 2) / entries.length;
  const barW = Math.min(slot * 0.6, 44);

  entries.forEach((e, i) => {
    const h = Math.round((e.spent / max) * chartH);
    const x = padSide + slot * i + (slot - barW) / 2;
    const y = baseY - h;

    /* Brightness carries the meaning, matching the greyscale rest of the UI:
       dim = still in progress, white = highest finished month, grey = normal.
       The maxArchived > 0 guard stops every bar going white in a history
       where nothing has been spent at all. */
    if (e.live) {
      trendCtx.fillStyle = "#4a4a4a";
    } else if (e.spent === maxArchived && maxArchived > 0) {
      trendCtx.fillStyle = "#ffffff";
    } else {
      trendCtx.fillStyle = "#8a8a8a";
    }
    trendCtx.fillRect(x, y, barW, h);

    /* Month name under the axis, centred on the bar. */
    trendCtx.fillStyle = "#666";
    trendCtx.font = "11px -apple-system, sans-serif";
    trendCtx.textAlign = "center";
    trendCtx.textBaseline = "top";
    trendCtx.fillText(monthShort(e.key), x + barW / 2, baseY + 7);

    /* Value labels only when there is room. Past six bars the slots are
       narrower than the text and the numbers collide into a grey smudge. */
    if (entries.length <= 6) {
      trendCtx.fillStyle = e.live ? "#666" : "#aaa";
      trendCtx.font = "10px -apple-system, sans-serif";
      trendCtx.textBaseline = "bottom";
      trendCtx.fillText(fmtWhole(e.spent), x + barW / 2, y - 4);
    }
  });
}

// Renders the trends card (chart + stats)
function renderTrends(keys) {
  const archivedEntries = keys.slice(-11).map(key => ({
    key,
    spent: summarizeEntry(archive[key]).spent,
    live: false
  }));

  const liveSpent = spendingBreakdownOf(data, allWallets()).spent;
  const entries = [...archivedEntries, { key: currentMonthKey, spent: liveSpent, live: true }];

  drawTrendChart(entries);

  if (keys.length === 0) {
    trendStats.innerHTML = '<p class="trend-empty">History appears after your first month ends. The dim bar is this month so far.</p>';
    return;
  }

  const spents = keys.map(key => ({ key, spent: summarizeEntry(archive[key]).spent }));
  const avg = spents.reduce((s, e) => s + e.spent, 0) / spents.length;
  const lowest = spents.reduce((a, b) => (b.spent < a.spent ? b : a));
  const highest = spents.reduce((a, b) => (b.spent > a.spent ? b : a));

  trendStats.innerHTML = `
    <div class="stat-cell">
      <span class="stat-label">Avg Spent</span>
      <span class="stat-value">${esc(cur())} ${fmtWhole(avg)}</span>
    </div>
    <div class="stat-cell">
      <span class="stat-label">Lowest</span>
      <span class="stat-value">${esc(cur())} ${fmtWhole(lowest.spent)}</span>
      <span class="stat-sub">${monthShort(lowest.key)}</span>
    </div>
    <div class="stat-cell">
      <span class="stat-label">Highest</span>
      <span class="stat-value">${esc(cur())} ${fmtWhole(highest.spent)}</span>
      <span class="stat-sub">${monthShort(highest.key)}</span>
    </div>
  `;
}

// Builds one archived month row (summary + expandable detail)
function buildHistoryRow(key) {
  const rawEntry = archive[key];
  const entry = normalizeArchiveEntry(rawEntry);
  const s = summarizeEntry(rawEntry);
  const c = entry.currency || cur();
  const size = fmtBytes(bytesOfString(JSON.stringify(rawEntry)));
  const d = entry.data;

  const row = document.createElement("div");
  row.className = "history-row";

  const incomeText = s.income !== null ? `${esc(c)} ${fmtWhole(s.income)} in` : "no income set";

  const walletColorMap = {};
  entry.wallets.forEach((w, i) => { walletColorMap[w.name] = walletColor(i); });

  const detailRows = Object.entries(s.totals)
    .sort((a, b) => b[1] - a[1])
    .map(([label, amount]) => {
      const color = CATEGORY_COLORS[label] || walletColorMap[label] || "#6a6a6a";
      return `
        <div class="legend-item">
          <div class="legend-left">
            <span class="legend-dot" style="background:${color}"></span>
            <span>${esc(label)}</span>
          </div>
          <span class="legend-amount">${esc(c)} ${fmt(amount)}</span>
        </div>
      `;
    })
    .join("");

  const inWalletsRow = s.inWallets > 0 ? `
    <div class="legend-item">
      <div class="legend-left">
        <span class="legend-dot" style="background:${CHART_IN_WALLETS_COLOR}"></span>
        <span>In wallets</span>
      </div>
      <span class="legend-amount">${esc(c)} ${fmt(s.inWallets)}</span>
    </div>
  ` : "";

  const remainingRow = s.income !== null ? `
    <div class="legend-item">
      <div class="legend-left">
        <span class="legend-dot" style="background:${CHART_REMAINING_COLOR}"></span>
        <span>Remaining</span>
      </div>
      <span class="legend-amount">${esc(c)} ${fmt(s.remaining)}</span>
    </div>
  ` : "";

  const walletItemCount = Object.values(d.walletData || {}).reduce((n, wd) => n + (wd.items || []).length, 0);
  const counts = `${(d.priority || []).length} bills · ${walletItemCount} wallet items · ${(d.secondChoice || []).length} transactions`;

  row.innerHTML = `
    <div class="history-row-main">
      <div>
        <div class="history-month">${monthLabel(key)}</div>
        <div class="history-sub">${incomeText} · ${esc(c)} ${fmtWhole(s.spent)} spent · ${size}</div>
      </div>
      <div class="history-right">
        <strong class="history-remaining">${esc(c)} ${fmtWhole(s.remaining)}</strong>
        <button class="history-delete" aria-label="Delete ${monthLabel(key)}">✕</button>
      </div>
    </div>
    <div class="history-detail hidden">
      ${detailRows || '<span class="history-sub">No spending recorded.</span>'}
      ${inWalletsRow}
      ${remainingRow}
      <span class="history-meta">${counts}</span>
    </div>
  `;

  row.querySelector(".history-row-main").addEventListener("click", (e) => {
    if (e.target.closest(".history-delete")) return;
    row.querySelector(".history-detail").classList.toggle("hidden");
  });

  row.querySelector(".history-delete").addEventListener("click", () => {
    deleteArchivedMonth(key);
  });

  return row;
}

// Deletes one archived month with undo
function deleteArchivedMonth(key) {
  const removed = archive[key];
  delete archive[key];
  renderHistory();

  showUndo(
    `${monthLabel(key)} deleted`,
    () => {
      saveArchive();
    },
    () => {
      archive[key] = removed;
      saveArchive();
      renderHistory();
    }
  );
}

// Total app storage across all keys
function totalStorageBytes() {
  return bytesOfKey(STORAGE_KEY) + bytesOfKey(SETTINGS_KEY) +
    bytesOfKey(BACKUP_PRIORITY_KEY) + bytesOfKey(ARCHIVE_KEY);
}

// Renders the whole history view
function renderHistory() {
  const keys = sortedArchiveKeys();

  historyCount.textContent = keys.length === 1
    ? "1 archived month"
    : `${keys.length} archived months`;

  renderTrends(keys);

  historyList.innerHTML = "";
  if (keys.length === 0) {
    historyList.innerHTML = '<div class="empty-state">No archived months yet.</div>';
  } else {
    [...keys].reverse().forEach(key => {
      historyList.appendChild(buildHistoryRow(key));
    });
  }

  deleteArchiveBtn.classList.toggle("hidden", keys.length === 0);
  storageLine.textContent = `Storage used: ${fmtBytes(totalStorageBytes())} of ~5 MB`;
}

historyToggle.addEventListener("click", () => {
  renderHistory();
  appView.classList.add("hidden");
  historyView.classList.remove("hidden");
  window.scrollTo(0, 0);
});

historyBack.addEventListener("click", () => {
  historyView.classList.add("hidden");
  appView.classList.remove("hidden");
  window.scrollTo(0, 0);
});

/* =========================
   DELETE ALL HISTORY
========================= */

const archiveModal = document.getElementById("archive-modal");
const archiveModalText = document.getElementById("archive-modal-text");
const confirmArchiveDeleteBtn = document.getElementById("confirm-archive-delete");
const cancelArchiveDeleteBtn = document.getElementById("cancel-archive-delete");

deleteArchiveBtn.addEventListener("click", () => {
  const n = Object.keys(archive).length;
  const size = fmtBytes(bytesOfKey(ARCHIVE_KEY));
  archiveModalText.textContent =
    `This will erase ${n === 1 ? "1 archived month" : `${n} archived months`} (${size}). This action cannot be undone.`;
  archiveModal.classList.remove("hidden");
});

cancelArchiveDeleteBtn.addEventListener("click", () => {
  archiveModal.classList.add("hidden");
});

confirmArchiveDeleteBtn.addEventListener("click", () => {
  archive = {};
  localStorage.removeItem(ARCHIVE_KEY);
  archiveModal.classList.add("hidden");
  renderHistory();
});

/* =========================
   SECRET RESET (DOUBLE CLICK HEADER)
========================= */

// Resets data in place to avoid stale object references
function resetData() {
  data.month = currentMonthKey;
  data.income = null;
  data.priority = [];
  data.priorityLocked = false;
  data.walletData = {};
  data.secondChoice = [];
}

const secretReset = document.getElementById("secret-reset");
const resetModal = document.getElementById("reset-modal");
const confirmResetBtn = document.getElementById("confirm-reset");
const cancelResetBtn = document.getElementById("cancel-reset");

// Opens the reset modal on header double-click
secretReset.addEventListener("dblclick", () => {
  resetModal.classList.remove("hidden");
});

// Cancels the reset
cancelResetBtn.addEventListener("click", () => {
  resetModal.classList.add("hidden");
});

// Confirms the reset and wipes the month
confirmResetBtn.addEventListener("click", () => {
  if (data.priority.length > 0) {
    localStorage.setItem(BACKUP_PRIORITY_KEY, JSON.stringify(data.priority));
  }

  resetData();
  saveData();
  location.reload();
});

/* =========================
   KEYBOARD-AWARE MODALS
========================= */

// Tracks the visible viewport so modals stay centred above an open keyboard
(function () {
  const vv = window.visualViewport;
  if (!vv) return;

  function syncViewport() {
    document.documentElement.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    document.documentElement.style.setProperty("--vv-height", `${vv.height}px`);
  }

  vv.addEventListener("resize", syncViewport);
  vv.addEventListener("scroll", syncViewport);
  syncViewport();
})();

/* =========================
   PULL TO REFRESH
========================= */

(function () {
  const indicator = document.getElementById("pull-indicator");
  const pullText = document.getElementById("pull-text");
  const pullSpinner = document.getElementById("pull-spinner");
  let startY = 0;
  let pulling = false;
  const threshold = 80;

  const app = document.querySelector(".app");
  let dragging = false;
  let pullDistance = 0;

  document.addEventListener("touchstart", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "LABEL") return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    if (!historyView.classList.contains("hidden")) return;
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      dragging = false;
      pullDistance = 0;
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    if (window.scrollY > 0) { pulling = false; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) { pulling = false; return; }
    if (dy > 10) {
      dragging = true;
      pullDistance = Math.min(dy, 120);
      app.style.transition = "none";
      app.style.transform = `translateY(${pullDistance}px)`;
      indicator.style.opacity = Math.min(pullDistance / threshold, 1);
      pullText.textContent = pullDistance >= threshold ? "Release to refresh" : "Pull to refresh";
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!pulling || !dragging) {
      pulling = false;
      return;
    }
    pulling = false;
    dragging = false;
    app.style.transition = "transform 0.3s ease";
    app.style.transform = "";

    if (pullDistance >= threshold) {
      pullText.textContent = "Refreshing...";
      pullSpinner.classList.remove("hidden");
      indicator.style.opacity = "1";
      app.style.transform = "translateY(40px)";
      setTimeout(() => location.reload(), 600);
      return;
    }

    pullDistance = 0;
    indicator.style.opacity = "0";
  }, { passive: true });
})();
