/* =========================
   STORAGE & MONTH SETUP
========================= */

const STORAGE_KEY = "monthly-money-tracker";

const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

let data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  month: currentMonthKey,
  income: null,
  priority: [],
  priorityLocked: false,
  secondChoice: []
};

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

  data.priority.forEach((bill) => {
    const li = document.createElement("li");

    li.innerHTML = `
      <label style="display:flex; gap:8px;">
        <input type="checkbox" ${bill.paid ? "checked" : ""} />
        ${bill.name} (${bill.category})
      </label>
      <strong>RM ${bill.amount}</strong>
    `;

    li.querySelector("input").addEventListener("change", (e) => {
      bill.paid = e.target.checked;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      calculateRemaining();
    });

    priorityList.appendChild(li);
  });
}

function updatePriorityLockUI() {
  const form = document.getElementById("priority-form");
  if (form && data.priorityLocked) {
    form.style.display = "none";
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
  updatePriorityLockUI();
});

addPriorityBtn.addEventListener("click", () => {
  if (data.priorityLocked) return;

  const name = document.getElementById("pb-name").value.trim();
  const category = document.getElementById("pb-category").value.trim();
  const amount = Number(document.getElementById("pb-amount").value);

  if (!name || !category || !amount) return;

  data.priority.push({ name, category, amount, paid: false });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  document.getElementById("pb-name").value = "";
  document.getElementById("pb-category").value = "";
  document.getElementById("pb-amount").value = "";

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
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${item.type === "add" ? "+" : "-"} RM ${item.amount}</td>
    `;
    scTable.appendChild(row);
  });
}

function addSecondChoice(type) {
  const name = scName.value.trim();
  const category = scCategory.value.trim();
  const amount = Number(scAmount.value);

  if (!name || !category || !amount) return;

  data.secondChoice.push({ name, category, amount, type });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  scName.value = "";
  scCategory.value = "";
  scAmount.value = "";

  renderSecondChoice();
  calculateRemaining();
}

addMoneyBtn.addEventListener("click", () => addSecondChoice("add"));
takeMoneyBtn.addEventListener("click", () => addSecondChoice("take"));

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
}


/* =========================
   INITIAL RENDER
========================= */

renderIncome();
renderPriority();
renderSecondChoice();
calculateRemaining();
updatePriorityLockUI();

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
