let chatAbortController = null;
let setActiveTab = () => {};
let currentCookies = [];
let currentRenderedCookies = [];
const SYSTEM_PROMPT = `
You are a Sora 2 prompt specialist. Use the local prompt guides and produce clear, cinematic video prompts.

Core approach:
- Follow the Five Pillars: subject and character, action and motion, environment and setting, cinematic framing, aesthetic and style.
- Treat Sora as a world simulator: describe physical interactions, materials, light, and motion so the scene is internally consistent.
- Use concrete verbs and visible outcomes. Avoid vague adjectives without visual anchors.
- Default to storytelling: include a clear narrative arc (hook -> escalation -> payoff) even for short clips, unless the user explicitly asks for something else.
- If the user requests "meme", "funny", "comedy", or "viral", prioritize a fast hook (first 1-2s), a surprising visual twist, and a highly memeable moment that could be captioned.

Output format when drafting a prompt:
- If Part length (seconds) is provided, split the story into multiple parts of that length and label them with time ranges (e.g., Part 1 (0-15s), Part 2 (15-30s), ...).
- If Part length is NOT provided, output a single Part 1 covering the full Duration.

Each part must include:
Prompt: the beat for this part.
Scene: location/time, key props, and staging.
Style: aesthetic, mood, palette, film stock or realism level.
Camera: lens, framing, movement, and shot scale.
Lighting: key source, time of day, practicals, atmosphere.
Action beats: short timeline or beat list for this part.
Quality: resolution, fps, and technical quality notes for this part.
Audio (optional): diegetic sound cues if relevant.

Notes:
- Resolution and duration are API parameters. Include recommended values but do not claim they are controlled by text alone.
- Supported durations: 4, 8, 12 seconds (default 4). Resolutions: 1280x720 or 720x1280; Sora 2 Pro also supports 1024x1792 and 1792x1024.
- If Duration is missing, infer a reasonable total from the brief.
- If Part length is provided, compute the number of parts from Duration and Part length.
- Each part should read as its own scene with its own style/camera/lighting; do not apply one global style to all parts.
`.trim();

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  await restoreChatState();
  await restorePromptState();
  await restoreQueueState();
  loadGallery();
  initCookieTab();

  document
    .getElementById("downloadAll")
    .addEventListener("click", downloadAllAsZip);
  document.getElementById("clearAll").addEventListener("click", clearAll);
  document.getElementById("sendChat").addEventListener("click", sendChat);
  document.getElementById("abortChat").addEventListener("click", abortChat);
  document
    .getElementById("fillPrompt")
    .addEventListener("click", fillPromptWithLlm);
  document
    .getElementById("sendPrompt")
    .addEventListener("click", () => sendPromptMessage("send-prompt"));
  document
    .getElementById("sendPromptQueue")
    .addEventListener("click", sendPromptQueue);
  document
    .getElementById("useChatOutput")
    .addEventListener("click", useChatOutputAsPrompt);
  document.getElementById("openApi").addEventListener("click", openApiTab);

  const chatPrompt = document.getElementById("chatPrompt");
  chatPrompt.addEventListener("input", () => {
    saveChatState({ prompt: chatPrompt.value });
  });

  const promptInput = document.getElementById("promptInput");
  promptInput.addEventListener("input", () => {
    savePromptState(promptInput.value);
  });

  const queuePromptInput = document.getElementById("queuePromptInput");
  queuePromptInput.addEventListener("input", () => {
    saveQueueState({ template: queuePromptInput.value });
  });

  const queueCount = document.getElementById("queueCount");
  queueCount.addEventListener("input", () => {
    saveQueueState({ count: queueCount.value });
  });

  const queueInterval = document.getElementById("queueInterval");
  queueInterval.addEventListener("input", () => {
    saveQueueState({ interval: queueInterval.value });
  });

  document
    .getElementById("scrapeImages")
    .addEventListener("click", handleScrapeImages);
  document
    .getElementById("refreshScrape")
    .addEventListener("click", handleRefreshScrape);
  document
    .getElementById("scrapeFromDom")
    .addEventListener("click", handleScrapeFromDom);
  document
    .getElementById("clearScrape")
    .addEventListener("click", clearScrapeGallery);
  document
    .getElementById("selectAllScrape")
    .addEventListener("click", toggleSelectAllScrape);
  document
    .getElementById("downloadScrapeZip")
    .addEventListener("click", downloadScrapeZip);
});

function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".tab-content"));

  const activate = (name) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === name;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      const isActive = panel.id === `tab-${name}`;
      panel.classList.toggle("active", isActive);
      panel.dataset.active = isActive ? "true" : "false";
    });

    if (name === "gui") {
      const iframe = document.querySelector("#tab-gui iframe");
      if (iframe && iframe.dataset.src && iframe.src !== iframe.dataset.src) {
        iframe.src = iframe.dataset.src;
      }
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.tab));
  });

  setActiveTab = activate;
  activate("prompt");
}

async function loadGallery() {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];

  const gallery = document.getElementById("gallery");

  if (images.length === 0) {
    gallery.innerHTML =
      '<p class="empty-message">No images yet. Use the buttons on ChatGPT to generate images!</p>';
    return;
  }

  gallery.innerHTML = images
    .map(
      (img, index) => `
    <div class="gallery-item" data-index="${index}">
      <img src="${img.dataUrl}" alt="${img.preset}">
      <span class="label">${img.preset}</span>
      <button class="delete-btn" data-index="${index}">&times;</button>
    </div>
  `
    )
    .join("");

  gallery.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteImage(parseInt(btn.dataset.index));
    });
  });
}

async function deleteImage(index) {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];
  images.splice(index, 1);
  await chrome.storage.local.set({ generatedImages: images });
  loadGallery();
  showStatus("Image deleted");
}

async function clearAll() {
  if (confirm("Delete all images?")) {
    await chrome.storage.local.set({ generatedImages: [] });
    loadGallery();
    showStatus("All images cleared");
  }
}

async function downloadAllAsZip() {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];

  if (images.length === 0) {
    showStatus("No images to download");
    return;
  }

  showStatus("Creating ZIP...");

  try {
    const entries = images.map((img, index) => {
      const base64Data = img.dataUrl.split(",")[1];
      const ext = img.mimeType?.includes("jpeg") ? "jpg" : "png";
      const name = `${img.preset || "image"}_${index + 1}.${ext}`;
      return { name, data: base64ToBytes(base64Data) };
    });

    const blob = createZipBlob(entries);
    triggerDownload(blob, "generated-images.zip");
    showStatus("ZIP downloaded!");
  } catch (error) {
    console.error("ZIP error:", error);
    showStatus("ZIP failed. Downloading individually...");
    await downloadImagesIndividually(images);
  }
}

function showStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

async function sendChat() {
  const promptInput = document.getElementById("chatPrompt");
  const chatOutput = document.getElementById("chatOutput");
  const abortButton = document.getElementById("abortChat");
  const prompt = promptInput.value.trim();

  if (!prompt) {
    showStatus("Enter a prompt first");
    return;
  }

  showStatus("Sending chat...");
  chatOutput.textContent = "";
  saveChatState({ output: "" });
  abortButton.disabled = false;

  const body = {
    prompt,
    provider: "command",
    command: "codex",
    codex_model: "",
    codex_session: "new",
    gemini_model: "",
    ollama: { base_url: "", model: "" },
    openai_compatible: { base_url: "", model: "", api_key: "" },
    puter: { model: "gemini-3-flash-preview" },
    gpt4free: { model: "deepseek" },
    images: [],
  };

  try {
    chatAbortController = new AbortController();
    const response = await fetch("https://localhost:3333/api/chat", {
      headers: {
        accept: "*/*",
        "accept-language": "en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "sec-ch-ua":
          '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
      method: "POST",
      mode: "cors",
      credentials: "omit",
      signal: chatAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Request failed: ${response.status}${
          errorText ? ` - ${errorText}` : ""
        }`
      );
    }

    const data = await response.json().catch(() => null);
    if (data && typeof data.text === "string") {
      chatOutput.textContent = data.text;
      saveChatState({ output: data.text });
    } else {
      chatOutput.textContent = "No response text.";
      saveChatState({ output: chatOutput.textContent });
    }
    showStatus("Chat sent");
  } catch (error) {
    console.error("Chat error:", error);
    showStatus(error.name === "AbortError" ? "Chat aborted" : "Chat failed");
    chatOutput.textContent =
      error.name === "AbortError"
        ? "Chat aborted."
        : "Chat failed. Check console for details.";
    saveChatState({ output: chatOutput.textContent });
  } finally {
    chatAbortController = null;
    abortButton.disabled = true;
  }
}

async function sendPromptMessage(type) {
  const promptInput = document.getElementById("promptInput");
  const text = (promptInput.value || "").trim();
  if (!text) {
    showStatus("Enter a prompt first");
    return;
  }

  const targetTab = await getChatGptTab();

  if (!targetTab || !targetTab.id) {
    showStatus("Open ChatGPT to send prompts");
    return;
  }

  try {
    await chrome.tabs.sendMessage(targetTab.id, {
      type,
      text,
    });
    showStatus(type === "fill-prompt" ? "Prompt filled" : "Prompt sent");
  } catch (error) {
    console.error("Send prompt error:", error);
    showStatus("Refresh ChatGPT tab and try again");
  }
}

async function sendPromptQueue() {
  const promptInput = document.getElementById("promptInput");
  const queuePromptInput = document.getElementById("queuePromptInput");
  const queueCount = document.getElementById("queueCount");
  const queueInterval = document.getElementById("queueInterval");

  const queueText = (queuePromptInput.value || "").trim();
  if (!queueText) {
    showStatus("Enter queue text first");
    return;
  }

  const total = Math.max(1, parseInt(queueCount.value, 10) || 0);
  const intervalSeconds = Math.max(
    0,
    Number.isFinite(Number(queueInterval.value))
      ? Number(queueInterval.value)
      : 0
  );
  const intervalMs = Math.round(intervalSeconds * 1000);

  const targetTab = await getChatGptTab();
  if (!targetTab || !targetTab.id) {
    showStatus("Open ChatGPT to send prompts");
    return;
  }

  setQueueStatus("Queue started");
  for (let i = 1; i <= total; i += 1) {
    const queueSuffix = queueText.replace(/\{numOfQueue\}/g, String(i));
    const composedText = queueSuffix;
    if (!composedText) {
      showStatus("Queue prompt is empty");
      return;
    }

    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        type: "send-prompt",
        text: composedText,
      });
      showStatus(`Sent ${i} of ${total}`);
      setQueueStatus(`Sent ${i} of ${total}`);
    } catch (error) {
      console.error("Send queue error:", error);
      showStatus("Refresh ChatGPT tab and try again");
      setQueueStatus("Queue failed");
      return;
    }

    if (i < total && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  showStatus("Queue complete");
  setQueueStatus("Queue complete");
}

function setQueueStatus(message) {
  const status = document.getElementById("queueStatus");
  if (!status) return;
  status.textContent = message;
}

async function getChatGptTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab && isChatGptUrl(activeTab.url)) {
    return activeTab;
  }
  const matchingTabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  return matchingTabs[0] || null;
}

async function fillPromptWithLlm() {
  const promptInput = document.getElementById("promptInput");
  const text = (promptInput.value || "").trim();
  if (!text) {
    showStatus("Enter a prompt first");
    return;
  }

  showStatus("Filling prompt...");
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${text}`;

  const body = {
    prompt: fullPrompt,
    provider: "command",
    command: "codex",
    codex_model: "",
    codex_session: "new",
    gemini_model: "",
    ollama: { base_url: "", model: "" },
    openai_compatible: { base_url: "", model: "", api_key: "" },
    puter: { model: "gemini-3-flash-preview" },
    gpt4free: { model: "deepseek" },
    images: [],
  };

  try {
    const response = await fetch("https://localhost:3333/api/chat", {
      headers: {
        accept: "*/*",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      method: "POST",
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Request failed: ${response.status}${
          errorText ? ` - ${errorText}` : ""
        }`
      );
    }

    const data = await response.json().catch(() => null);
    const resultText = data && typeof data.text === "string" ? data.text : "";

    if (!resultText) {
      showStatus("No response text");
      return;
    }

    promptInput.value = resultText;
    savePromptState(resultText);
    showStatus("Prompt filled");
  } catch (error) {
    console.error("Fill prompt error:", error);
    showStatus("Fill failed");
  }
}

function abortChat() {
  if (chatAbortController) {
    chatAbortController.abort();
  }
}

async function restoreChatState() {
  const { chatPromptValue = "", chatOutputValue = "" } =
    await chrome.storage.local.get(["chatPromptValue", "chatOutputValue"]);
  const chatPrompt = document.getElementById("chatPrompt");
  const chatOutput = document.getElementById("chatOutput");
  chatPrompt.value = chatPromptValue;
  chatOutput.textContent = chatOutputValue;
}

async function restorePromptState() {
  const { promptInputValue = "" } = await chrome.storage.local.get([
    "promptInputValue",
  ]);
  const promptInput = document.getElementById("promptInput");
  promptInput.value = promptInputValue;
}

async function restoreQueueState() {
  const {
    queuePromptValue = "",
    queueCountValue = "3",
    queueIntervalValue = "5",
  } = await chrome.storage.local.get([
    "queuePromptValue",
    "queueCountValue",
    "queueIntervalValue",
  ]);
  const queuePromptInput = document.getElementById("queuePromptInput");
  const queueCount = document.getElementById("queueCount");
  const queueInterval = document.getElementById("queueInterval");
  queuePromptInput.value = queuePromptValue;
  queueCount.value = queueCountValue;
  queueInterval.value = queueIntervalValue;
}

function saveChatState({ prompt, output }) {
  const data = {};
  if (typeof prompt === "string") data.chatPromptValue = prompt;
  if (typeof output === "string") data.chatOutputValue = output;
  if (Object.keys(data).length > 0) {
    chrome.storage.local.set(data);
  }
}

function savePromptState(value) {
  chrome.storage.local.set({ promptInputValue: value });
}

function saveQueueState({ template, count, interval }) {
  const data = {};
  if (typeof template === "string") data.queuePromptValue = template;
  if (typeof count === "string") data.queueCountValue = count;
  if (typeof interval === "string") data.queueIntervalValue = interval;
  if (Object.keys(data).length > 0) {
    chrome.storage.local.set(data);
  }
}

function useChatOutputAsPrompt() {
  const chatOutput = document.getElementById("chatOutput");
  const promptInput = document.getElementById("promptInput");
  const text = (chatOutput.textContent || "").trim();

  if (!text) {
    showStatus("No chat response to use");
    return;
  }

  promptInput.value = text;
  savePromptState(text);
  setActiveTab("prompt");
  promptInput.focus();
  showStatus("Response moved to Prompt");
}

function isChatGptUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("https://chatgpt.com/") ||
    url.startsWith("https://chat.openai.com/")
  );
}

function openApiTab() {
  chrome.tabs.create({ url: "https://localhost:3333/" });
}

function initCookieTab() {
  const urlInput = document.getElementById("cookieUrl");
  const refreshBtn = document.getElementById("cookieRefresh");
  const useActiveBtn = document.getElementById("cookieUseActive");
  const copyBtn = document.getElementById("cookieCopyJson");
  const clearBtn = document.getElementById("cookieClear");
  const filterInput = document.getElementById("cookieFilter");

  if (
    !urlInput ||
    !refreshBtn ||
    !useActiveBtn ||
    !copyBtn ||
    !clearBtn ||
    !filterInput
  ) {
    return;
  }

  const refreshFromInput = async () => {
    const normalized = normalizeCookieUrl(urlInput.value);
    if (!normalized) {
      setCookieStatus("Enter a valid http(s) URL.");
      return;
    }
    urlInput.value = normalized;
    await loadCookiesForUrl(normalized);
  };

  refreshBtn.addEventListener("click", refreshFromInput);
  useActiveBtn.addEventListener("click", async () => {
    const activeUrl = await getActiveTabUrl();
    if (!activeUrl) {
      setCookieStatus("No active tab with a valid URL.");
      return;
    }
    urlInput.value = activeUrl;
    await loadCookiesForUrl(activeUrl);
  });
  copyBtn.addEventListener("click", async () => {
    if (!currentCookies.length) {
      setCookieStatus("No cookies to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(currentCookies, null, 2)
      );
      setCookieStatus(`Copied ${currentCookies.length} cookies.`);
    } catch (error) {
      console.error("Copy cookies error:", error);
      setCookieStatus("Failed to copy cookies.");
    }
  });
  clearBtn.addEventListener("click", async () => {
    if (!currentCookies.length) {
      setCookieStatus("No cookies to clear.");
      return;
    }
    if (!confirm("Clear all cookies for this site?")) return;
    const targetUrl = normalizeCookieUrl(urlInput.value);
    if (!targetUrl) {
      setCookieStatus("Enter a valid http(s) URL.");
      return;
    }
    await clearCookiesForUrl(targetUrl, currentCookies);
  });
  filterInput.addEventListener("input", () => {
    renderCookieList(currentCookies, filterInput.value);
  });

  getActiveTabUrl().then((url) => {
    if (!url) return;
    urlInput.value = url;
    loadCookiesForUrl(url);
  });
}

function normalizeCookieUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  try {
    const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function setCookieStatus(message) {
  const status = document.getElementById("cookieStatus");
  if (!status) return;
  status.textContent = message;
}

async function loadCookiesForUrl(url) {
  setCookieStatus("Loading cookies...");
  try {
    const cookies = await getCookiesForUrl(url);
    currentCookies = cookies;
    const filterEl = document.getElementById("cookieFilter");
    const filterValue = filterEl ? filterEl.value : "";
    renderCookieList(cookies, filterValue);
    setCookieStatus(`${cookies.length} cookies loaded.`);
  } catch (error) {
    console.error("Load cookies error:", error);
    currentCookies = [];
    renderCookieList([], "");
    setCookieStatus("Failed to load cookies.");
  }
}

function renderCookieList(cookies, filterValue) {
  const list = document.getElementById("cookieList");
  if (!list) return;
  const filter = (filterValue || "").trim().toLowerCase();
  const filtered = filter
    ? cookies.filter((cookie) => {
        const name = (cookie.name || "").toLowerCase();
        const value = (cookie.value || "").toLowerCase();
        return name.includes(filter) || value.includes(filter);
      })
    : cookies;

  currentRenderedCookies = filtered;
  if (!filtered.length) {
    list.innerHTML = '<p class="empty-message">No cookies found.</p>';
    return;
  }

  list.innerHTML = filtered
    .map((cookie, index) => {
      const details = [
        cookie.domain ? `domain: ${cookie.domain}` : "",
        cookie.path ? `path: ${cookie.path}` : "",
        cookie.httpOnly ? "httpOnly" : "",
        cookie.secure ? "secure" : "",
        cookie.sameSite ? `sameSite: ${cookie.sameSite}` : "",
        typeof cookie.expirationDate === "number"
          ? `expires: ${new Date(cookie.expirationDate * 1000).toLocaleString()}`
          : "session",
      ]
        .filter(Boolean)
        .join(" · ");
      const safeValue = cookie.value || "";
      const preview =
        safeValue.length > 200 ? `${safeValue.slice(0, 200)}...` : safeValue;
      return `
        <div class="cookie-item">
          <div class="cookie-meta">
            <div class="cookie-name">${cookie.name || "(no name)"}</div>
            <div class="cookie-value">${preview || "(empty)"}</div>
            <div class="cookie-details">${details}</div>
          </div>
          <button class="cookie-delete" data-index="${index}">Delete</button>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".cookie-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      const cookie = currentRenderedCookies[index];
      if (!cookie) return;
      await removeCookie(cookie);
    });
  });
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url ? tabs[0].url : "";
      if (!url || !/^https?:\/\//i.test(url)) {
        resolve("");
        return;
      }
      try {
        const parsed = new URL(url);
        resolve(parsed.origin);
      } catch {
        resolve("");
      }
    });
  });
}

function getCookiesForUrl(url) {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(cookies || []);
    });
  });
}

function removeCookie(cookie) {
  return new Promise((resolve) => {
    const url = buildCookieUrl(cookie);
    chrome.cookies.remove(
      { url, name: cookie.name, storeId: cookie.storeId },
      async () => {
        if (chrome.runtime.lastError) {
          console.error("Remove cookie error:", chrome.runtime.lastError);
          setCookieStatus("Failed to delete cookie.");
        } else {
          setCookieStatus(`Deleted ${cookie.name}`);
        }
        await loadCookiesForUrl(normalizeCookieUrl(url));
        resolve();
      }
    );
  });
}

function clearCookiesForUrl(url, cookies) {
  return new Promise(async (resolve) => {
    let removed = 0;
    for (const cookie of cookies) {
      await new Promise((done) => {
        const removeUrl = buildCookieUrl(cookie);
        chrome.cookies.remove(
          { url: removeUrl, name: cookie.name, storeId: cookie.storeId },
          () => {
            removed += 1;
            done();
          }
        );
      });
    }
    setCookieStatus(`Cleared ${removed} cookies.`);
    await loadCookiesForUrl(url);
    resolve();
  });
}

function buildCookieUrl(cookie) {
  const protocol = cookie.secure ? "https://" : "http://";
  const host = (cookie.domain || "").replace(/^\./, "");
  const path = cookie.path || "/";
  return `${protocol}${host}${path}`;
}

function parseImageUrlsFromHtml(html) {
  const cleaned = (html || "").trim();
  if (!cleaned) return [];
  const doc = new DOMParser().parseFromString(cleaned, "text/html");
  const urls = [];
  doc.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) urls.push(src.trim());
  });
  doc
    .querySelectorAll('meta[property="og:image"], meta[name="og:image"]')
    .forEach((meta) => {
      const content = meta.getAttribute("content");
      if (content) urls.push(content.trim());
    });
  const unique = new Set();
  return urls.filter((url) => {
    if (!url || unique.has(url)) return false;
    unique.add(url);
    return true;
  });
}

function renderScrapeGallery(urls) {
  scrapedImageUrls = urls;
  const gallery = document.getElementById("scrapeGallery");
  if (!gallery) return;
  if (!urls.length) {
    gallery.innerHTML =
      '<p class="empty-message">No images found. Paste HTML and click Scrape.</p>';
    updateScrapeStatus();
    return;
  }
  gallery.innerHTML = urls
    .map(
      (url, index) => `
    <label class="scrape-item" data-index="${index}">
      <input type="checkbox" data-url="${url}" checked>
      <img src="${url}" alt="Scraped image">
      <div class="scrape-url">${url}</div>
    </label>
  `
    )
    .join("");
  gallery.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", updateScrapeStatus);
  });
  updateScrapeStatus();
}

function updateScrapeStatus() {
  const status = document.getElementById("scrapeStatus");
  const downloadBtn = document.getElementById("downloadScrapeZip");
  const selectBtn = document.getElementById("selectAllScrape");
  const gallery = document.getElementById("scrapeGallery");
  if (!status || !downloadBtn || !selectBtn || !gallery) return;
  const checks = Array.from(
    gallery.querySelectorAll('input[type="checkbox"]')
  );
  const selected = checks.filter((el) => el.checked).length;
  const total = checks.length;
  status.textContent = total
    ? `${selected} of ${total} selected`
    : "No images detected";
  downloadBtn.disabled = selected === 0;
  selectBtn.textContent =
    total > 0 && selected === total ? "Clear selection" : "Select all";
}

function handleScrapeImages() {
  const html = document.getElementById("scrapeHtml").value || "";
  const urls = parseImageUrlsFromHtml(html);
  if (!urls.length) {
    showStatus("No images found in HTML");
  }
  renderScrapeGallery(urls);
}

function handleRefreshScrape() {
  const html = document.getElementById("scrapeHtml").value || "";
  const urls = parseImageUrlsFromHtml(html);
  renderScrapeGallery(urls);
}

async function handleScrapeFromDom() {
  const targetTab = await getChatGptTab();
  if (!targetTab || !targetTab.id) {
    showStatus("Open ChatGPT to scrape images");
    return;
  }
  showStatus("Scraping images...");
  chrome.tabs.sendMessage(
    targetTab.id,
    { type: "scrape-images" },
    (response) => {
      if (chrome.runtime.lastError) {
        showStatus("Refresh ChatGPT tab and try again");
        return;
      }
      const urls = response && Array.isArray(response.urls) ? response.urls : [];
      if (!urls.length) {
        showStatus("No images found on page");
      }
      renderScrapeGallery(urls);
    }
  );
}

function clearScrapeGallery() {
  const input = document.getElementById("scrapeHtml");
  if (input) input.value = "";
  const gallery = document.getElementById("scrapeGallery");
  if (gallery) {
    gallery.innerHTML =
      '<p class="empty-message">Paste HTML and click Scrape.</p>';
  }
  scrapedImageUrls = [];
  updateScrapeStatus();
}

function toggleSelectAllScrape() {
  const gallery = document.getElementById("scrapeGallery");
  if (!gallery) return;
  const checks = Array.from(
    gallery.querySelectorAll('input[type="checkbox"]')
  );
  if (!checks.length) return;
  const allSelected = checks.every((el) => el.checked);
  checks.forEach((el) => {
    el.checked = !allSelected;
  });
  updateScrapeStatus();
}

function getSelectedScrapeUrls() {
  const gallery = document.getElementById("scrapeGallery");
  if (!gallery) return [];
  return Array.from(
    gallery.querySelectorAll('input[type="checkbox"]:checked')
  )
    .map((el) => el.dataset.url)
    .filter(Boolean);
}

function guessFileExtension(url, mimeType) {
  const type = (mimeType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  if (type.includes("avif")) return "avif";
  if (url) {
    const clean = url.split("?")[0].split("#")[0];
    const last = clean.split("/").pop();
    if (last && last.includes(".")) {
      return last.split(".").pop().toLowerCase();
    }
  }
  return "png";
}

function guessFileName(url, index, mimeType, usedNames) {
  let base = "";
  if (url) {
    const clean = url.split("?")[0].split("#")[0];
    base = clean.split("/").pop() || "";
  }
  const ext = guessFileExtension(url, mimeType);
  if (!base || !base.includes(".")) {
    base = `image-${index + 1}.${ext}`;
  }
  const safeBase = base.replace(/[^\w.\-]+/g, "-");
  const key = safeBase.toLowerCase();
  const count = usedNames.get(key) || 0;
  usedNames.set(key, count + 1);
  if (count === 0) return safeBase;
  const parts = safeBase.split(".");
  const suffix = `-${count + 1}`;
  if (parts.length === 1) return `${safeBase}${suffix}`;
  return `${parts.slice(0, -1).join(".")}${suffix}.${parts.at(-1)}`;
}

async function fetchImageData(url, timeoutMs = 8000) {
  const isHttp = /^https?:\/\//i.test(url);
  const fetchUrl = isHttp ? url : url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = null;
    if (isHttp) {
      try {
        response = await fetch(fetchUrl, {
          signal: controller.signal,
          credentials: "include",
        });
      } catch {
        response = null;
      }
      if (!response || !response.ok) {
        const proxyUrl = `https://localhost:3333/api/image-proxy?url=${encodeURIComponent(
          url
        )}`;
        response = await fetch(proxyUrl, { signal: controller.signal });
      }
    } else {
      response = await fetch(fetchUrl, { signal: controller.signal });
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${url}`);
    }
    const mimeType = response.headers.get("content-type") || "";
    const data = await response.arrayBuffer();
    return { data, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadScrapeZip() {
  const status = document.getElementById("scrapeStatus");
  const urls = getSelectedScrapeUrls();
  if (!urls.length) {
    if (status) status.textContent = "No images selected";
    return;
  }
  if (status) status.textContent = "Downloading images...";
  const usedNames = new Map();
  const entries = [];
  let failed = 0;
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (status) status.textContent = `Downloading ${i + 1} of ${urls.length}...`;
    try {
      const { data, mimeType } = await fetchImageData(url);
      const name = guessFileName(url, entries.length, mimeType, usedNames);
      entries.push({ name, data: new Uint8Array(data) });
    } catch {
      failed += 1;
    }
  }
  if (!entries.length) {
    if (status) status.textContent = "Download failed";
    return;
  }
  const blob = createZipBlob(entries);
  triggerDownload(blob, `scraped-images-${Date.now()}.zip`);
  if (status) {
    status.textContent = failed
      ? `${entries.length} zipped, ${failed} failed`
      : `${entries.length} images zipped`;
  }
}

async function downloadImagesIndividually(images) {
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const base64Data = img.dataUrl.split(",")[1];
    const ext = img.mimeType?.includes("jpeg") ? "jpg" : "png";
    const bytes = base64ToBytes(base64Data);
    const blob = new Blob([bytes], { type: img.mimeType || "image/png" });
    const name = `${img.preset || "image"}_${i + 1}.${ext}`;
    triggerDownload(blob, name);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function downloadScrapeImagesIndividually(urls, status) {
  const usedNames = new Map();
  let added = 0;
  let failed = 0;
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (status) status.textContent = `Downloading ${i + 1} of ${urls.length}...`;
    try {
      const name = guessFileName(url, added, "", usedNames);
      const directResult = await downloadUrlWithApi(url, name);
      if (!directResult) {
        const { data, mimeType } = await fetchImageData(url);
        const fallbackName = guessFileName(url, added, mimeType, usedNames);
        const blob = new Blob([data], {
          type: mimeType || "application/octet-stream",
        });
        triggerDownload(blob, fallbackName);
      }
      added += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      failed += 1;
    }
  }
  if (status) {
    status.textContent = failed
      ? `${added} downloaded, ${failed} failed`
      : `${added} images downloaded`;
  }
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadUrlWithApi(url, filename) {
  return new Promise((resolve) => {
    if (!chrome?.downloads || !/^https?:\/\//i.test(url)) {
      resolve(false);
      return;
    }
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function createZipBlob(entries) {
  const encoder = new TextEncoder();
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(dataBytes);
    const modTime = dosTime(new Date());

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, modTime.time, true);
    view.setUint16(12, modTime.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, dataBytes.length, true);
    view.setUint32(22, dataBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(centralHeader.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, modTime.time, true);
    cview.setUint16(14, modTime.date, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, dataBytes.length, true);
    cview.setUint32(24, dataBytes.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    fileRecords.push(localHeader, dataBytes);
    centralRecords.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralSize = centralRecords.reduce((sum, rec) => sum + rec.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8, centralRecords.length, true);
  eview.setUint16(10, centralRecords.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);
  eview.setUint16(20, 0, true);

  const blobs = [...fileRecords, ...centralRecords, end].map(
    (chunk) => new Blob([chunk])
  );
  return new Blob(blobs, { type: "application/zip" });
}

function dosTime(date) {
  const year = date.getFullYear() - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosDate = (year << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { date: dosDate, time: dosTime };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
