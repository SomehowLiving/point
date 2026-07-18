const fields = ["dashboardUrl", "backendUrl", "lensModel"];

async function load() {
  const stored = await chrome.storage.local.get(fields);
  for (const field of fields) {
    const element = document.getElementById(field);
    if (stored[field]) element.value = stored[field];
  }
}

async function save() {
  const values = {};
  for (const field of fields) values[field] = document.getElementById(field).value.trim();
  await chrome.storage.local.set(values);
  const status = document.getElementById("status");
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

document.getElementById("save").addEventListener("click", save);
load();
