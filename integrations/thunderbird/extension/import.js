import { ImportRequestSession, transferPackageCode } from "./browser.js";

const byId = id => document.getElementById(id);
const create = byId("create-request");
const details = byId("request-details");
const save = byId("save-request");
const fields = byId("transfer-controls");
const fileInput = byId("transfer-file");
const approval = byId("approval");
const verifiedInput = byId("verified-code");
const status = byId("status");
const maxPackageBytes = 4 * 1024 * 1024;

let session;
let requestUrl;
let selection;
let busy = false;
let enabled = false;

function setBusy(value) {
  busy = value;
  create.disabled = value || !enabled;
  fields.disabled = value || !session;
}

function clearTransfer() {
  selection = undefined;
  approval.hidden = true;
  verifiedInput.value = "";
}

function clearRequest() {
  session?.close();
  session = undefined;
  if (requestUrl) URL.revokeObjectURL(requestUrl);
  requestUrl = undefined;
  save.removeAttribute("href");
  details.hidden = true;
  fileInput.value = "";
  clearTransfer();
}

create.addEventListener("click", async () => {
  if (busy || !enabled) return;
  setBusy(true);
  try {
    clearRequest();
    session = await ImportRequestSession.create("Thunderbird");
    const request = new Blob([session.requestFile], { type: "application/octet-stream" });
    requestUrl = URL.createObjectURL(request);
    save.href = requestUrl;
    byId("request-code").textContent = session.verificationCode;
    details.hidden = false;
    status.textContent = "Request ready. It expires in 15 minutes.";
    save.focus();
  } catch {
    status.textContent = "Could not create an import request.";
  } finally {
    setBusy(false);
  }
});

fileInput.addEventListener("change", async () => {
  if (!session || busy) return;
  clearTransfer();
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > maxPackageBytes) {
    status.textContent = "This transfer exceeds the 4 MB limit.";
    return;
  }

  setBusy(true);
  try {
    const serialized = await file.text();
    const code = await transferPackageCode(serialized);
    selection = { serialized, code };
    byId("transfer-code").textContent = code;
    approval.hidden = false;
    status.textContent = "Compare the transfer code with MailPort Vault before importing.";
  } catch {
    status.textContent = "Could not read the transfer file.";
  } finally {
    setBusy(false);
    if (selection) verifiedInput.focus();
  }
});

approval.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !session || !selection) return;
  const verifiedCode = verifiedInput.value.trim().toUpperCase();
  if (verifiedCode !== selection.code) {
    status.textContent = "The codes do not match. Check the code in MailPort Vault.";
    verifiedInput.focus();
    return;
  }

  setBusy(true);
  status.textContent = "Saving accounts…";
  try {
    const result = await session.importPackage({
      serialized: selection.serialized,
      verifiedCode,
      adapter: { upsertAccount: account => browser.mailPortPreview.saveSyntheticAccount(account) },
    });
    const saved = result.results.filter(account => account.status === "configured").length;
    const total = result.results.length;
    status.textContent = saved === total
      ? `Saved ${saved} of ${total} accounts in Thunderbird.`
      : `Saved ${saved} of ${total} accounts. You can retry this transfer.`;
    if (result.completed) clearRequest();
  } catch (error) {
    if (error.code === "TRANSFER_EXPIRED") {
      clearRequest();
      status.textContent = "The request expired. Create another request to continue.";
    } else {
      status.textContent = "Could not import this transfer. Check that it was exported for this request.";
    }
  } finally {
    setBusy(false);
    if (!session) create.focus();
  }
});

window.addEventListener("pagehide", () => {
  if (requestUrl) URL.revokeObjectURL(requestUrl);
  if (!busy) session?.close();
});

try {
  enabled = await browser.mailPortPreview.isAvailable();
  status.textContent = enabled ? "" : "Use an offline profile configured for the MailPort preview.";
} catch {
  status.textContent = "This Thunderbird profile could not start the MailPort preview.";
}
setBusy(false);
