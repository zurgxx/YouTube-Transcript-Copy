// @ts-check
let lastTranscript = "";
let lastTranscriptVideoId = "";
let lastTranscriptMode = "";
let lastTranscriptTimestampEnabled = false;

const TOGGLE_STORAGE_KEY = "show_transcript_buttons";
const MODE_STORAGE_KEY = "yt_transcript_language_mode";
const TIMESTAMP_STORAGE_KEY = "yt_transcript_include_timestamps";
const MODE_ORIG = "ORIG";
const MODE_JA = "JA";
const MODE_EN = "EN";
const MODE_SEQUENCE = [MODE_ORIG, MODE_JA, MODE_EN];

const getTranscriptButtonContainer = () => {
  return document.querySelector("#yt-transcript-button-container");
};

function isWatchPage() {
  return window.location.pathname === "/watch";
}

function shouldShowButtons() {
  return localStorage.getItem(TOGGLE_STORAGE_KEY) !== "false";
}

function normalizeMode(value) {
  if (MODE_SEQUENCE.includes(value)) {
    return value;
  }
  return MODE_ORIG;
}

function getCurrentMode() {
  return normalizeMode(localStorage.getItem(MODE_STORAGE_KEY));
}

function setCurrentMode(mode) {
  const normalizedMode = normalizeMode(mode);
  localStorage.setItem(MODE_STORAGE_KEY, normalizedMode);
  return normalizedMode;
}

function cycleMode(mode) {
  const index = MODE_SEQUENCE.indexOf(normalizeMode(mode));
  return MODE_SEQUENCE[(index + 1) % MODE_SEQUENCE.length];
}

function getCurrentVideoId() {
  return new URLSearchParams(window.location.search).get("v") || "";
}

function getTimestampEnabled() {
  return localStorage.getItem(TIMESTAMP_STORAGE_KEY) === "true";
}

function setTimestampEnabled(enabled) {
  const normalized = Boolean(enabled);
  localStorage.setItem(TIMESTAMP_STORAGE_KEY, normalized ? "true" : "false");
  return normalized;
}

function normalizeLanguageCode(languageCode) {
  return (languageCode || "").toLowerCase().split(/[-_]/)[0];
}

function languageMatches(trackCode, targetCode) {
  const normalizedTarget = normalizeLanguageCode(targetCode);
  if (!normalizedTarget) return false;
  return normalizeLanguageCode(trackCode) === normalizedTarget;
}

// Utility function to wait for an element to appear
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    let timeoutId;
    const observer = new MutationObserver((_, obs) => {
      const nextElement = document.querySelector(selector);
      if (nextElement) {
        clearTimeout(timeoutId);
        obs.disconnect();
        resolve(nextElement);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function waitForCondition(predicate, timeout = 5000, interval = 200) {
  return new Promise((resolve) => {
    const immediate = predicate();
    if (immediate) {
      resolve(immediate);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const result = predicate();
      if (result) {
        clearInterval(timer);
        resolve(result);
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJapaneseCode(languageCode) {
  return /^ja([_-].+)?$/i.test(languageCode || "");
}

function isEnglishCode(languageCode) {
  return /^en([_-].+)?$/i.test(languageCode || "");
}

function isAsrTrack(track) {
  const vssId = track?.vssId || "";
  return track?.kind === "asr" || /(^|\.)a\./i.test(vssId);
}

function sanitizeText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function chooseTrackByLanguage(captionTracks, matcher) {
  const manual = captionTracks.find(
    (track) => matcher(track.languageCode) && !isAsrTrack(track)
  );
  if (manual) return manual;

  return captionTracks.find(
    (track) => matcher(track.languageCode) && isAsrTrack(track)
  );
}

function inferOriginalLanguageCode(tracklistRenderer, captionTracks) {
  const defaultAudioTrack = tracklistRenderer?.audioTracks?.find(
    (track) => track?.visibility === "VISIBILITY_ON"
  );
  const defaultAudioLanguage =
    defaultAudioTrack?.captionTrackIndices?.length > 0
      ? captionTracks?.[defaultAudioTrack.captionTrackIndices[0]]?.languageCode
      : "";

  return defaultAudioLanguage || captionTracks?.[0]?.languageCode || "";
}

function chooseBestTrack(captionTracks, mode, originalLanguageCode) {
  if (!captionTracks || captionTracks.length === 0) {
    return null;
  }

  const originalMatch = (code) => languageMatches(code, originalLanguageCode);
  const originalTrack = chooseTrackByLanguage(captionTracks, originalMatch);

  if (mode === MODE_ORIG) {
    if (originalTrack) {
      return { track: originalTrack, translateTo: null };
    }

    const manualTrack = captionTracks.find((track) => !isAsrTrack(track));
    return { track: manualTrack || captionTracks[0], translateTo: null };
  }

  if (mode === MODE_JA) {
    const japaneseTrack = chooseTrackByLanguage(captionTracks, isJapaneseCode);
    if (japaneseTrack) {
      return { track: japaneseTrack, translateTo: null };
    }

    const translatable = captionTracks.find((track) => track.isTranslatable);
    if (translatable) {
      return { track: translatable, translateTo: "ja" };
    }

    return { track: originalTrack || captionTracks[0], translateTo: null };
  }

  if (mode === MODE_EN) {
    const englishTrack = chooseTrackByLanguage(captionTracks, isEnglishCode);
    if (englishTrack) {
      return { track: englishTrack, translateTo: null };
    }

    const translatable = captionTracks.find((track) => track.isTranslatable);
    if (translatable) {
      return { track: translatable, translateTo: "en" };
    }

    return { track: originalTrack || captionTracks[0], translateTo: null };
  }

  return { track: originalTrack || captionTracks[0], translateTo: null };
}

function buildCaptionUrl(track, translateTo) {
  if (!track?.baseUrl) {
    throw new Error("Caption track has no baseUrl.");
  }

  const url = new URL(track.baseUrl);
  url.searchParams.set("fmt", "json3");

  if (translateTo) {
    url.searchParams.set("tlang", translateTo);
  }

  return url.toString();
}

function parseJsonCaptionPayload(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const rows = [];

  for (const event of events) {
    if (!Array.isArray(event?.segs)) {
      continue;
    }

    const startSeconds = (Number(event.tStartMs) || 0) / 1000;
    const text = sanitizeText(event.segs.map((segment) => segment?.utf8 || "").join(""));

    if (!text) {
      continue;
    }

    rows.push({
      startSeconds,
      text,
    });
  }

  return rows;
}

function parseXmlCaptionPayload(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const textNodes = doc.querySelectorAll("text");
  const rows = [];

  textNodes.forEach((node) => {
    const startSeconds = Number(node.getAttribute("start") || 0);
    const text = sanitizeText(node.textContent || "");

    if (!text) {
      return;
    }

    rows.push({
      startSeconds,
      text,
    });
  });

  return rows;
}

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      secs
    ).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function removeTimestamps(text) {
  return (text || "")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTranscriptRows(rows, includeTimestamps) {
  const deduped = [];

  for (const row of rows) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.text === row.text) {
      continue;
    }
    deduped.push(row);
  }

  if (includeTimestamps) {
    return deduped
      .map((row) => `[${formatSeconds(row.startSeconds)}] ${row.text}`)
      .join("\n")
      .trim();
  }

  return deduped.map((row) => row.text).join("\n").trim();
}

function getPlayerResponseFromPageContext(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const eventName = `yt-transcript-player-response-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

    let resolved = false;

    const cleanup = () => {
      window.removeEventListener(eventName, onMessage);
      clearTimeout(timeout);
    };

    const onMessage = (event) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(event.detail || null);
    };

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(null);
    }, timeoutMs);

    window.addEventListener(eventName, onMessage, { once: true });

    const script = document.createElement("script");
    script.textContent = `(() => {
      try {
        const direct = window.ytInitialPlayerResponse || null;
        const playerResponseString = window?.ytplayer?.config?.args?.player_response;
        const parsed = playerResponseString ? JSON.parse(playerResponseString) : null;
        const configResponse = window?.ytcfg?.get ? window.ytcfg.get('PLAYER_RESPONSE') : null;
        const response = direct || parsed || configResponse || null;
        window.dispatchEvent(new CustomEvent('${eventName}', { detail: response }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('${eventName}', { detail: null }));
      }
    })();`;

    const target = document.documentElement || document.head || document.body;
    target.appendChild(script);
    script.remove();
  });
}

async function fetchTranscriptFromCaptionTracks(mode, includeTimestamps) {
  const playerResponse = await getPlayerResponseFromPageContext();
  const tracklistRenderer =
    playerResponse?.captions?.playerCaptionsTracklistRenderer || null;
  const captionTracks = tracklistRenderer?.captionTracks || [];

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    throw new Error("No caption tracks available for this video.");
  }

  const originalLanguageCode = inferOriginalLanguageCode(tracklistRenderer, captionTracks);
  const selected = chooseBestTrack(captionTracks, mode, originalLanguageCode);
  if (!selected?.track) {
    throw new Error("Could not select a caption track.");
  }

  const captionUrl = buildCaptionUrl(selected.track, selected.translateTo);
  const response = await fetch(captionUrl, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Caption request failed: ${response.status}`);
  }

  const body = await response.text();
  const trimmed = body.trim();

  let rows = [];

  if (trimmed.startsWith("{")) {
    rows = parseJsonCaptionPayload(JSON.parse(trimmed));
  } else if (trimmed.startsWith("<")) {
    rows = parseXmlCaptionPayload(trimmed);
  } else {
    // Some responses include a non-JSON prefix
    const normalized = trimmed.replace(/^\)\]\}'\s*/, "");
    if (normalized.startsWith("{")) {
      rows = parseJsonCaptionPayload(JSON.parse(normalized));
    }
  }

  if (!rows.length) {
    throw new Error("Caption payload was empty.");
  }

  return formatTranscriptRows(rows, includeTimestamps);
}

function findTranscriptButtonByText() {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find((button) => {
    const text = (button.textContent || "").toLowerCase();
    const aria = (button.getAttribute("aria-label") || "").toLowerCase();

    return (
      text.includes("transcript") ||
      text.includes("文字起こし") ||
      aria.includes("transcript") ||
      aria.includes("文字起こし")
    );
  });
}

function getTranscriptContainerCandidates() {
  return Array.from(
    document.querySelectorAll(
      [
        ".ytd-transcript-segment-list-renderer#segments-container",
        "ytd-transcript-segment-list-renderer #segments-container",
        "ytd-engagement-panel-section-list-renderer #segments-container",
        "ytd-transcript-renderer #segments-container",
        "div[id='segments-container']",
        "ytd-item-section-renderer[section-identifier^='timeline_view_section'] #contents",
      ].join(",")
    )
  );
}

function isElementVisible(element) {
  if (!element || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getTranscriptSegments() {
  return Array.from(document.querySelectorAll("transcript-segment-view-model"))
    .filter((segment) => segment?.isConnected);
}

function getTranscriptSegmentData() {
  return getTranscriptSegments().map((segment) => {
    const timestamp = sanitizeText(
      segment.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent || ""
    );
    const text = sanitizeText(
      segment.querySelector("span[role='text'], .yt-core-attributed-string")?.textContent ||
        segment.textContent ||
        ""
    );

    return { timestamp, text };
  });
}

function formatTranscriptSegmentData(segmentData, includeTimestamps) {
  const seen = new Set();
  const rows = segmentData
    .map(({ timestamp, text }) => {
      if (!text) {
        return "";
      }

      const key = `${timestamp}__${text}`;
      if (seen.has(key)) {
        return "";
      }
      seen.add(key);

      return includeTimestamps && timestamp ? `[${timestamp}] ${text}` : text;
    })
    .filter(Boolean);

  return rows.join("\n").trim();
}

function extractTranscriptFromViewModels(includeTimestamps) {
  return formatTranscriptSegmentData(getTranscriptSegmentData(), includeTimestamps);
}

function getVisibleTranscriptContainer() {
  return getTranscriptContainerCandidates().find((element) => {
    const text = sanitizeText(element?.innerText || element?.textContent || "");
    return Boolean(text) && isElementVisible(element);
  });
}

function getTranscriptPanelText(includeTimestamps) {
  const transcriptFromViewModels = extractTranscriptFromViewModels(includeTimestamps);
  if (transcriptFromViewModels) {
    return transcriptFromViewModels;
  }

  const transcriptContainer = getVisibleTranscriptContainer();
  if (!transcriptContainer) {
    return "";
  }

  const transcriptRaw = sanitizeText(
    (transcriptContainer.innerText || transcriptContainer.textContent || "")
      .split("\n")
      .join(" ")
  );
  return includeTimestamps ? transcriptRaw : removeTimestamps(transcriptRaw);
}

async function stabilizeTranscriptViewModels(includeTimestamps, timeoutMs = 12000) {
  const startedAt = Date.now();
  let idleRounds = 0;
  let lastSignature = "";
  let bestTranscript = "";

  while (Date.now() - startedAt < timeoutMs) {
    const segmentData = getTranscriptSegmentData();
    const lastTimestamp = segmentData[segmentData.length - 1]?.timestamp || "";
    const signature = `${segmentData.length}:${lastTimestamp}`;
    const transcript = formatTranscriptSegmentData(segmentData, includeTimestamps);

    if (transcript) {
      bestTranscript = transcript;
    }

    if (signature && signature === lastSignature) {
      idleRounds += 1;
      if (idleRounds >= 4 && bestTranscript) {
        return bestTranscript;
      }
    } else {
      idleRounds = 0;
      lastSignature = signature;
    }

    const container = getVisibleTranscriptContainer();
    if (container) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      if (maxScrollTop > 0) {
        const nextScrollTop = Math.min(maxScrollTop, container.scrollTop + Math.max(container.clientHeight * 0.9, 400));
        if (nextScrollTop !== container.scrollTop) {
          container.scrollTop = nextScrollTop;
        }
      }
    }

    await sleep(300);
  }

  return bestTranscript;
}

async function fetchTranscriptFromPanel(includeTimestamps) {
  let transcript = await stabilizeTranscriptViewModels(includeTimestamps, 2000);
  if (!transcript) {
    transcript = getTranscriptPanelText(includeTimestamps);
  }

  if (!transcript) {
    const directSelector =
      '#primary-button > ytd-button-renderer > yt-button-shape > button[aria-label*="transcript" i]';

    const showTranscriptButton =
      (await waitForElement(directSelector, 2000)) || findTranscriptButtonByText();

    if (!showTranscriptButton) {
      throw new Error("Could not find transcript button in UI.");
    }

    showTranscriptButton.click();

    transcript = await waitForCondition(() => getTranscriptPanelText(includeTimestamps), 12000, 250);
    if (!transcript) {
      throw new Error("Transcript panel did not load.");
    }

    transcript = (await stabilizeTranscriptViewModels(includeTimestamps, 12000)) || transcript;
  }

  if (!transcript) {
    throw new Error("Transcript is empty.");
  }

  return transcript;
}





// Fetch transcript only from transcript panel to avoid CSP issues on YouTube.
async function fetchTranscript() {
  const currentMode = getCurrentMode();
  const includeTimestamps = getTimestampEnabled();
  const videoId = getCurrentVideoId();
  lastTranscript = "";

  let panelError = null;

  try {
    lastTranscript = await fetchTranscriptFromPanel(includeTimestamps);
  } catch (error) {
    panelError = error;
    console.error("Error fetching transcript from panel:", error);
  }

  if (!lastTranscript) {
    try {
      lastTranscript = await fetchTranscriptFromCaptionTracks(currentMode, includeTimestamps);
    } catch (captionError) {
      console.error("Error fetching transcript from caption tracks:", captionError);

      if (panelError) {
        throw new Error(
          `${panelError.message} Fallback failed: ${captionError.message}`
        );
      }

      throw captionError;
    }
  }

  lastTranscriptMode = currentMode;
  lastTranscriptVideoId = videoId;
  lastTranscriptTimestampEnabled = includeTimestamps;
  return lastTranscript;
}

// Copy text to clipboard
async function copyToClipboard(text) {
  if (!text) {
    throw new Error("No transcript to copy");
  }

  await navigator.clipboard.writeText(text);
}

// Download text as file
function downloadAsFile(text, filename) {
  if (!text) {
    throw new Error("No transcript to download");
  }

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const showStatus = (type) => {
  const container = getTranscriptButtonContainer();

  const spinner = container?.querySelector(".yt-transcript-status-spinner");
  const successIcon = container?.querySelector(".yt-transcript-status-success");
  const errorIcon = container?.querySelector(".yt-transcript-status-error");

  if (spinner) {
    spinner.style.display = type === "loading" ? "block" : "none";
  }
  if (successIcon) {
    successIcon.style.display = type === "success" ? "block" : "none";
  }
  if (errorIcon) {
    errorIcon.style.display = type === "error" ? "block" : "none";
  }

  if (type !== "loading") {
    setTimeout(() => {
      if (spinner) spinner.style.display = "none";
      if (successIcon) successIcon.style.display = "none";
      if (errorIcon) errorIcon.style.display = "none";
    }, 2000);
  }
};

function updateModeButtonLabel(mode) {
  const modeButton = document.querySelector("#yt-transcript-mode-button");
  if (!modeButton) return;
  modeButton.textContent = normalizeMode(mode);
}

function updateTimestampButtonLabel(enabled) {
  const timestampButton = document.querySelector("#yt-transcript-timestamp-button");
  if (!timestampButton) return;
  timestampButton.textContent = enabled ? "TS ON" : "TS OFF";
}

// Create transcript button in YouTube UI
function createTranscriptButton() {
  if (getTranscriptButtonContainer() || !isWatchPage() || !shouldShowButtons()) {
    return;
  }

  const container = document.querySelector("#menu > ytd-menu-renderer.ytd-watch-metadata");
  if (!container) return;

  const transcriptButtonContainer = document.createElement("div");
  transcriptButtonContainer.className = "yt-transcript-button-container";
  transcriptButtonContainer.id = "yt-transcript-button-container";

  transcriptButtonContainer.innerHTML = `
    <button class="yt-transcript-dropdown-item yt-transcript-button" id="yt-transcript-mode-button" data-action="toggle-mode" title="Language Mode">
      ${getCurrentMode()}
    </button>
    <button class="yt-transcript-dropdown-item yt-transcript-button" id="yt-transcript-timestamp-button" data-action="toggle-ts" title="Timestamp Mode">
      ${getTimestampEnabled() ? "TS ON" : "TS OFF"}
    </button>
    <button class="yt-transcript-dropdown-item yt-transcript-button" data-action="download" title="Download Transcript">
      <svg class="yt-transcript-icon" fill="none" stroke-width="1.5" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-.75" />
      </svg>
    </button>
    <button class="yt-transcript-dropdown-item yt-transcript-button" data-action="copy" title="Copy Transcript">
      <svg class="yt-transcript-icon" viewBox="0 0 24 24" width="16" height="16">
        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" fill="currentColor"/>
        <path d="M12 14L8 18L10.5 20.5L12 19L15.5 22.5L17 21L12 14Z" fill="currentColor"/>
      </svg>
    </button>
    <div class="yt-transcript-status-container">
      <svg class="yt-transcript-status-spinner" style="display: none;" viewBox="0 0 24 24" width="16" height="16">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="60" class="yt-transcript-spinner-circle"/>
      </svg>
      <svg class="yt-transcript-status-success" style="display: none;" viewBox="0 0 24 24" width="16" height="16">
        <path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z" fill="currentColor"/>
      </svg>
      <svg class="yt-transcript-status-error" style="display: none;" viewBox="0 0 24 24" width="16" height="16">
        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" fill="currentColor"/>
      </svg>
    </div>
  `;

  transcriptButtonContainer.addEventListener("click", async (event) => {
    event.stopPropagation();

    const item = event.target?.closest(".yt-transcript-dropdown-item");
    if (!item) return;

    const action = item.getAttribute("data-action");

    try {
      if (action === "toggle-mode") {
        const currentMode = getCurrentMode();
        const nextMode = setCurrentMode(cycleMode(currentMode));
        updateModeButtonLabel(nextMode);
        lastTranscript = "";
        lastTranscriptMode = "";
        lastTranscriptTimestampEnabled = getTimestampEnabled();
        return;
      }

      if (action === "toggle-ts") {
        const nextTsEnabled = setTimestampEnabled(!getTimestampEnabled());
        updateTimestampButtonLabel(nextTsEnabled);
        lastTranscript = "";
        lastTranscriptTimestampEnabled = nextTsEnabled;
        return;
      }

      showStatus("loading");

      const currentMode = getCurrentMode();
      const currentVideoId = getCurrentVideoId();
      const shouldRefetch =
        !lastTranscript ||
        currentMode !== lastTranscriptMode ||
        currentVideoId !== lastTranscriptVideoId ||
        getTimestampEnabled() !== lastTranscriptTimestampEnabled;

      if (shouldRefetch) {
        await fetchTranscript();
      }

      if (!lastTranscript) {
        throw new Error("Transcript is unavailable.");
      }

      if (action === "copy") {
        await copyToClipboard(lastTranscript);
      }

      if (action === "download") {
        const videoTitle = document.title
          .replace(" - YouTube", "")
          .replace(/[<>:"/\\|?*]+/g, "_");

        downloadAsFile(lastTranscript, `${videoTitle}_transcript.txt`);
      }

      showStatus("success");
    } catch (error) {
      console.error(error);
      showStatus("error");
    }
  });

  container.prepend(transcriptButtonContainer);
  addButtonStyles();
}

// Add styles for the button and dropdown
function addButtonStyles() {
  const existingStyles = document.getElementById("yt-transcript-styles");
  if (existingStyles) return;

  const style = document.createElement("style");
  style.id = "yt-transcript-styles";
  style.textContent = `
    .yt-transcript-button-container {
      margin-right: 8px;
      display: flex;
      align-items: center;
      border: 1px solid var(--yt-spec-outline);
      border-radius: 18px;
      gap: 6px;
      padding: 4px 10px;
    }

    .yt-transcript-button {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: transparent;
      border: 1px solid var(--yt-spec-outline);
      border-radius: 18px;
      color: var(--yt-spec-text-primary);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .yt-transcript-button:hover {
      background: var(--yt-spec-badge-chip-background);
      border-color: var(--yt-spec-outline-hover);
    }

    .yt-transcript-icon {
      flex-shrink: 0;
    }

    .yt-transcript-spinner-circle {
      animation: yt-transcript-spin 1s linear infinite;
    }

    .yt-transcript-status-container {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .yt-transcript-status-success {
      color: #00a550;
    }

    .yt-transcript-status-error {
      color: #ff0000;
    }

    @keyframes yt-transcript-spin {
      from { stroke-dashoffset: 60; }
      to { stroke-dashoffset: 0; }
    }

    html[dark] .yt-transcript-button {
      border-color: rgba(255, 255, 255, 0.2);
    }

    html[dark] .yt-transcript-button:hover {
      border-color: rgba(255, 255, 255, 0.3);
    }
  `;

  document.head.appendChild(style);
}

// Initialize the extension
function init() {
  if (!isWatchPage() || !shouldShowButtons()) {
    getTranscriptButtonContainer()?.remove();
    return;
  }

  // Ensure default mode is persisted.
  setCurrentMode(getCurrentMode());
  setTimestampEnabled(getTimestampEnabled());

  if (getTranscriptButtonContainer()) {
    return;
  }

  setTimeout(() => {
    createTranscriptButton();
  }, 1000);
}

function getSanitizedVideoTitle() {
  return document.title.replace(" - YouTube", "").replace(/[<>:"/\\|?*]+/g, "_");
}

function shouldRefetchTranscript() {
  const currentMode = getCurrentMode();
  const currentVideoId = getCurrentVideoId();
  const timestampEnabled = getTimestampEnabled();

  return (
    !lastTranscript ||
    currentMode !== lastTranscriptMode ||
    currentVideoId !== lastTranscriptVideoId ||
    timestampEnabled !== lastTranscriptTimestampEnabled
  );
}

async function ensureTranscriptReady() {
  if (shouldRefetchTranscript()) {
    await fetchTranscript();
  }

  if (!lastTranscript) {
    throw new Error("Transcript is unavailable.");
  }

  return lastTranscript;
}

function buildStateResponse() {
  return {
    ok: true,
    isWatchPage: isWatchPage(),
    mode: getCurrentMode(),
    timestampEnabled: getTimestampEnabled(),
    hasTranscriptCache: Boolean(lastTranscript),
    videoId: getCurrentVideoId(),
  };
}

async function handleRuntimeMessage(request) {
  if (!request?.action) {
    return { ok: false, error: "Missing action." };
  }

  if (request.action === "getState") {
    return buildStateResponse();
  }

  if (!isWatchPage()) {
    return { ok: false, error: "Open a YouTube watch page first.", isWatchPage: false };
  }

  if (request.action === "cycleMode") {
    const nextMode = setCurrentMode(cycleMode(getCurrentMode()));
    lastTranscript = "";
    lastTranscriptMode = "";
    lastTranscriptTimestampEnabled = getTimestampEnabled();

    return {
      ok: true,
      mode: nextMode,
      timestampEnabled: getTimestampEnabled(),
      isWatchPage: true,
    };
  }

  if (request.action === "toggleTimestamp") {
    const nextTsEnabled = setTimestampEnabled(!getTimestampEnabled());
    lastTranscript = "";
    lastTranscriptTimestampEnabled = nextTsEnabled;

    return {
      ok: true,
      mode: getCurrentMode(),
      timestampEnabled: nextTsEnabled,
      isWatchPage: true,
    };
  }

  if (request.action === "getTranscript") {
    const transcript = await ensureTranscriptReady();
    return { ok: true, action: "getTranscript", transcript, length: transcript.length };
  }

  if (request.action === "copyTranscript") {
    const transcript = await ensureTranscriptReady();
    await copyToClipboard(transcript);
    return { ok: true, action: "copy", length: transcript.length };
  }

  if (request.action === "downloadTranscript") {
    const transcript = await ensureTranscriptReady();
    const filename = `${getSanitizedVideoTitle()}_transcript.txt`;
    downloadAsFile(transcript, filename);
    return { ok: true, action: "download", filename, length: transcript.length };
  }

  return { ok: false, error: `Unknown action: ${request.action}` };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  handleRuntimeMessage(request)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Message handling failed:", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

