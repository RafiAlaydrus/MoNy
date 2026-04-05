/* =========================
   STORAGE & MONTH SETUP
========================= */

const STORAGE_KEY = "monthly-money-tracker";
const SETTINGS_KEY = "monthly-money-tracker-settings";
const BACKUP_PRIORITY_KEY = "monthly-money-tracker-priority-backup";

const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
  keepData: false,
  showChart: false,
  currency: "RM",
  sortOrder: "newest",
  budgetLimit: null
};
// Ensure new keys exist for older saved settings
if (!settings.currency) settings.currency = "RM";
if (!settings.sortOrder) settings.sortOrder = "newest";
if (settings.budgetLimit === undefined) settings.budgetLimit = null;

let data = JSON.parse(localStorage.getItem(STORAGE_KEY));

if (!data) {
  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
    groceryBudget: null,
    groceryItems: [],
    secondChoice: []
  };
} else if (!settings.keepData && data.month !== currentMonthKey) {
  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
    groceryBudget: null,
    groceryItems: [],
    secondChoice: []
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Ensure grocery fields exist for older saved data
if (!data.groceryItems) data.groceryItems = [];
if (data.groceryBudget === undefined) data.groceryBudget = null;

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

const groceryCard = document.getElementById("grocery-card");
const groceryBudgetDisplay = document.getElementById("grocery-budget-display");
const groceryBudgetInput = document.getElementById("grocery-budget-input");
const grName = document.getElementById("gr-name");
const grAmount = document.getElementById("gr-amount");
const addGroceryBtn = document.getElementById("add-grocery");
const takeGroceryBtn = document.getElementById("take-grocery");
const groceryTable = document.getElementById("grocery-table");

const scName = document.getElementById("sc-name");
const scCategory = document.getElementById("sc-category");
const scAmount = document.getElementById("sc-amount");
const addMoneyBtn = document.getElementById("add-money");
const takeMoneyBtn = document.getElementById("take-money");
const scTable = document.getElementById("sc-table");

const chartCanvas = document.getElementById("summary-chart");
const chartCtx = chartCanvas ? chartCanvas.getContext("2d") : null;
const chartLegend = document.getElementById("chart-legend");

const CATEGORY_COLORS = {
  "Bills": "#e74c3c",
  "Subscription": "#e67e22",
  "Grocery": "#f1c40f",
  "Food / Drink": "#9b59b6",
  "Transport": "#1abc9c",
  "Others": "#7f8c8d",
};

function cur() { return settings.currency; }
function fmt(n) { return Number(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtInt(n) { return Number(n).toLocaleString("en"); }

/* =========================
   UNDO TOAST
========================= */

const undoToast = document.getElementById("undo-toast");
const undoText = document.getElementById("undo-text");
const undoBtn = document.getElementById("undo-btn");
const undoBar = document.getElementById("undo-bar");
let undoTimeout = null;
let undoCallback = null;

function showUndo(message, onExpire, onUndo) {
  // Clear any existing undo
  if (undoTimeout) { clearTimeout(undoTimeout); }

  undoText.textContent = message;
  undoToast.classList.remove("hidden", "fading");

  // Reset and animate bar
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

function renderIncome() {
  incomeDisplay.textContent =
    data.income !== null ? `${cur()} ${fmtInt(data.income)}` : `${cur()} 0`;
}

incomeCard.addEventListener("click", () => {
  incomeInput.classList.remove("hidden");
  incomeInput.value = data.income ?? "";
  incomeInput.focus();
});

function saveIncome() {
  const value = Number(incomeInput.value);

  if (!value || value <= 0) {
    incomeInput.classList.add("hidden");
    return;
  }

  data.income = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

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

function renderPriority() {
  priorityList.innerHTML = "";

  if (data.priority.length === 0) {
    priorityList.innerHTML = '<li class="empty-state">No priority bills added yet.</li>';
    return;
  }

  data.priority.forEach((bill, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "swipe-wrapper";

    const deleteLayer = document.createElement("div");
    deleteLayer.className = "swipe-delete-bg";
    deleteLayer.textContent = "Delete";

    const li = document.createElement("li");
    li.innerHTML = `
      <label style="display:flex; gap:8px;">
        <input type="checkbox" ${bill.paid ? "checked" : ""} />
        ${bill.name} (${bill.category})
      </label>
      <strong>${cur()} ${fmt(bill.amount)}</strong>
    `;

    li.querySelector("input").addEventListener("change", (e) => {
      bill.paid = e.target.checked;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      calculateRemaining();
    });

    // Swipe-to-delete (only when unlocked)
    if (!data.priorityLocked) {
      let startX = 0;
      let currentX = 0;
      let swiping = false;

      li.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        currentX = 0;
        swiping = true;
        li.style.transition = "none";
      }, { passive: true });

      li.addEventListener("touchmove", (e) => {
        if (!swiping) return;
        currentX = e.touches[0].clientX - startX;
        if (currentX < 0) {
          li.style.transform = `translateX(${Math.max(currentX, -120)}px)`;
        }
      });

      li.addEventListener("touchend", () => {
        swiping = false;
        li.style.transition = "transform 0.3s ease";
        if (currentX < -80) {
          li.style.transform = "translateX(-100%)";
          li.style.opacity = "0";
          wrapper.style.transition = "max-height 0.3s ease, opacity 0.3s ease";
          wrapper.style.maxHeight = "0";
          wrapper.style.overflow = "hidden";

          const removed = data.priority.splice(index, 1)[0];
          calculateRemaining();

          showUndo(
            `"${removed.name}" deleted`,
            () => {
              // Timer expired — persist deletion
              localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            },
            () => {
              // Undo — restore the bill
              data.priority.splice(index, 0, removed);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
              renderPriority();
              calculateRemaining();
            }
          );
        } else {
          li.style.transform = "translateX(0)";
        }
      }, { passive: true });
    }

    wrapper.appendChild(deleteLayer);
    wrapper.appendChild(li);
    wrapper.classList.add("item-enter");
    priorityList.appendChild(wrapper);
    requestAnimationFrame(() => wrapper.classList.add("item-enter-active"));
  });
}

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    { el: pbAmount, valid: !!amount },
  ];

  let hasError = false;
  fields.forEach(f => {
    if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
    else f.el.classList.remove("input-error");
  });
  if (hasError) return;

  data.priority.push({ name, category, amount, paid: false, date: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  pbName.value = "";
  pbCategory.selectedIndex = 0;
  pbAmount.value = "";
  fields.forEach(f => f.el.classList.remove("input-error"));

  renderPriority();
  calculateRemaining();
});

/* =========================
   COPY LAST PRIORITY
========================= */

const copyLastBtn = document.getElementById("copy-last-priority");
const backupPriority = JSON.parse(localStorage.getItem(BACKUP_PRIORITY_KEY));

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  copyLastBtn.classList.add("hidden");
  renderPriority();
  calculateRemaining();
});

updateCopyLastBtn();

/* =========================
   GROCERY
========================= */

function renderGroceryBudget() {
  groceryBudgetDisplay.textContent =
    data.groceryBudget !== null ? `${cur()} ${fmtInt(data.groceryBudget)}` : `${cur()} 0`;
}

groceryCard.addEventListener("click", (e) => {
  if (e.target === groceryBudgetInput) return;
  groceryBudgetInput.classList.remove("hidden");
  groceryBudgetInput.value = data.groceryBudget ?? "";
  groceryBudgetInput.focus();
});

function saveGroceryBudget() {
  const value = Number(groceryBudgetInput.value);

  if (!value || value <= 0) {
    groceryBudgetInput.classList.add("hidden");
    return;
  }

  data.groceryBudget = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  groceryBudgetInput.classList.add("hidden");
  renderGroceryBudget();
  updateGroceryBar();
  calculateRemaining();
}

groceryBudgetInput.addEventListener("blur", saveGroceryBudget);
groceryBudgetInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") groceryBudgetInput.blur();
});

function getGrocerySpent() {
  return data.groceryItems.reduce((sum, item) => {
    return sum + (item.type === "add" ? -Number(item.amount) : Number(item.amount));
  }, 0);
}

function updateGroceryBar() {
  const wrapper = document.getElementById("grocery-bar-wrapper");
  const fill = document.getElementById("grocery-bar-fill");
  const label = document.getElementById("grocery-bar-label");

  if (!data.groceryBudget || data.groceryBudget <= 0) {
    wrapper.classList.add("hidden");
    return;
  }

  wrapper.classList.remove("hidden");
  const budget = Number(data.groceryBudget);
  const spent = getGrocerySpent();
  const remaining = budget - spent;
  const pct = Math.min(Math.max((spent / budget) * 100, 0), 100);

  fill.style.width = `${pct}%`;
  label.textContent = `${Math.round(pct)}% spent · ${cur()} ${fmt(remaining)} left`;

  if (pct < 50) {
    fill.style.background = "#1e7f43";
  } else if (pct < 75) {
    fill.style.background = "#e6a817";
  } else {
    fill.style.background = "#e74c3c";
  }
}

function renderGroceryItems() {
  groceryTable.innerHTML = "";

  if (data.groceryItems.length === 0) {
    groceryTable.innerHTML = '<tr><td colspan="3" class="empty-state">No grocery items yet.</td></tr>';
    return;
  }

  const sorted = [...data.groceryItems];
  if (settings.sortOrder === "newest") {
    sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } else {
    sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  sorted.forEach(item => {
    const row = document.createElement("tr");
    const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    row.innerHTML = `
      <td>${item.name}</td>
      <td class="date-stamp">${dateStr}</td>
      <td>${item.type === "add" ? "+" : "-"} ${cur()} ${fmt(item.amount)}</td>
    `;
    row.classList.add("item-enter");
    groceryTable.appendChild(row);
    requestAnimationFrame(() => row.classList.add("item-enter-active"));
  });
}

function addGroceryItem(type) {
  const name = grName.value.trim();
  const amount = Number(grAmount.value);

  const fields = [
    { el: grName, valid: !!name },
    { el: grAmount, valid: !!amount },
  ];

  let hasError = false;
  fields.forEach(f => {
    if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
    else f.el.classList.remove("input-error");
  });
  if (hasError) return;

  data.groceryItems.push({ name, amount, type, date: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  grName.value = "";
  grAmount.value = "";
  fields.forEach(f => f.el.classList.remove("input-error"));

  renderGroceryItems();
  updateGroceryBar();
  calculateRemaining();
}

addGroceryBtn.addEventListener("click", () => addGroceryItem("add"));
takeGroceryBtn.addEventListener("click", () => addGroceryItem("take"));

/* =========================
   SECOND CHOICE
========================= */

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
    const row = document.createElement("tr");
    const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td class="date-stamp">${dateStr}</td>
      <td>${item.type === "add" ? "+" : "-"} ${cur()} ${fmt(item.amount)}</td>
    `;
    row.classList.add("item-enter");
    scTable.appendChild(row);
    requestAnimationFrame(() => row.classList.add("item-enter-active"));
  });
}

function addSecondChoice(type) {
  const name = scName.value.trim();
  const category = scCategory.value;
  const amount = Number(scAmount.value);

  const fields = [
    { el: scName, valid: !!name },
    { el: scCategory, valid: !!category },
    { el: scAmount, valid: !!amount },
  ];

  let hasError = false;
  fields.forEach(f => {
    if (!f.valid) { f.el.classList.add("input-error"); hasError = true; }
    else f.el.classList.remove("input-error");
  });
  if (hasError) return;

  data.secondChoice.push({ name, category, amount, type, date: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  scName.value = "";
  scCategory.selectedIndex = 0;
  scAmount.value = "";
  fields.forEach(f => f.el.classList.remove("input-error"));

  renderSecondChoice();
  calculateRemaining();
}

addMoneyBtn.addEventListener("click", () => addSecondChoice("add"));
takeMoneyBtn.addEventListener("click", () => addSecondChoice("take"));

// Clear error highlight on input
document.querySelectorAll(".second-form input, .second-form select").forEach(el => {
  el.addEventListener("input", () => el.classList.remove("input-error"));
  el.addEventListener("change", () => el.classList.remove("input-error"));
});

/* =========================
   CALCULATION
========================= */

function calculateRemaining() {
  if (data.income === null) {
    remainingMoneyEl.textContent = `${cur()} ${fmt(0)}`;
    return;
  }

  let remaining = Number(data.income);

  data.priority.forEach(bill => {
    if (bill.paid) remaining -= Number(bill.amount);
  });

  if (data.groceryBudget) remaining -= Number(data.groceryBudget);

  data.secondChoice.forEach(item => {
    remaining += item.type === "add"
      ? Number(item.amount)
      : -Number(item.amount);
  });

  remainingMoneyEl.textContent = `${cur()} ${fmt(remaining)}`;

  // Progress bar
  const income = Number(data.income);
  const spent = income - remaining;
  const pct = Math.min(Math.max((spent / income) * 100, 0), 100);
  const fill = document.getElementById("spend-bar-fill");
  const label = document.getElementById("spend-bar-label");
  const limitMark = document.getElementById("spend-bar-limit");

  fill.style.width = `${pct}%`;
  label.textContent = `${Math.round(pct)}% spent`;

  if (pct < 50) {
    fill.style.background = "#1e7f43";
  } else if (pct < 75) {
    fill.style.background = "#e6a817";
  } else {
    fill.style.background = "#e74c3c";
  }

  // Budget limit marker
  if (settings.budgetLimit && income > 0) {
    const limitSpendPct = ((income - settings.budgetLimit) / income) * 100;
    limitMark.style.left = `${Math.min(Math.max(limitSpendPct, 0), 100)}%`;
    limitMark.classList.remove("hidden");
  } else {
    limitMark.classList.add("hidden");
  }

  // Budget limit warning
  const warningEl = document.getElementById("budget-warning");
  if (warningEl) {
    if (settings.budgetLimit && remaining <= settings.budgetLimit) {
      warningEl.textContent = `Warning: Remaining is below ${cur()} ${fmt(settings.budgetLimit)}`;
      warningEl.classList.remove("hidden");
    } else {
      warningEl.classList.add("hidden");
    }
  }
  updateGroceryBar();
  renderChart();
}


/* =========================
   CHART
========================= */

function renderChart() {
  if (!settings.showChart || !chartCtx) return;

  const canvas = chartCanvas;
  const ctx = chartCtx;
  const legend = chartLegend;

  const income = Number(data.income) || 0;
  if (income === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = canvas.width;
    const center = size / 2;

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

  const categoryTotals = {};

  data.priority.forEach(bill => {
    if (bill.paid) {
      const cat = bill.category || "Others";
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(bill.amount);
    }
  });

  if (data.groceryBudget) {
    const grocerySpent = getGrocerySpent();
    categoryTotals["Grocery"] = (categoryTotals["Grocery"] || 0) + Math.max(Number(data.groceryBudget), grocerySpent);
  } else if (data.groceryItems.length > 0) {
    const grocerySpent = getGrocerySpent();
    if (grocerySpent > 0) categoryTotals["Grocery"] = (categoryTotals["Grocery"] || 0) + grocerySpent;
  }

  data.secondChoice.forEach(item => {
    if (item.type === "take") {
      const cat = item.category || "Others";
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(item.amount);
    }
  });

  const spent = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const remaining = Math.max(income - spent, 0);

  const segments = Object.entries(categoryTotals).map(([label, amount]) => ({
    label,
    amount,
    color: CATEGORY_COLORS[label] || "#7f8c8d",
  }));

  if (remaining > 0) {
    segments.push({ label: "Remaining", amount: remaining, color: "#3498db" });
  }

  if (segments.length === 0) {
    segments.push({ label: "Remaining", amount: income, color: "#3498db" });
  }

  // Draw donut chart
  const size = canvas.width;
  const center = size / 2;
  const radius = size / 2 - 10;
  const innerRadius = radius * 0.55;
  const total = segments.reduce((sum, s) => sum + s.amount, 0);

  ctx.clearRect(0, 0, size, size);

  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    const sliceAngle = (seg.amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(center, center, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(center, center, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Center text
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${cur()} ${fmtInt(spent)}`, center, center - 8);
  ctx.font = "12px -apple-system, sans-serif";
  ctx.fillStyle = "#888";
  ctx.fillText("total spent", center, center + 12);

  // Legend
  legend.innerHTML = segments.map(s => `
    <div class="legend-item">
      <div class="legend-left">
        <span class="legend-dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
      </div>
      <span class="legend-amount">${cur()} ${fmt(s.amount)}</span>
    </div>
  `).join("");
}

/* =========================
   INITIAL RENDER
========================= */

renderIncome();
renderPriority();
renderGroceryBudget();
renderGroceryItems();
renderSecondChoice();
calculateRemaining();
updatePriorityLockUI();
renderChart();

/* =========================
   SETTINGS PANEL
========================= */

const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const keepDataToggle = document.getElementById("keep-data-toggle");

keepDataToggle.checked = settings.keepData;

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

// Close settings when clicking outside
document.addEventListener("click", (e) => {
  if (!settingsPanel.contains(e.target) && !settingsToggle.contains(e.target)) {
    settingsPanel.classList.add("hidden");
  }
});

keepDataToggle.addEventListener("change", () => {
  settings.keepData = keepDataToggle.checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
});

const chartToggle = document.getElementById("chart-toggle");
const chartSection = document.getElementById("chart-section");

chartToggle.checked = settings.showChart;
if (settings.showChart) chartSection.classList.remove("hidden");

chartToggle.addEventListener("change", () => {
  settings.showChart = chartToggle.checked;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

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

const currencySelect = document.getElementById("currency-select");
currencySelect.value = settings.currency;

currencySelect.addEventListener("change", () => {
  settings.currency = currencySelect.value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  renderIncome();
  renderPriority();
  renderGroceryBudget();
  renderGroceryItems();
  updateGroceryBar();
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  renderGroceryItems();
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  calculateRemaining();
});

/* =========================
   EXPORT DATA
========================= */

document.getElementById("export-data-btn").addEventListener("click", () => {
  const exportObj = { data, settings };
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `money-tracker-${currentMonthKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* =========================
   SECRET RESET (DOUBLE CLICK HEADER)
========================= */

const secretReset = document.getElementById("secret-reset");
const resetModal = document.getElementById("reset-modal");
const confirmResetBtn = document.getElementById("confirm-reset");
const cancelResetBtn = document.getElementById("cancel-reset");

// Double click header to open modal
secretReset.addEventListener("dblclick", () => {
  resetModal.classList.remove("hidden");
});

// Cancel reset
cancelResetBtn.addEventListener("click", () => {
  resetModal.classList.add("hidden");
});

// Confirm reset
confirmResetBtn.addEventListener("click", () => {
  // Save current priority bills as backup before wiping
  if (data.priority.length > 0) {
    localStorage.setItem(BACKUP_PRIORITY_KEY, JSON.stringify(data.priority));
  }

  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
    groceryBudget: null,
    groceryItems: [],
    secondChoice: []
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  location.reload(); // clean reset
});

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
