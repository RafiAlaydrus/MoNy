/* =========================
   STORAGE & MONTH SETUP
========================= */

const STORAGE_KEY = "monthly-money-tracker";
const SETTINGS_KEY = "monthly-money-tracker-settings";

const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
  keepData: false,
  showChart: false
};

let data = JSON.parse(localStorage.getItem(STORAGE_KEY));

if (!data) {
  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
    secondChoice: []
  };
} else if (!settings.keepData && data.month !== currentMonthKey) {
  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
    secondChoice: []
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

const scName = document.getElementById("sc-name");
const scCategory = document.getElementById("sc-category");
const scAmount = document.getElementById("sc-amount");
const addMoneyBtn = document.getElementById("add-money");
const takeMoneyBtn = document.getElementById("take-money");
const scTable = document.getElementById("sc-table");

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
    data.income !== null ? `RM ${data.income}` : "RM 0";
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

  data.priority.forEach((bill, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "swipe-wrapper";

    const deleteLayer = document.createElement("div");
    deleteLayer.className = "swipe-delete-bg";
    deleteLayer.textContent = "Delete";

    const li = document.createElement("li");
    const dateStr = bill.date ? new Date(bill.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    li.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;">
        <label style="display:flex;gap:8px;">
          <input type="checkbox" ${bill.paid ? "checked" : ""} />
          ${bill.name} (${bill.category})
        </label>
        ${dateStr ? `<span class="date-stamp">${dateStr}</span>` : ""}
      </div>
      <strong>RM ${bill.amount}</strong>
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
      });

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
          setTimeout(() => {
            data.priority.splice(index, 1);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            renderPriority();
            calculateRemaining();
          }, 300);
        } else {
          li.style.transform = "translateX(0)";
        }
      });
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
   SECOND CHOICE
========================= */

function renderSecondChoice() {
  scTable.innerHTML = "";

  data.secondChoice.forEach(item => {
    const row = document.createElement("tr");
    const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td class="date-stamp">${dateStr}</td>
      <td>${item.type === "add" ? "+" : "-"} RM ${item.amount}</td>
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
    remainingMoneyEl.textContent = "RM 0.00";
    return;
  }

  let remaining = Number(data.income);

  data.priority.forEach(bill => {
    if (bill.paid) remaining -= Number(bill.amount);
  });

  data.secondChoice.forEach(item => {
    remaining += item.type === "add"
      ? Number(item.amount)
      : -Number(item.amount);
  });

  // ✅ FIX: force 2 decimal places
  remainingMoneyEl.textContent = `RM ${remaining.toFixed(2)}`;
  renderChart();
}


/* =========================
   CHART
========================= */

function renderChart() {
  if (!settings.showChart) return;

  const canvas = document.getElementById("summary-chart");
  const ctx = canvas.getContext("2d");
  const legend = document.getElementById("chart-legend");

  const income = Number(data.income) || 0;
  if (income === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    legend.innerHTML = '<span style="color:#666;font-size:13px;">Set your income to see the chart.</span>';
    return;
  }

  const categoryColors = {
    "Bills": "#e74c3c",
    "Subscription": "#e67e22",
    "Grocery": "#f1c40f",
    "Food / Drink": "#9b59b6",
    "Transport": "#1abc9c",
    "Others": "#7f8c8d",
  };

  const categoryTotals = {};

  data.priority.forEach(bill => {
    if (bill.paid) {
      const cat = bill.category || "Others";
      categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(bill.amount);
    }
  });

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
    color: categoryColors[label] || "#7f8c8d",
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
  ctx.fillText(`RM ${spent.toFixed(0)}`, center, center - 8);
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
      <span class="legend-amount">RM ${s.amount.toFixed(2)}</span>
    </div>
  `).join("");
}

/* =========================
   INITIAL RENDER
========================= */

renderIncome();
renderPriority();
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
  data = {
    month: currentMonthKey,
    income: null,
    priority: [],
    priorityLocked: false,
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

  document.addEventListener("touchstart", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "LABEL") return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      dragging = false;
    }
  });

  document.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    if (window.scrollY > 0) { pulling = false; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) { pulling = false; return; }
    if (dy > 10) {
      dragging = true;
      const clamped = Math.min(dy, 120);
      app.style.transition = "none";
      app.style.transform = `translateY(${clamped}px)`;
      indicator.style.opacity = Math.min(clamped / threshold, 1);
      pullText.textContent = clamped >= threshold ? "Release to refresh" : "Pull to refresh";
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
    const current = parseFloat(app.style.transform.replace(/[^0-9.-]/g, "")) || 0;
    app.style.transition = "transform 0.3s ease";
    app.style.transform = "";

    if (current >= threshold) {
      pullText.textContent = "Refreshing...";
      pullSpinner.classList.remove("hidden");
      indicator.style.opacity = "1";
      app.style.transform = "translateY(40px)";
      setTimeout(() => location.reload(), 600);
      return;
    }

    indicator.style.opacity = "0";
  });
})();
