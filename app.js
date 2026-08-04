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

/* Today as "YYYY-MM-DD". Built in LOCAL time - toISOString would give the
   previous day in negative-offset timezones and roll the cycle over early.

   A FUNCTION, not a captured constant, because an installed PWA is not a page
   load: it stays resident in memory for days, so anything that captured the
   date at startup keeps reporting the day the app was opened. That is what
   used to strand entries in an already-archived month after midnight. */
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The startup snapshot. Migrations below are one-shot and settle before the
// app can outlive a day, so they read this rather than re-deriving it.
const todayStr = todayString();

/* Reads a stored key, surviving a corrupt one.
 *
 * Every load used to be a bare JSON.parse. One malformed byte - a write
 * interrupted by a full disk, a browser bug, a hand-edited value - threw
 * before a single pixel rendered, and the app died to a blank screen with the
 * user's data sitting intact but unreachable.
 *
 * A corrupt value is now kept, not overwritten: it is moved aside under a
 * `-corrupt` key so it can still be recovered by hand, and the app carries on
 * with the fallback. Overwriting would destroy the only copy of whatever was
 * in there.
 *
 * The names of the damaged keys are collected so the UI can say what happened
 * rather than silently pretending the data never existed. */
const corruptKeys = [];

function load(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    // `null` parses fine but is not a usable object; treat it as absent.
    return parsed === null ? fallback : parsed;
  } catch (err) {
    console.error(`Corrupt storage in ${key} - set aside, continuing without it`, err);
    corruptKeys.push(key);
    try {
      localStorage.setItem(`${key}-corrupt`, raw);
    } catch (_) {
      /* Quota is likely why it broke in the first place. Nothing more to do -
         the original is still in place under its own key either way. */
    }
    return fallback;
  }
}

let settings = load(SETTINGS_KEY, null) || {
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
/* The day a budget cycle begins. 1 is the calendar month and the default;
   someone paid on the 25th sets 25 and their month runs 25th to 24th. Days
   longer than a short month clamp to its last day, so 31 starts February on
   the 28th. */
if (settings.monthStartDay === undefined) settings.monthStartDay = 1;

/* The categories offered by the two entry forms.
 *
 * These were hardcoded as <option> markup until v1.22.0, which capped
 * everyday spending at three labels and made the donut chart far less
 * informative than it could be. They live in settings now so they can be
 * edited, and the markup holds none of them.
 *
 * MIGRATION: an install predating this has no `categories`, and is seeded
 * with exactly the list that used to be in the HTML - so nothing an existing
 * user sees changes, and no stored entry is left pointing at a category that
 * has stopped existing. */
const DEFAULT_CATEGORIES = {
  priority: ["Bills", "Subscription", "Others"],
  secondChoice: ["Food / Drink", "Transport", "Others"]
};
/* "Others" is where monthTotalsOf files anything with no category of its own,
   so it has to exist in both lists and cannot be removed. */
const FALLBACK_CATEGORY = "Others";

if (!settings.categories || typeof settings.categories !== "object") {
  settings.categories = {
    priority: [...DEFAULT_CATEGORIES.priority],
    secondChoice: [...DEFAULT_CATEGORIES.secondChoice]
  };
  saveSettings();
}
/* Repair a half-written or hand-edited shape rather than throwing later.
   Each list must be an array of non-empty strings and must contain the
   fallback, since an entry saved with no category is filed under it. */
["priority", "secondChoice"].forEach(list => {
  const seen = new Set();
  const cleaned = (Array.isArray(settings.categories[list]) ? settings.categories[list] : [])
    .filter(c => typeof c === "string" && c.trim())
    .map(c => c.trim())
    .filter(c => {
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  /* Emptiness is decided BEFORE the fallback is added, or a list that survived
     cleaning with nothing left would end up as a lone "Others" - technically
     valid, useless in practice, and impossible to tell apart from a list the
     user had deliberately pared down. */
  if (!cleaned.length) {
    settings.categories[list] = [...DEFAULT_CATEGORIES[list]];
    return;
  }
  if (!cleaned.some(c => c.toLowerCase() === FALLBACK_CATEGORY.toLowerCase())) {
    cleaned.push(FALLBACK_CATEGORY);
  }
  settings.categories[list] = cleaned;
});
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

let archive = load(ARCHIVE_KEY, null) || {};

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
function freshMonthData(carry, cycleStart) {
  const walletData = {};
  if (carry && carry.wallets) {
    Object.keys(carry.wallets).forEach(id => {
      walletData[id] = { budget: carry.wallets[id], items: [] };
    });
  }
  const start = cycleStart || cycleStartForDate(todayString(), settings.monthStartDay);
  return {
    month: cycleKeyOf(start),
    /* When this cycle began, and when the next one does. Both are STORED
       rather than recomputed from today, and that is the whole safety
       argument for this feature: the month's identity is fixed the moment it
       is created, so changing the start day later can only ever move
       cycleNext. Recomputing the key from today would let a settings change
       decide we are in a cycle that has already been archived, and the
       rollover would then try to recreate a month that exists. */
    cycleStart: start,
    cycleNext: nextCycleStartOf(start, settings.monthStartDay),
    income: null,
    carryOver: carry ? carry.total : 0,
    /* The same money as carryOver, split by where it landed. carryOver stays
       the figure every calculation uses; this exists only so each history can
       show the part that arrived there. Kept as a record of what WAS carried,
       so it stays accurate after a wallet budget is edited by hand - which is
       exactly what makes carried money indistinguishable otherwise. */
    carryIn: carry ? { main: carry.main, wallets: { ...carry.wallets } } : { main: 0, wallets: {} },
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

let data = load(STORAGE_KEY, null);

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

/* MIGRATION: months stored before cycles existed have no cycleStart. Every
   one of them ran 1st to 1st, so that is what they are stamped with - the
   inferred dates describe exactly what those months already meant, and
   nothing is reinterpreted. Runs once; afterwards cycleStart is always
   present. */
if (data && !data.cycleStart) {
  const [y, m] = String(data.month).split("-").map(Number);
  data.cycleStart = `${y}-${String(m).padStart(2, "0")}-01`;
  data.cycleNext = nextCycleStartOf(data.cycleStart, settings.monthStartDay);
  saveData();
}

if (!data) {
  data = freshMonthData();
  /* Persist immediately rather than waiting for the first edit.

     This matters after a corrupt read: the damaged value is still sitting
     under the real key, since load() copies it aside rather than destroying
     it. Leaving it there would warn the user again on every single load and
     leave the app unsaved until they happened to change something. Writing
     the fresh month now settles the state, and the copy under `-corrupt`
     remains the recovery path. */
  saveData();
} else if (todayStr >= data.cycleNext) {
  performRollover(todayStr);
}

/* Closes the month on screen and opens the one containing `today`.
 *
 * Extracted from the startup path so the exact same code can run later
 * without a reload - see checkCycleRollover at the bottom of this file.
 * `data` is mutated IN PLACE rather than reassigned, the same reason
 * restoreSnapshot does: by the time this runs live, closures and cached
 * nodes already exist, and swapping the object out from under them would
 * leave them writing into a month that is no longer on screen. */
function performRollover(today) {
  if (monthHasContent(data)) {
    archive[data.month] = {
      data: JSON.parse(JSON.stringify(data)),
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

  /* The new cycle begins where the old one said it would - cycleNext, not a
     figure recomputed from today. If the app was not opened for a while it
     may already be several cycles stale, so this walks forward until the
     start it lands on actually contains today. Each step is a real cycle
     boundary, so no month is skipped and none is invented. */
  let nextStart = data.cycleNext;
  while (today >= nextCycleStartOf(nextStart, settings.monthStartDay)) {
    nextStart = nextCycleStartOf(nextStart, settings.monthStartDay);
  }

  const fresh = freshMonthData(carry, nextStart);
  Object.keys(data).forEach(k => { delete data[k]; });
  Object.assign(data, fresh);
  saveData();
}

/* The cycle on screen, as an archive key. Derived from the month record that
   the rollover above has just settled, NOT recomputed from today - which is
   what keeps it stable when the start day changes.

   `let`, not `const`: a live rollover moves the app to a new cycle without a
   reload, and everything keyed by this (the export filename, the trend
   chart's live bar, resetData) has to follow it. */
let currentMonthKey = data.month;

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
    data.carryIn = { main: restored.main, wallets: { ...restored.wallets } };
  } else {
    // Nothing to restore, but stamp the fields so this never runs again.
    data.carryOver = 0;
    data.carryIn = { main: 0, wallets: {} };
  }
  saveData();
}

/* MIGRATION: back-fill the carry-in SPLIT for a month that was carried before
   the breakdown was stored.

   Such a month has a carryOver total but no idea how it divided between main
   and the wallets, so it would show no history rows at all. The split is read
   back out of the previous month's closing balance in the archive.

   Only fills the split - carryOver itself is left exactly as it is, so the
   totals on screen cannot shift. If the reconstructed parts do not add up to
   the stored total the month has been edited since, and it is left alone
   rather than shown a breakdown that contradicts its own total. */
if (data && carryOverOf(data) > 0 && !data.carryIn) {
  const [y, m] = String(data.month).split("-").map(Number);
  const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${m - 1}`;
  const prev = archive[prevKey];
  let split = null;

  if (prev) {
    const prevEntry = normalizeArchiveEntry(prev);
    const closing = closingBalanceOf(prevEntry.data, prevEntry.wallets || []);
    const live = new Set((settings.wallets || []).map(w => w.id));
    const wallets = {};
    Object.keys(closing.wallets).forEach(id => {
      if (live.has(id)) wallets[id] = closing.wallets[id];
    });
    const total = closing.main + Object.values(wallets).reduce((a, b) => a + b, 0);
    if (Math.abs(total - carryOverOf(data)) < 1e-6) {
      split = { main: closing.main, wallets };
    }
  }

  data.carryIn = split || { main: 0, wallets: {} };
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

/* Matches a canvas's backing store to the device's pixel density.
 *
 * Both charts are hand-drawn, and both used to draw into a fixed backing
 * store sized by the width/height ATTRIBUTES while CSS displayed them at a
 * different size. On a phone at devicePixelRatio 3 that meant every arc and
 * label was resampled twice - once by the CSS box, once by the screen - and
 * the result read as soft.
 *
 * The backing store is sized in device pixels; the context is then scaled so
 * every drawing call below can keep using plain CSS pixels and none of the
 * layout maths has to change. Returns the LOGICAL size to draw against, or
 * null when the canvas has no layout box yet (hidden chart, history view
 * closed) - there is nothing to draw in that case.
 *
 * Deliberately writes NO inline styles: style.css gives both canvases an
 * explicit width and height, so the attributes rewritten here cannot affect
 * layout and the trend chart stays fluid at `width: 100%`.
 */
function fitCanvas(canvas, ctx) {
  if (!canvas || !ctx) return null;
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.round(rect.width);
  const cssH = Math.round(rect.height);
  // Zero in jsdom, and for anything inside a hidden ancestor.
  if (!cssW || !cssH) return null;

  /* Capped at 3: past that the extra pixels are invisible and the memory is
     not - a 440x190 chart at dpr 4 is a 5.3-megapixel buffer. */
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const backingW = Math.round(cssW * dpr);
  const backingH = Math.round(cssH * dpr);

  /* Assigning width/height clears the canvas AND resets the transform, so
     only do it when the size actually changed. The setTransform below then
     runs every time, which is what keeps the scale correct on the redraws
     that did not resize. */
  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: cssW, h: cssH };
}

// Only the chart and its legend use color - the rest of the app stays monochrome
const CATEGORY_COLORS = {
  "Bills": "#e74c3c",
  "Subscription": "#e67e22",
  "Food / Drink": "#9b59b6",
  "Transport": "#16a085",
  "Others": "#8a8a8a",
};

/* Colours for user-defined categories, which by definition are not in the map
   above. Chosen to sit apart from both the built-in category colours and the
   wallet ramp, so a custom category is never confusable with either. */
const CUSTOM_CATEGORY_RAMP = [
  "#4a90d9", "#d95f9a", "#57b894", "#c9a227", "#8e7cc3", "#d9734a", "#4aa3a3"
];

/* Picks a colour for a category name deterministically.
 *
 * Deliberately a hash of the NAME rather than a position in the list: the
 * chart sorts its slices by amount and the settings list can be reordered by
 * adding or removing entries, so an index-based colour would make a category
 * change colour without the user changing anything. Hashing means "Groceries"
 * is the same colour today, tomorrow, and in an archived month. */
function categoryColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  const key = String(name || "");
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CUSTOM_CATEGORY_RAMP[hash % CUSTOM_CATEGORY_RAMP.length];
}

/* Every category currently offered, both lists together, lowercased. Wallet
   names are checked against this: a wallet sharing a category's name would
   merge into that slice, since the chart keys slices by name. */
function allCategoryNames() {
  return [
    ...(settings.categories.priority || []),
    ...(settings.categories.secondChoice || [])
  ];
}

/* Fills a <select> with the categories for one list, preserving the disabled
   prompt that is the only option in the markup. `keep` re-selects a value
   that may no longer be offered - an entry being edited can hold a category
   the user has since removed, and silently reassigning it would rewrite
   history the user did not ask to change. */
function renderCategoryOptions(select, list, keep) {
  if (!select) return;
  const names = settings.categories[list] || [];
  const prompt = select.querySelector('option[value=""]');
  select.innerHTML = "";
  if (prompt) select.appendChild(prompt);

  names.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (keep && !names.includes(keep)) {
    const opt = document.createElement("option");
    opt.value = keep;
    opt.textContent = `${keep} (removed)`;
    select.appendChild(opt);
  }
  if (keep) select.value = keep;
  else select.selectedIndex = 0;
}

// Rebuilds both category dropdowns from settings.
function renderAllCategoryOptions() {
  renderCategoryOptions(document.getElementById("pb-category"), "priority");
  renderCategoryOptions(document.getElementById("sc-category"), "secondChoice");
}

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

/* The date shown on a transaction row.
 *
 * Rows used to render a bare "15 Jun" with no year, which hid two genuinely
 * confusing cases: an entry back-dated into a previous cycle, and one dated in
 * another year entirely - a 2027 entry was indistinguishable from this year's.
 *
 * Both still count toward the month they were entered in, which is deliberate:
 * a cycle's books are what was recorded during it, and silently moving money
 * between months to match a typed date would change totals the user has
 * already checked. So rather than block or move them, the row says so - the
 * year appears, and `outside` marks it for a tooltip and dimmer styling.
 */
function entryDateLabel(iso) {
  if (!iso) return { text: "", outside: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "", outside: false };

  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const outside = !!(data.cycleStart && data.cycleNext)
    && (day < data.cycleStart || day >= data.cycleNext);

  return {
    text: d.toLocaleDateString("en-GB", outside
      ? { day: "numeric", month: "short", year: "numeric" }
      : { day: "numeric", month: "short" }),
    outside
  };
}

// The cell markup for a row's date, shared by both transaction tables.
function dateCellHtml(iso) {
  const { text, outside } = entryDateLabel(iso);
  if (!outside) return `<td class="date-stamp">${esc(text)}</td>`;
  return `<td class="date-stamp is-outside" title="Dated outside this month, but counted in it">${esc(text)}</td>`;
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

/* Pending undoable actions, oldest first.
 *
 * This was a single slot, so deleting two things in quick succession stranded
 * the first one - the toast showed only the second and the first could never
 * be taken back. It is a stack now: each Undo takes back the most recent
 * action and then re-offers the one before it, so a run of mistaken deletions
 * can be walked back one at a time.
 *
 * Order matters and must stay LIFO. Several of these undos restore a whole
 * month snapshot taken before their own action, so replaying them out of
 * order would reinstate a state that never existed.
 */
let undoStack = [];

/* Full-month snapshots are not small, and the stack only exists to cover a
   burst of quick mistakes. Past this, the oldest is committed for real. */
const UNDO_STACK_LIMIT = 10;

// Commits one entry - the action becomes permanent and leaves the stack.
function commitUndoEntry(entry) {
  if (entry && typeof entry.onExpire === "function") entry.onExpire();
}

/* Commits everything still pending. Called when the toast times out: the
   window has closed on all of them, not just the one being shown. Oldest
   first, so each writes over the last in the order the user acted. */
function flushUndoStack() {
  const pending = undoStack;
  undoStack = [];
  pending.forEach(commitUndoEntry);
}

// Paints the toast for whatever is currently on top and restarts the timer.
function showTopUndo() {
  const top = undoStack[undoStack.length - 1];
  if (!top) return;

  if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }

  undoText.textContent = top.message;
  undoBtn.classList.remove("hidden");
  undoToast.classList.remove("hidden", "fading");

  undoBar.style.transition = "none";
  undoBar.style.width = "100%";
  requestAnimationFrame(() => {
    undoBar.style.transition = "width 3s linear";
    undoBar.style.width = "0%";
  });

  undoTimeout = setTimeout(() => {
    undoToast.classList.add("fading");
    setTimeout(() => {
      undoToast.classList.add("hidden");
      undoToast.classList.remove("fading");
      undoTimeout = null;
      flushUndoStack();
    }, 300);
  }, 3000);
}

/* Registers an undoable action and shows the toast.
 *
 * Signature unchanged, so every caller keeps working: `onExpire` commits the
 * action once the window closes, `onUndo` takes it back. */
function showUndo(message, onExpire, onUndo) {
  undoStack.push({ message, onExpire, onUndo });

  // Past the cap the oldest is no longer offerable, so make it permanent.
  while (undoStack.length > UNDO_STACK_LIMIT) {
    commitUndoEntry(undoStack.shift());
  }

  showTopUndo();
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

  const entry = undoStack.pop();
  if (entry && typeof entry.onUndo === "function") entry.onUndo();

  /* Re-offer the previous action rather than dropping it. Without this the
     stack would still hold it but nothing would ever show it again, which is
     the single-slot bug wearing a different hat. */
  if (undoStack.length > 0) showTopUndo();
  else hideUndo();
});

/* =========================
   HEADER
========================= */

/* The line under the title. Purely for orientation - it tells you which
   stretch of days you are looking at and is wired into nothing, so it can
   show real dates rather than a month name.

   On the 1st it stays "August 2026", because a range would only restate what
   the month name already says. On any other start day it shows the actual
   span, with both years spelled out when the cycle crosses New Year. */
function cycleLabel(startDate, endDate) {
  const s = new Date(startDate + "T00:00:00");
  const e = new Date(endDate + "T00:00:00");

  if (settings.monthStartDay === 1) {
    return s.toLocaleString("default", { month: "long", year: "numeric" });
  }

  const sameYear = s.getFullYear() === e.getFullYear();
  const from = s.toLocaleString("default",
    sameYear ? { day: "numeric", month: "short" }
             : { day: "numeric", month: "short", year: "numeric" });
  const to = e.toLocaleString("default", { day: "numeric", month: "short", year: "numeric" });
  return `${from} – ${to}`;
}

/* "5 Aug – 4 Sep 2026 · 31 days" for a history row. Takes the stored
   cycleNext rather than a chosen day, so an archived month reports the span
   it really ran, not the span today's setting would give it. */
function dayRangeLabel(cycleStart, cycleNext) {
  const s = new Date(cycleStart + "T00:00:00");
  const n = new Date(cycleNext + "T00:00:00");
  const end = new Date(n);
  end.setDate(end.getDate() - 1);

  const days = Math.round((n - s) / 86400000);
  const sameYear = s.getFullYear() === end.getFullYear();
  const from = s.toLocaleString("default",
    sameYear ? { day: "numeric", month: "short" }
             : { day: "numeric", month: "short", year: "numeric" });
  const to = end.toLocaleString("default", { day: "numeric", month: "short", year: "numeric" });
  return `${from} – ${to} · ${days} days`;
}

function renderMonthLabel() {
  monthText.textContent = cycleLabel(
    data.cycleStart,
    cycleEndOf(data.cycleStart, settings.monthStartDay)
  );
}

renderMonthLabel();

/* If anything was unreadable at load, say so once.

   The app has already carried on with defaults, so staying silent would look
   exactly like the data simply vanishing - and the user would have no reason
   to suspect a recoverable copy is still there. Deferred a tick so the first
   paint happens before the dialog blocks it. */
if (corruptKeys.length > 0) {
  setTimeout(() => {
    const names = corruptKeys
      .map(k => k.replace(BACKUP_PRIORITY_KEY, "saved priority bills")
                 .replace(ARCHIVE_KEY, "history")
                 .replace(SETTINGS_KEY, "settings")
                 .replace(STORAGE_KEY, "this month"))
      .map(n => `  - ${n}`)
      .join("\n");
    alert(
      "Some saved data could not be read and has been skipped:\n\n" + names +
      "\n\nThe app has started with the rest. The unreadable copy was kept, " +
      "not overwritten, so nothing is lost yet - export your data before " +
      "making changes."
    );
  }, 0);
}

/* =========================
   INCOME (WORKING)
========================= */

/* Renders the income display: everything available to spend this month,
   carried balance included.

   This shows totalIncomeOf unmodified, which is the same figure the donut
   divides up and the spend bar measures against. An earlier version
   subtracted the carried amount back out so the card meant "earned this
   month", but that made the top of the screen contradict itself - the chart
   apportioning 1,095.97 directly beneath a card reading 0.00. One number,
   one meaning.

   Where the carried part came from is answered in the histories, which open
   with a "Brought forward" row, rather than by making this figure mean
   something different from every other total on screen.

   Tapping the card still edits only the typed income - the carried amount and
   any Second choice earnings are added on top and are not editable here. */
function renderIncome() {
  const total = totalIncomeOf(data, allWallets());
  incomeDisplay.textContent = total !== null ? `${cur()} ${fmt(total)}` : `${cur()} 0`;
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
/* Loads a priority bill into the form above the list.

   Only while the list is unlocked. The lock exists precisely to freeze the
   month's bills, so allowing an edit through it would defeat it - and the
   form is hidden in that state anyway. `paid` is untouched: editing a bill is
   not the same as ticking it. */
function editPriorityBill(bill) {
  if (data.priorityLocked || !isEditable(bill)) return;
  cancelEdit();

  const pbName = document.getElementById("pb-name");
  const pbCategory = document.getElementById("pb-category");
  const pbAmount = document.getElementById("pb-amount");
  const root = document.getElementById("priority-form");

  pbName.value = bill.name;
  /* Re-offer the bill's own category even if it has since been removed from
     the list, marked "(removed)". Without this the select would fall back to
     the empty prompt and an otherwise untouched save would silently
     recategorise the bill. */
  renderCategoryOptions(pbCategory, "priority", bill.category);
  pbAmount.value = bill.amount;

  editing = {
    item: bill, root,
    clear() {
      pbName.value = "";
      renderCategoryOptions(pbCategory, "priority");
      pbAmount.value = "";
    },
    save() {
      const name = pbName.value.trim();
      const category = pbCategory.value;
      const amount = Number(pbAmount.value);
      const fields = [
        { el: pbName, valid: !!name },
        { el: pbCategory, valid: !!category },
        { el: pbAmount, valid: isValidAmount(amount) }
      ];
      let bad = false;
      fields.forEach(f => {
        if (!f.valid) { f.el.classList.add("input-error"); bad = true; }
        else f.el.classList.remove("input-error");
      });
      if (bad) return false;

      bill.name = name;
      bill.category = category;
      bill.amount = amount;
      saveData();
      renderPriority();
      calculateRemaining();
      return true;
    }
  };
  setFormEditing(root, true);
  pbName.focus();
}

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

  /* Tapping the row opens it for editing. The checkbox and its label own their
     own clicks - makeRowEditable ignores anything originating in a control -
     so ticking a bill never opens the form. */
  makeRowEditable(li, bill, () => editPriorityBill(bill));

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
      cancelEditIfEditing(bill);
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
/* Reflects the lock in both directions.
 *
 * This only ever hid the form before, never restored it, because the lock had
 * no way out short of the hidden full reset. Now that unlocking exists it has
 * to be symmetric - an else branch that never ran is exactly how a one-way
 * door gets built by accident. */
function updatePriorityLockUI() {
  const form = document.getElementById("priority-form");
  const lockBadge = document.getElementById("priority-lock-badge");
  if (data.priorityLocked) {
    if (form) form.style.display = "none";
    if (lockBadge) lockBadge.classList.remove("hidden");
  } else {
    if (form) form.style.display = "";
    if (lockBadge) lockBadge.classList.add("hidden");
  }
}

/* Which direction the shared confirm modal was opened in. */
let priorityLockIntent = "lock";

const priorityModalTitle = document.getElementById("priority-modal-title");
const priorityModalText = document.getElementById("priority-modal-text");
const priorityLockBadge = document.getElementById("priority-lock-badge");

function openPriorityModal(intent) {
  priorityLockIntent = intent;
  if (intent === "unlock") {
    priorityModalTitle.textContent = "Unlock Priority Bills?";
    priorityModalText.textContent =
      "You'll be able to add, edit and delete bills again. Nothing already recorded changes, and you can lock the list again afterwards.";
    confirmPriorityBtn.textContent = "Yes, Unlock";
  } else {
    priorityModalTitle.textContent = "Save Priority Bills?";
    priorityModalText.textContent =
      "Are you sure? Once saved, the list is locked so it cannot be changed by accident.";
    confirmPriorityBtn.textContent = "Yes, Save";
  }
  priorityModal.classList.remove("hidden");
}

savePriorityBtn.addEventListener("click", () => {
  if (data.priority.length === 0) return;
  openPriorityModal("lock");
});

if (priorityLockBadge) {
  priorityLockBadge.addEventListener("click", () => openPriorityModal("unlock"));
}

cancelPriorityBtn.addEventListener("click", () => {
  priorityModal.classList.add("hidden");
});

confirmPriorityBtn.addEventListener("click", () => {
  data.priorityLocked = priorityLockIntent !== "unlock";
  saveData();
  priorityModal.classList.add("hidden");
  renderPriority();
  updatePriorityLockUI();
  // "Copy Last Priority" is only offered on an empty, unlocked list.
  updateCopyLastBtn();
});

addPriorityBtn.addEventListener("click", () => {
  if (data.priorityLocked) return;

  // While editing, the primary button saves rather than adding a second bill.
  if (editing && editing.root === document.getElementById("priority-form")) {
    if (editing.save()) cancelEdit();
    return;
  }

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
const backupPriority = load(BACKUP_PRIORITY_KEY, null);

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
function getWalletAllocated(id) { return walletAllocatedOf(ensureWalletData(id)); }
function getWalletUsed(id) { return walletUsedOf(ensureWalletData(id)); }

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
  cancelEditIfEditing(item);
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
/* The pinned opening row of a history: money brought in from last month.

   DISPLAY ONLY, and that distinction is the whole safety of it. The amount is
   already counted - in data.carryOver for the maths, and in the wallet's
   opening budget for the balance - so writing it as a real entry would count
   the same money twice and break the invariant. It is therefore built here at
   render time, stored nowhere, and deliberately not deletable: there is no
   transaction behind it to delete.

   Always first, whatever the sort order, because it is where the money in
   this list came from rather than something that happened during the month. */
function buildCarriedRow(amount, columnCount) {
  const row = document.createElement("tr");
  row.className = "carried-row";
  const spacer = columnCount === 4 ? "<td></td>" : "";
  row.innerHTML = `
    <td>Brought forward</td>
    ${spacer}
    <td class="date-stamp">last month</td>
    <td>+ ${esc(cur())} ${fmt(amount)}</td>
  `;
  return row;
}

function buildWalletItemRow(item, wallet, tbody, section) {
  const row = document.createElement("tr");

  let label = esc(item.name);
  if (item.type === "out") {
    label = `${esc(item.name)} → ${esc(transferPartyName(item.toId, item.toName))}`;
  } else if (item.type === "in") {
    label = `${esc(item.name)} ← ${esc(transferPartyName(item.fromId, item.fromName))}`;
  }

  row.innerHTML = `
    <td>${label}</td>
    ${dateCellHtml(item.date)}
    <td>${isWalletInflow(item) ? "+" : "-"} ${esc(cur())} ${fmt(item.amount)}</td>
  `;

  if (wallet) {
    makeRowDeletable(row, () => deleteWalletItem(wallet, item, tbody, section));
    /* The section owns the form this row edits in, so the handler is attached
       there and reached through the section rather than from here. */
    if (section && section._editItem) makeRowEditable(row, item, () => section._editItem(item));
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
    /* Reset on every touch so tap-to-edit can tell a tap from the tail of a
       drag. Read by makeRowEditable, which ignores a click that followed any
       real movement. */
    row._swipeMoved = false;
    row.style.transition = "none";
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (!active) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;
    if (Math.abs(mx) > 6 || Math.abs(my) > 6) row._swipeMoved = true;
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

  // Money this wallet reopened holding, shown as its opening line.
  const carried = carryInOf(data).wallets[wallet.id] || 0;
  if (carried > 0) tbody.appendChild(buildCarriedRow(carried, 3));

  if (wd.items.length === 0) {
    // The opening line alone is still a history worth showing.
    if (carried <= 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No items yet.</td></tr>';
    }
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
  const allocated = getWalletAllocated(wallet.id);

  if (!allocated || allocated <= 0) {
    wrapper.classList.add("hidden");
    return;
  }

  wrapper.classList.remove("hidden");
  const used = getWalletUsed(wallet.id);
  const pct = Math.min(Math.max((used / allocated) * 100, 0), 100);

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
        <button data-role="add-btn" data-edit="primary" aria-label="Add money to ${esc(wallet.name)}">+ Add</button>
        <button data-role="take-btn" data-edit="hide-while-editing" aria-label="Take money from ${esc(wallet.name)}">- Take</button>
        <button data-role="cancel-edit" data-edit="cancel" class="hidden" aria-label="Cancel editing this item">Cancel</button>
      </div>
      <button data-role="transfer-btn" data-edit="hide-while-editing" class="transfer-btn" aria-label="Transfer money from ${esc(wallet.name)}">Transfer</button>
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

    /* Taking more than the wallet holds would push its balance negative, which
       the books cannot represent. Rather than a bare red border, offer the
       ways to make it legal - top up from main, or from another wallet. */
    if (type === "take" && amount > getWalletBalance(wallet.id)) {
      askWalletShortfall({
        wallet,
        amount,
        available: getWalletBalance(wallet.id),
        transferName: name,
        // Every option above rebuilds the sections, so the cached nodes this
        // closure holds are detached - commit with `rebuilt` set.
        proceed: () => commitItem(type, name, amount, dateValue, true),
        onCancel: () => amountInput.classList.add("input-error")
      });
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

  /* Loads a wallet item into this section's own form. Each wallet has its own
     form, so the edit is scoped to the section the row belongs to. */
  function editItem(item) {
    if (!isEditable(item)) return;
    cancelEdit();

    const form = section.querySelector(".wallet-form");
    nameInput.value = item.name;
    amountInput.value = item.amount;
    dateInput.value = dateInputValue(item.date);
    dateInput.classList.toggle("is-empty", !dateInput.value);

    editing = {
      item, root: form,
      clear() {
        nameInput.value = ""; amountInput.value = "";
        dateInput.value = ""; dateInput.classList.add("is-empty");
      },
      save() {
        const name = nameInput.value.trim();
        const amount = Number(amountInput.value);
        const fields = [
          { el: nameInput, valid: !!name },
          { el: amountInput, valid: isValidAmount(amount) }
        ];
        let bad = false;
        fields.forEach(f => {
          if (!f.valid) { f.el.classList.add("input-error"); bad = true; }
          else f.el.classList.remove("input-error");
        });
        if (bad) return false;

        /* The take cap has to be re-checked against the balance WITHOUT this
           item, otherwise its own current amount counts against the headroom
           and an unchanged edit would be rejected. */
        if (item.type === "take") {
          const balanceExcludingThis = getWalletBalance(wallet.id) + Number(item.amount);
          if (amount > balanceExcludingThis) {
            amountInput.classList.add("input-error");
            return false;
          }
        }

        item.name = name;
        item.amount = amount;
        item.date = resolveDate(dateInput.value);
        saveData();
        renderWallets();
        calculateRemaining();
        return true;
      }
    };
    setFormEditing(form, true);
    nameInput.focus();
  }

  section._editItem = editItem;
  section.querySelector("[data-role='cancel-edit']").addEventListener("click", cancelEdit);

  section.querySelector("[data-role='add-btn']").addEventListener("click", () => {
    const form = section.querySelector(".wallet-form");
    if (editing && editing.root === form) {
      if (editing.save()) cancelEdit();
      return;
    }
    addItem("add");
  });
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

/* Taking more than a wallet holds.
 *
 * The main balance has askOverspend, which can always fall back to "record it
 * anyway" because a negative Remaining is a real, representable state. A
 * wallet has no equivalent: a negative wallet balance cannot be drawn in the
 * donut, and would make `inWallets` meaningless. So this offers the ways to
 * make the take legal rather than the way to force it through - top the
 * wallet up first, then spend.
 *
 * Until now this case was a bare red border with no explanation, and the only
 * route forward was to work out for yourself that the budget had to be raised.
 */
function askWalletShortfall({ wallet, amount, available, transferName, proceed, onCancel }) {
  const shortfall = Math.round((amount - available) * 100) / 100;

  overspendSummary.textContent =
    `Taking ${cur()} ${fmt(amount)} is ${cur()} ${fmt(shortfall)} more than the ${cur()} ${fmt(available)} in ${wallet.name}. Top it up first:`;
  overspendOptions.innerHTML = "";

  // Straight from main, as a wallet `add` - the same thing the + Add button
  // writes, so it is deducted from Remaining exactly once.
  const mainAvailable = getMainRemaining();
  if (mainAvailable >= shortfall) {
    const fromMain = document.createElement("button");
    fromMain.className = "transfer-dest-btn";
    fromMain.setAttribute("aria-label", "Top up from the main balance");
    fromMain.innerHTML = `Add ${esc(cur())} ${fmt(shortfall)} from main balance` +
      `<span class="transfer-dest-sub">You have ${esc(cur())} ${fmt(mainAvailable)} left. Remaining drops to ${esc(cur())} ${fmt(mainAvailable - shortfall)}.</span>`;
    fromMain.addEventListener("click", () => {
      closeOverspend();
      ensureWalletData(wallet.id).items.push({
        name: `Top up for ${transferName}`, amount: shortfall, type: "add", date: new Date().toISOString()
      });
      saveData();
      proceed();
    });
    overspendOptions.appendChild(fromMain);
  }

  /* Or from another wallet that can cover it in full - a real linked transfer,
     so deleting either half removes both. Only full covers are offered, for
     the same reason askOverspend does: a partial one leaves the take still
     illegal and the user no further forward. */
  walletsCovering(data, allWallets().filter(w => w.id !== wallet.id), shortfall)
    .forEach(({ wallet: source, balance }) => {
      const btn = document.createElement("button");
      btn.className = "transfer-dest-btn";
      btn.setAttribute("aria-label", `Move the shortfall from ${source.name}`);
      btn.innerHTML = `Move ${esc(cur())} ${fmt(shortfall)} from ${esc(source.name)}` +
        `<span class="transfer-dest-sub">Has ${esc(cur())} ${fmt(balance)}. Transfers straight into ${esc(wallet.name)}.</span>`;
      btn.addEventListener("click", () => {
        closeOverspend();
        executeTransfer(source, wallet.id, `Top up for ${transferName}`, shortfall, new Date().toISOString());
        proceed();
      });
      overspendOptions.appendChild(btn);
    });

  // Nothing anywhere can cover it - say so, rather than showing only Cancel.
  if (!overspendOptions.children.length) {
    const none = document.createElement("p");
    none.className = "transfer-dest-sub";
    none.textContent = "Nothing else has enough to cover it. Raise this wallet's budget, or take a smaller amount.";
    overspendOptions.appendChild(none);
  }

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
  cancelEditIfEditing(item);
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
/* Makes a row open in its form when tapped.

   Rows already carry swipe-to-delete and a double-click delete fallback, so
   this has to distinguish a tap from the end of a drag. makeRowDeletable
   records how far the finger travelled on `_swipeMoved`; anything that moved
   is a gesture, not a tap.

   A row with no editable entry behind it - a transfer half, a carried-forward
   line - simply does not get the handler, so it stays inert rather than
   opening a form that could not save. */
function makeRowEditable(row, item, onEdit) {
  if (!isEditable(item)) return;
  row.classList.add("row-editable");
  row.addEventListener("click", (e) => {
    if (row._swipeMoved) return;
    // The checkbox on a priority row owns its own click.
    if (e.target.closest("input, button, a")) return;
    onEdit();
  });
}

function buildSecondChoiceRow(item) {
  const row = document.createElement("tr");
  // Mark money that came back, so months later it is clear which additions
  // were repayments rather than earnings
  const mark = isReimbursement(item)
    ? ' <span class="returned-mark" title="Money coming back, not income">&#8617;</span>'
    : "";

  row.innerHTML = `
    <td>${esc(item.name)}${mark}</td>
    <td>${esc(item.category)}</td>
    ${dateCellHtml(item.date)}
    <td>${item.type === "add" ? "+" : "-"} ${esc(cur())} ${fmt(item.amount)}</td>
  `;
  makeRowDeletable(row, () => deleteSecondChoiceItem(item));
  makeRowEditable(row, item, () => editSecondChoice(item));
  return row;
}

// Renders the second choice transactions table
function renderSecondChoice() {
  scTable.innerHTML = "";

  // Second choice is the main balance's history, so main's share of the
  // carried money opens it.
  const carried = carryInOf(data).main;
  if (carried > 0) scTable.appendChild(buildCarriedRow(carried, 4));

  if (data.secondChoice.length === 0) {
    if (carried <= 0) {
      scTable.innerHTML = '<tr><td colspan="4" class="empty-state">No transactions yet.</td></tr>';
    }
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
/* =========================
   EDITING AN ENTRY
========================= */

/* What is currently being edited, or null.

   `item` is the stored object itself, not an index. Positions shift when
   anything earlier is deleted - the same trap that once made priority deletion
   remove the wrong bill - so the entry is held by identity and written to in
   place, which also keeps it where it is in the list.

   Editing reuses the form that created the entry rather than adding a second
   one, so there is exactly one place that knows how to validate a bill, a
   wallet item, or a Second choice row. */
let editing = null;

/* Not everything in a table is editable.

   A transfer half cannot be: its amount is mirrored in a twin sharing a txId,
   and changing one without the other would create or destroy money - while
   changing both could drive the destination wallet negative, a state the app
   has no way to show. Deleting a transfer already removes both halves
   atomically, so delete-and-redo stays the way to change one.

   A carried-forward row cannot be either: there is no transaction behind it. */
function isEditable(item) {
  return !!item && !item.txId && !isTransferEntry(item);
}

// Formats a stored timestamp for a date input, which needs exactly YYYY-MM-DD.
function dateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* Puts a form into edit mode: primary button becomes Save, everything else
   that would create a NEW entry is hidden so there is no way to add one while
   an edit is open, and a Cancel appears. */
function setFormEditing(root, on, saveLabel = "Save changes") {
  const primary = root.querySelector("[data-edit='primary']");
  const others = root.querySelectorAll("[data-edit='hide-while-editing']");
  const cancel = root.querySelector("[data-edit='cancel']");

  if (primary) {
    if (on) {
      if (primary.dataset.originalLabel === undefined) primary.dataset.originalLabel = primary.textContent;
      primary.textContent = saveLabel;
    } else if (primary.dataset.originalLabel !== undefined) {
      primary.textContent = primary.dataset.originalLabel;
    }
  }
  others.forEach(el => el.classList.toggle("hidden", on));
  if (cancel) cancel.classList.toggle("hidden", !on);
  root.classList.toggle("is-editing", on);
}

// Leaves edit mode without writing anything, and clears the form.
function cancelEdit() {
  if (!editing) return;
  const { root, clear } = editing;
  editing = null;
  if (clear) clear();
  if (root) setFormEditing(root, false);
}

/* Called whenever an entry is deleted or the month is rebuilt. An edit whose
   target no longer exists would otherwise write to an orphaned object on save,
   silently doing nothing. */
function cancelEditIfEditing(item) {
  if (editing && editing.item === item) cancelEdit();
}

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
/* Loads a Second choice entry into the form above it.

   The type is deliberately NOT changeable here: an add and a take are
   different transactions, and flipping one into the other silently would move
   money in a direction the user never asked for. Same for newMoney - a
   reimbursement stays a reimbursement, and the question is not re-asked. */
function editSecondChoice(item) {
  if (!isEditable(item)) return;
  cancelEdit();

  scName.value = item.name;
  // Keeps the entry's own category selectable even if it was removed since -
  // see the matching comment in editPriorityBill.
  renderCategoryOptions(scCategory, "secondChoice", item.category);
  scAmount.value = item.amount;
  scDate.value = dateInputValue(item.date);
  scDate.classList.toggle("is-empty", !scDate.value);

  const root = document.getElementById("second-choice-form");
  editing = {
    item, root,
    clear() {
      scName.value = "";
      renderCategoryOptions(scCategory, "secondChoice");
      scAmount.value = ""; scDate.value = ""; scDate.classList.add("is-empty");
    },
    save() {
      const form = readSecondChoiceForm();
      if (!form) return false;
      /* Written in place so the entry keeps its position in the list and its
         identity - deletion resolves rows by object, not index. */
      item.name = form.name;
      item.category = form.category;
      item.amount = form.amount;
      item.date = resolveDate(scDate.value);
      saveData();
      renderSecondChoice();
      calculateRemaining();
      return true;
    }
  };
  setFormEditing(root, true);
  scName.focus();
}

addMoneyBtn.addEventListener("click", () => {
  // While editing, the primary button saves rather than creating a new entry.
  if (editing && editing.root === document.getElementById("second-choice-form")) {
    if (editing.save()) cancelEdit();
    return;
  }
  const form = readSecondChoiceForm();
  if (!form) return;
  sourceSummary.textContent = `Adding ${cur()} ${fmt(form.amount)} - is this new money, or money coming back to you?`;
  sourceModal.classList.remove("hidden");
});

document.getElementById("cancel-sc-edit").addEventListener("click", cancelEdit);
document.getElementById("cancel-priority-edit").addEventListener("click", cancelEdit);

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
/* Balance now against balance once every outstanding bill is ticked, plus the
   dim bar segment that shows the same thing.

   Hidden entirely when nothing is owed, because the two figures are then
   identical and repeating them says nothing. It reappears the moment a bill
   is unticked.

   Nothing here moves money. The projection is a forecast, so the real bar and
   the real figure above are left exactly as they are and the projection is
   drawn behind them. */
function renderProjection() {
  const line = document.getElementById("projection-line");
  const bar = document.getElementById("spend-bar-projected");
  if (!line || !bar) return;

  const owed = unpaidPriorityOf(data);
  if (monthIsUnset(data) || owed <= 0) {
    line.classList.add("hidden");
    bar.classList.add("hidden");
    return;
  }

  const remaining = getMainRemaining();
  const projected = projectedRemainingOf(data, allWallets());

  line.innerHTML =
    `<span class="projection-part">Balance ${esc(cur())} ${fmt(remaining)}</span>` +
    `<span class="projection-sep">·</span>` +
    `<span class="projection-part is-projected">Projected Balance ${
      projected < 0
        ? `overspent by ${esc(cur())} ${fmt(-projected)}`
        : `${esc(cur())} ${fmt(projected)}`
    }</span>`;
  line.classList.remove("hidden");

  /* The dim segment reaches the point the bar WILL sit at once the bills are
     paid, measured on the same scale as the real fill so the two line up.
     Clamped to 100%: a projection past the income has nowhere further to go
     on the bar, and the figure beside it already says overspent. */
  const income = totalIncomeOf(data, allWallets());
  if (!income || income <= 0) {
    bar.classList.add("hidden");
    return;
  }
  const projectedPct = Math.min(Math.max(((income - projected) / income) * 100, 0), 100);
  bar.style.width = `${projectedPct}%`;
  bar.classList.remove("hidden");
}

function calculateRemaining(skipChart = false) {
  renderIncome();
  renderProjection();

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

  // Logical drawing size, density-corrected. Null means nothing is on screen.
  const box = fitCanvas(canvas, ctx);
  if (!box) return;
  // The donut is square; the shorter side keeps it circular in any box.
  const size = Math.min(box.w, box.h);

  const income = totalIncomeOf(data, allWallets()) || 0;
  if (income === 0) {
    ctx.clearRect(0, 0, box.w, box.h);
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
      color: walletColorMap[label] || categoryColor(label),
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
if (settings.showChart) {
  chartSection.classList.remove("hidden");
  /* Draw only now that the section has a layout box. calculateRemaining()
     above already called renderChart() once, but the section was still
     hidden at that point, so fitCanvas() had a zero-sized rect to measure
     and correctly declined to draw into it. */
  renderChart();
}

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

/* =========================
   MONTH START DAY
========================= */

/* The dropdown of 1-31. A dropdown rather than a number field because this is
   used on a phone and a mistyped "3" instead of "31" would silently move the
   whole budget cycle. */
const monthStartSelect = document.getElementById("month-start-select");
const monthStartNote = document.getElementById("month-start-note");

/* Ordinal suffix - 1st, 2nd, 3rd, 21st. The 11-13 exception is why this is
   not just a lookup on the last digit. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

/* When a chosen start day would first take effect.

   The next start is always in the calendar month AFTER the current cycle
   began, so it is normally in the future. It can land in the past in one
   case: a long cycle running into the next calendar month, where picking an
   earlier day names a date already gone. Rolling over to it would archive
   the month on screen the moment the setting changed, which is exactly what
   "applies next month, not this one" rules out - so it is pushed on a
   further month. */
function startDayTakesEffect(chosenDay) {
  let next = nextCycleStartOf(data.cycleStart, chosenDay);
  if (next <= todayStr) next = nextCycleStartOf(next, chosenDay);
  return next;
}

/* Shows the note whenever the chosen day has not taken effect yet.

   The test is against the day the CURRENT CYCLE actually began, not against
   settings.monthStartDay - the setting is written the moment the dropdown
   changes, so comparing the two would always find them equal and the note
   would never appear. It also survives a reload, which comparing to the
   dropdown would not.

   Clamping is applied before comparing: a cycle that opened on 28 February
   under a chosen 31st HAS taken effect, and must not be reported as pending. */
function renderMonthStartNote() {
  if (!monthStartNote || !data.cycleStart) return;
  const { y, m, d } = (() => {
    const [yy, mm, dd] = data.cycleStart.split("-").map(Number);
    return { y: yy, m: mm, d: dd };
  })();
  const effectiveNow = clampStartDay(y, m, settings.monthStartDay);

  if (d === effectiveNow) {
    monthStartNote.classList.add("hidden");
    return;
  }

  const from = new Date(data.cycleNext + "T00:00:00");
  monthStartNote.textContent =
    `Applies from ${from.toLocaleString("default", { day: "numeric", month: "short", year: "numeric" })}. ` +
    `This month is unchanged.`;
  monthStartNote.classList.remove("hidden");
}

renderMonthStartNote();

if (monthStartSelect) {
  for (let d = 1; d <= 31; d++) {
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = ordinal(d);
    monthStartSelect.appendChild(opt);
  }
  monthStartSelect.value = String(settings.monthStartDay);

  monthStartSelect.addEventListener("change", () => {
    const chosen = Number(monthStartSelect.value);
    const effective = startDayTakesEffect(chosen);

    settings.monthStartDay = chosen;
    saveSettings();

    /* The cycle on screen keeps the start date it was created with; only the
       date it ends on moves. That is the whole reason cycleStart is stored
       rather than recomputed - the month being looked at can never be
       re-cut underneath the user. */
    data.cycleNext = effective;
    saveData();

    renderMonthLabel();
    renderMonthStartNote();
  });
}

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

/* Was a hardcoded list of the five built-in categories. Now derived, because
   categories are user-editable: a wallet must not take the name of ANY
   category currently offered, including one the user just added, or the two
   would merge into a single chart slice. */
function reservedCategoryNames() {
  return allCategoryNames().map(c => c.trim().toLowerCase());
}

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
  if (reservedCategoryNames().includes(norm)) return "reserved";
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

/* =========================
   CATEGORY SETTINGS

   Two editable lists, one per entry form. Adding is the common case; removing
   only takes a category out of the dropdown and deliberately leaves every
   entry already filed under it untouched, because rewriting them would change
   figures the user has already checked - including in archived months, which
   are supposed to be a record of what happened.
========================= */

const CATEGORY_LIST_LABELS = { priority: "Bill", secondChoice: "Spending" };

const addCategoryModal = document.getElementById("add-category-modal");
const addCategoryTitle = document.getElementById("add-category-title");
const addCategoryNameInput = document.getElementById("add-category-name");
const addCategoryError = document.getElementById("add-category-error");
const confirmAddCategoryBtn = document.getElementById("confirm-add-category");
const cancelAddCategoryBtn = document.getElementById("cancel-add-category");

const deleteCategoryModal = document.getElementById("delete-category-modal");
const deleteCategoryText = document.getElementById("delete-category-text");
const confirmDeleteCategoryBtn = document.getElementById("confirm-delete-category");
const cancelDeleteCategoryBtn = document.getElementById("cancel-delete-category");

let categoryPendingDelete = null;   // { list, name }
let addCategoryTarget = "priority"; // which list the add modal is serving

/* Why a name cannot be used: empty, already in this list, or taken by a
   wallet. The wallet check mirrors walletNameConflict from the other
   direction - whichever is created second is the one refused. */
/* `exclude` is the name being renamed away from, so re-saving a row without
   really changing it is not reported as a duplicate of itself. */
function categoryNameConflict(list, name, exclude) {
  const norm = name.trim().toLowerCase();
  if (!norm) return "empty";
  const skip = exclude ? exclude.trim().toLowerCase() : null;
  if ((settings.categories[list] || [])
      .some(c => c.trim().toLowerCase() === norm && c.trim().toLowerCase() !== skip)) return "duplicate";
  if (activeWallets().some(w => w.name.trim().toLowerCase() === norm)) return "wallet";
  return null;
}

// How many entries in the live month still reference a category.
function categoryUsageCount(list, name) {
  if (list === "priority") {
    return (data.priority || []).filter(b => b.category === name).length;
  }
  return (data.secondChoice || []).filter(i => i.category === name).length;
}

/* Renames a category and re-files this month's entries under the new name.
 *
 * Categories are raw strings, not ids - the chart keys its slices by name and
 * every entry stores the name it was given. So a rename that only touched the
 * settings list would orphan every entry already filed under the old one:
 * they would keep counting, under a label no dropdown offers any more.
 *
 * The LIVE month is rewritten; the archive deliberately is not. Archived
 * months already snapshot wallet names and the currency as they were at
 * close, and a past month is a record of what happened - it was called that
 * at the time. No figure moves either way: a rename changes a label, never an
 * amount, so the invariant is untouched in both.
 *
 * Returns the number of entries re-filed, for the confirmation message.
 */
function renameCategory(list, from, to) {
  if (from === to) return 0;
  let moved = 0;

  const arr = settings.categories[list] || [];
  const at = arr.indexOf(from);
  if (at === -1) return 0;
  arr[at] = to;

  const entries = list === "priority" ? (data.priority || []) : (data.secondChoice || []);
  entries.forEach(e => {
    if (e.category === from) { e.category = to; moved++; }
  });

  saveSettings();
  if (moved) saveData();
  return moved;
}

function renderCategorySettings(list) {
  const listEl = document.getElementById(`cat-${list}-list`);
  const countEl = document.getElementById(`cat-${list}-count`);
  if (!listEl) return;

  const names = settings.categories[list] || [];
  if (countEl) countEl.textContent = String(names.length);

  listEl.innerHTML = "";
  names.forEach(name => {
    const row = document.createElement("div");
    row.className = "wallet-setting-row";
    const isFallback = name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase();

    /* The colour chip shows exactly the colour the chart will use, so this
       list doubles as the chart's key. The name is an input rather than a
       label: renaming in place is the same gesture the wallet list uses, and
       it keeps the editor to one screen. The fallback is not renameable -
       monthTotalsOf files uncategorised entries under its literal name. */
    row.innerHTML = `
      <span class="category-chip" style="background:${esc(categoryColor(name))}"></span>
      ${isFallback
        ? `<span class="category-name">${esc(name)}</span>
           <span class="category-locked" title="Entries with no category are filed here">default</span>`
        : `<input type="text" class="setting-input-wide category-name-input" value="${esc(name)}" aria-label="Rename ${esc(name)}" />
           <button class="wallet-delete-btn" aria-label="Remove ${esc(name)}">✕</button>`}
    `;

    const input = row.querySelector(".category-name-input");
    if (input) {
      input.addEventListener("input", () => input.classList.remove("input-error"));
      input.addEventListener("blur", () => {
        const next = input.value.trim();
        if (!next || next === name) { input.value = name; return; }

        /* Checked against everything except itself, so re-saving an unchanged
           name is not reported as a duplicate of itself. */
        if (categoryNameConflict(list, next, name)) {
          input.classList.add("input-error");
          input.value = name;
          return;
        }

        const moved = renameCategory(list, name, next);
        renderAllCategoryOptions();
        renderCategorySettings(list);
        renderPriority();
        renderSecondChoice();
        calculateRemaining();
        if (moved) {
          showNotice(`Renamed to "${next}" - ${moved} ${moved === 1 ? "entry" : "entries"} updated`);
        }
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    }

    const del = row.querySelector(".wallet-delete-btn");
    if (del) {
      del.addEventListener("click", () => {
        categoryPendingDelete = { list, name };
        const used = categoryUsageCount(list, name);
        const parts = [`Remove "${name}" from the ${CATEGORY_LIST_LABELS[list].toLowerCase()} categories?`];
        if (used > 0) {
          parts.push(`${used} ${used === 1 ? "entry" : "entries"} this month stay filed under it and keep counting - only the dropdown loses it. Rename it instead if you want those moved.`);
        }
        parts.push("You can add it back at any time.");
        deleteCategoryText.textContent = parts.join(" ");
        deleteCategoryModal.classList.remove("hidden");
      });
    }

    listEl.appendChild(row);
  });
}

function renderAllCategorySettings() {
  renderCategorySettings("priority");
  renderCategorySettings("secondChoice");

  // The summary on the Settings row, so the count is visible without opening
  // the panel. Counts both lists together.
  const totalEl = document.getElementById("category-count");
  if (totalEl) {
    const n = allCategoryNames().length;
    totalEl.textContent = n === 1 ? "1 category" : `${n} categories`;
  }
}

/* The panel itself. Opened from Settings rather than living inline: two
   editable lists with rename fields is more than a settings row can hold. */
const categoryPanel = document.getElementById("category-panel");
const openCategoryPanelBtn = document.getElementById("open-category-panel-btn");
const closeCategoryPanelBtn = document.getElementById("close-category-panel");

if (openCategoryPanelBtn) {
  openCategoryPanelBtn.addEventListener("click", () => {
    renderAllCategorySettings();
    categoryPanel.classList.remove("hidden");
  });
}

function closeCategoryPanel() {
  /* Commit whichever rename field still has focus. Without this, typing a new
     name and tapping Done straight away would discard it - blur would fire
     after the panel had already gone. */
  if (document.activeElement && document.activeElement.classList.contains("category-name-input")) {
    document.activeElement.blur();
  }
  categoryPanel.classList.add("hidden");
}

if (closeCategoryPanelBtn) {
  closeCategoryPanelBtn.addEventListener("click", closeCategoryPanel);
}
// Tapping the backdrop closes it too, like the other panels.
if (categoryPanel) {
  categoryPanel.addEventListener("click", (e) => {
    if (e.target === categoryPanel) closeCategoryPanel();
  });
}

["priority", "secondChoice"].forEach(list => {
  const btn = document.getElementById(`add-cat-${list}-btn`);
  if (!btn) return;
  btn.addEventListener("click", () => {
    addCategoryTarget = list;
    addCategoryTitle.textContent = `Add ${CATEGORY_LIST_LABELS[list]} Category`;
    addCategoryNameInput.value = "";
    addCategoryNameInput.classList.remove("input-error");
    addCategoryError.classList.add("hidden");
    addCategoryModal.classList.remove("hidden");
    addCategoryNameInput.focus();
  });
});

function confirmAddCategory() {
  const list = addCategoryTarget;
  const name = addCategoryNameInput.value.trim();
  const conflict = categoryNameConflict(list, name);

  if (conflict === "empty") {
    addCategoryNameInput.classList.add("input-error");
    return;
  }
  if (conflict === "duplicate") {
    addCategoryError.textContent = `"${name}" is already in this list.`;
    addCategoryError.classList.remove("hidden");
    addCategoryNameInput.classList.add("input-error");
    return;
  }
  if (conflict === "wallet") {
    addCategoryError.textContent = `"${name}" is a wallet name. Its spending already has its own slice.`;
    addCategoryError.classList.remove("hidden");
    addCategoryNameInput.classList.add("input-error");
    return;
  }

  /* Inserted before the fallback so "Others" stays last, where a catch-all
     reads correctly, no matter how many are added. */
  const arr = settings.categories[list];
  const fallbackAt = arr.findIndex(c => c.toLowerCase() === FALLBACK_CATEGORY.toLowerCase());
  if (fallbackAt === -1) arr.push(name);
  else arr.splice(fallbackAt, 0, name);

  saveSettings();
  addCategoryModal.classList.add("hidden");
  renderAllCategoryOptions();
  renderCategorySettings(list);
}

confirmAddCategoryBtn.addEventListener("click", confirmAddCategory);
addCategoryNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmAddCategory(); });
addCategoryNameInput.addEventListener("input", () => {
  addCategoryNameInput.classList.remove("input-error");
  addCategoryError.classList.add("hidden");
});
cancelAddCategoryBtn.addEventListener("click", () => addCategoryModal.classList.add("hidden"));

cancelDeleteCategoryBtn.addEventListener("click", () => {
  deleteCategoryModal.classList.add("hidden");
  categoryPendingDelete = null;
});

confirmDeleteCategoryBtn.addEventListener("click", () => {
  if (!categoryPendingDelete) return;
  const { list, name } = categoryPendingDelete;

  settings.categories[list] = (settings.categories[list] || [])
    .filter(c => c !== name);
  saveSettings();

  deleteCategoryModal.classList.add("hidden");
  categoryPendingDelete = null;
  renderAllCategoryOptions();
  renderCategorySettings(list);
  /* The chart is unchanged - removing a category from a dropdown moves no
     money - but the settings list it mirrors has, so redraw for consistency. */
  renderChart();
});

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
// The two entry dropdowns hold no options in the markup - build them now.
renderAllCategoryOptions();
renderAllCategorySettings();

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
/* Import is the only place arbitrary data enters the app, so it is the only
   place that has to distrust what it is given.
 *
 * The month KEY matters as much as the contents. `data.month` is split and
 * parsed by the cycle migration, and a missing or malformed one produces a
 * cycleStart of "NaN-NaN-01" - a state no migration can repair, because every
 * later run reads it as already migrated. Rejecting it here is the only
 * chance to stop that.
 *
 * Anything checked here is checked because getting it wrong corrupts the books
 * or wedges the app, not merely because it looks untidy. Optional fields that
 * the app can safely default are left alone - carryOver and carryIn are
 * normalised by carryOverOf/carryInOf, and a missing cycleStart is filled in
 * by the migration, so none of those need to be present. */
const MONTH_KEY_RE = /^\d{4}-([1-9]|1[0-2])$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateImport(obj) {
  if (!obj || typeof obj !== "object") return "That file isn't valid JSON data.";

  const d = obj.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "That file has no month data in it.";

  // The key the whole archive and every migration is addressed by.
  if (!("month" in d)) return "That file's month is missing.";
  if (!MONTH_KEY_RE.test(String(d.month))) {
    return `That file's month ("${d.month}") isn't a valid month like 2026-8.`;
  }

  if (!("income" in d)) return "That file is missing the income field.";
  if (d.income !== null && !Number.isFinite(Number(d.income))) {
    return "That file's income isn't a number.";
  }

  if (!Array.isArray(d.priority)) return "That file is missing the priority bills list.";
  if (!Array.isArray(d.secondChoice)) return "That file is missing the Second choice list.";
  if (d.walletData && (typeof d.walletData !== "object" || Array.isArray(d.walletData))) {
    return "That file's wallet data is malformed.";
  }

  /* Cycle dates are optional - a file from before v1.18.0 has none, and the
     migration fills them in. But a PRESENT one has to be usable, because the
     rollover compares against it as a string and a malformed value would
     either never fire or fire immediately. */
  for (const field of ["cycleStart", "cycleNext"]) {
    if (d[field] !== undefined && !ISO_DATE_RE.test(String(d[field]))) {
      return `That file's ${field} isn't a valid date like 2026-08-01.`;
    }
  }
  if (d.cycleStart && d.cycleNext && d.cycleNext <= d.cycleStart) {
    return "That file's month ends before it starts.";
  }

  if (obj.settings && (typeof obj.settings !== "object" || Array.isArray(obj.settings))) {
    return "That file's settings are malformed.";
  }
  if (obj.settings && obj.settings.wallets !== undefined && !Array.isArray(obj.settings.wallets)) {
    return "That file's wallet list is malformed.";
  }

  if (obj.archive && (typeof obj.archive !== "object" || Array.isArray(obj.archive))) {
    return "That file's history is malformed.";
  }
  /* Every archive key is fed to monthLabel and the chronological sort. One bad
     key renders as "Invalid Date" and sorts unpredictably. */
  if (obj.archive) {
    const badKey = Object.keys(obj.archive).find(k => !MONTH_KEY_RE.test(k));
    if (badKey !== undefined) return `That file's history has an invalid month ("${badKey}").`;
    const badEntry = Object.keys(obj.archive).find(k => {
      const e = obj.archive[k];
      return !e || typeof e !== "object" || !e.data || typeof e.data !== "object";
    });
    if (badEntry !== undefined) return `That file's history entry for ${badEntry} is malformed.`;
  }

  if (obj.priorityBackup && !Array.isArray(obj.priorityBackup)) {
    return "That file's saved priority bills are malformed.";
  }
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
    priorityBackup: load(BACKUP_PRIORITY_KEY, null) || []
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
  // Density-corrected logical size; null when the history view is not on screen.
  const box = fitCanvas(trendCanvas, trendCtx);
  if (!box) return;
  const W = box.w;
  const H = box.h;
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
      const color = walletColorMap[label] || categoryColor(label);
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

  /* The days this month actually covered. Read from the record's own
     cycleStart/cycleNext rather than recomputed from the current setting, so
     history keeps telling the truth about months that ran on a different
     start day - including the odd-length one produced when the day changes.

     Absent on months archived before cycles existed; those all ran 1st to
     1st, and the month name already says so, so the line is simply omitted
     rather than guessing a span. */
  const spanLine = d.cycleStart && d.cycleNext
    ? `<span class="history-meta">${esc(dayRangeLabel(d.cycleStart, d.cycleNext))}</span>`
    : "";

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
      ${spanLine}
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

/* Resets data in place to avoid stale object references.

   EVERY field of the month has to be cleared here. Anything left behind
   survives the reset and reappears, which is exactly what happened when
   carryOver was added and this function was not updated: the month emptied
   but mainRemaining stayed at 0 + carryOver, so the balance came straight
   back and reset looked broken.

   carryOver is set to 0 rather than deleted on purpose. The back-fill
   migration treats an ABSENT carryOver as "not yet done" and would helpfully
   restore last month's balance on the next load - undoing the reset. Writing
   a real 0 marks the month as handled and makes the reset stick. */
function resetData() {
  data.month = currentMonthKey;
  data.income = null;
  data.carryOver = 0;
  data.carryIn = { main: 0, wallets: {} };
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

/* =========================
   LIVE CYCLE ROLLOVER

   The rollover at the top of this file runs once, at load. That was enough
   when the app was a page you opened; it is not enough for an installed PWA,
   which stays resident in memory for days. Left open across the start of a
   new cycle, `data` still pointed at the finished month, so every entry added
   after midnight was written into a month the user considered closed - with
   no error and nothing on screen to suggest it.

   This re-checks the date whenever the app comes back to the foreground, and
   performs the identical rollover without a reload.
========================= */

// A one-line toast with no action attached. Reuses the undo toast's markup,
// hiding the button and the draining bar - neither means anything here,
// because a rollover is not something the user can undo.
function showNotice(message) {
  if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }
  /* Anything still undoable belongs to the month that just closed, and the
     toast is about to be taken over by this notice - so commit it now rather
     than leave entries pending with nothing on screen offering them. */
  flushUndoStack();

  undoText.textContent = message;
  undoBtn.classList.add("hidden");
  undoBar.style.transition = "none";
  undoBar.style.width = "0%";
  undoToast.classList.remove("hidden", "fading");

  setTimeout(() => {
    undoToast.classList.add("fading");
    setTimeout(() => {
      undoToast.classList.add("hidden");
      undoToast.classList.remove("fading");
      undoBtn.classList.remove("hidden");
    }, 300);
  }, 4000);
}

/* Rolls the app forward if the cycle has ended since it was last checked.
   Returns true when a rollover actually happened. */
function checkCycleRollover() {
  if (!data || !data.cycleNext) return false;
  const today = todayString();
  if (today < data.cycleNext) return false;

  /* Abandon any half-finished edit first. Its target belongs to the month
     being archived, and saving afterwards would write into an object that is
     no longer part of the live month. */
  cancelEdit();

  const closedLabel = monthLabel(data.month);
  performRollover(today);
  currentMonthKey = data.month;

  // Everything on screen belongs to the month that just closed.
  renderMonthLabel();
  renderIncome();
  renderPriority();
  updatePriorityLockUI();
  updateCopyLastBtn();
  renderWallets();
  renderSecondChoice();
  calculateRemaining();

  // The history view, if it happens to be open, has gained a month.
  if (!historyView.classList.contains("hidden")) renderHistory();

  showNotice(`${closedLabel} closed - new month started`);
  return true;
}

/* Foreground transitions only. There is deliberately no timer: a phone
   suspends timers in a backgrounded app anyway, so the moment that actually
   matters is the user coming back to it. `pageshow` covers a restore from
   the back-forward cache, which fires no visibilitychange. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkCycleRollover();
});
window.addEventListener("pageshow", () => { checkCycleRollover(); });
window.addEventListener("focus", () => { checkCycleRollover(); });

/* Both charts size their backing store to the box they are drawn into, so a
   rotation or window resize leaves them scaled from the old dimensions. The
   canvases are the only thing here that cannot reflow on their own - every
   other element is CSS-driven - so a redraw is all this needs to do.
   Debounced, because resize fires continuously during an orientation change. */
let chartResizeTimer = null;
window.addEventListener("resize", () => {
  if (chartResizeTimer) clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => {
    chartResizeTimer = null;
    if (settings.showChart) renderChart();
    if (!historyView.classList.contains("hidden")) renderHistory();
  }, 150);
});
