let chatAbortController = null;
let setActiveTab = () => {};
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
    const zip = new JSZip();

    images.forEach((img, index) => {
      const base64Data = img.dataUrl.split(",")[1];
      const ext = img.mimeType?.includes("jpeg") ? "jpg" : "png";
      zip.file(`${img.preset}_${index + 1}.${ext}`, base64Data, {
        base64: true,
      });
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "generated-images.zip";
    a.click();

    URL.revokeObjectURL(url);
    showStatus("ZIP downloaded!");
  } catch (error) {
    console.error("ZIP error:", error);
    showStatus("Error creating ZIP");
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
