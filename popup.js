const modeBtn = document.getElementById("mode-btn");
const tsBtn = document.getElementById("ts-btn");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const statusEl = document.getElementById("status");
const videoStatusEl = document.getElementById("video-status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b91c1c" : "#374151";
}

function setButtonsEnabled(enabled) {
  modeBtn.disabled = !enabled;
  tsBtn.disabled = !enabled;
  copyBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

function updateStateView(state) {
  modeBtn.textContent = `MODE: ${state.mode || "ORIG"}`;
  tsBtn.textContent = `TS: ${state.timestampEnabled ? "ON" : "OFF"}`;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isWatchUrl(url) {
  return /^https:\/\/(www|m)\.youtube\.com\/watch\?/i.test(url || "");
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function sendWithLazyInjection(tabId, message) {
  try {
    return await sendMessageToTab(tabId, message);
  } catch (error) {
    if (!String(error.message || "").includes("Receiving end does not exist")) {
      throw error;
    }

    await ensureInjected(tabId);
    return await sendMessageToTab(tabId, message);
  }
}

async function withWatchTab(task) {
  const tab = await getActiveTab();
  if (!tab || !isWatchUrl(tab.url)) {
    setButtonsEnabled(false);
    videoStatusEl.textContent = "YouTube動画ページを開いてください";
    setStatus("Not on watch page", true);
    return null;
  }

  setButtonsEnabled(true);
  videoStatusEl.textContent = tab.title || "YouTube watch";
  return await task(tab.id);
}

async function refreshState() {
  await withWatchTab(async (tabId) => {
    const state = await sendWithLazyInjection(tabId, { action: "getState" });
    if (!state?.ok) {
      throw new Error(state?.error || "Failed to load state.");
    }

    updateStateView(state);
    setStatus("Ready");
  });
}

async function runAction(action, loadingText, successText) {
  try {
    setStatus(loadingText);
    await withWatchTab(async (tabId) => {
      const result = await sendWithLazyInjection(tabId, { action });
      if (!result?.ok) {
        throw new Error(result?.error || "Action failed.");
      }

      if (result.mode || typeof result.timestampEnabled === "boolean") {
        updateStateView(result);
      }

      setStatus(successText);
    });
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

modeBtn.addEventListener("click", () => runAction("cycleMode", "Updating mode...", "Mode updated"));
tsBtn.addEventListener("click", () =>
  runAction("toggleTimestamp", "Updating timestamp...", "Timestamp updated")
);
copyBtn.addEventListener("click", async () => {
  try {
    setStatus("Fetching transcript...");
    await withWatchTab(async (tabId) => {
      const result = await sendWithLazyInjection(tabId, { action: "getTranscript" });
      if (!result?.ok || !result.transcript) {
        throw new Error(result?.error || "Transcript is unavailable.");
      }

      await navigator.clipboard.writeText(result.transcript);
      setStatus("Copied");
    });
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});
downloadBtn.addEventListener("click", () =>
  runAction("downloadTranscript", "Fetching transcript...", "Downloaded")
);

setButtonsEnabled(false);
refreshState().catch((error) => setStatus(error.message || String(error), true));