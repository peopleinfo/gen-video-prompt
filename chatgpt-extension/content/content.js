var pendingTimeout = null;
var pendingResolve = null;

async function createButtonPanel() {
  if (document.getElementById("img-gen-panel")) return;

  const toggle = document.createElement("button");
  toggle.id = "img-gen-float-toggle";
  toggle.type = "button";
  toggle.textContent = "<";
  toggle.setAttribute("aria-label", "Collapse panel");

  const panel = document.createElement("div");
  panel.id = "img-gen-panel";
  panel.innerHTML = `
    <div class="img-gen-header">Prompt Chat</div>
    <div class="img-gen-body">
      <input class="img-gen-input" type="text" placeholder="Type your prompt" />
      <button class="img-gen-btn" type="button" aria-label="Send prompt">
      <svg class="img-gen-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 11.5l17-8-4.8 17-4.3-6.3L3 11.5z"></path>
      </svg>
      </button>
    </div>
  `;

  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  const stored = await chrome.storage.local.get(["panelCollapsed"]);
  const isCollapsed = stored.panelCollapsed !== false;
  if (isCollapsed) {
    panel.classList.add("collapsed");
  }
  toggle.setAttribute(
    "aria-label",
    isCollapsed ? "Expand panel" : "Collapse panel",
  );
  toggle.textContent = isCollapsed ? ">" : "<";

  const input = panel.querySelector(".img-gen-input");
  const button = panel.querySelector(".img-gen-btn");

  button.addEventListener("click", () => {
    pasteAndSendPrompt(input.value);
    input.value = "";
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pasteAndSendPrompt(input.value);
      input.value = "";
    }
  });

  toggle.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    const isCollapsed = panel.classList.contains("collapsed");
    toggle.setAttribute(
      "aria-label",
      isCollapsed ? "Expand panel" : "Collapse panel",
    );
    toggle.textContent = isCollapsed ? ">" : "<";
    chrome.storage.local.set({ panelCollapsed: isCollapsed });
  });
}

function findChatInput() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector('textarea[data-id="root"]') ||
    document.querySelector("textarea") ||
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('[contenteditable="true"]')
  );
}

function inputText(text) {
  const inputEl = findChatInput();
  if (!inputEl) return false;

  inputEl.focus();

  if (inputEl.isContentEditable) {
    inputEl.textContent = text;
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
  } else {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
}

function triggerSend() {
  const sendBtn = document.querySelector(
    'button[data-testid="send-button"], button[aria-label*="Send"]',
  );
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    return;
  }

  const inputEl = findChatInput();
  if (!inputEl) return;

  inputEl.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
    }),
  );
  inputEl.dispatchEvent(
    new KeyboardEvent("keypress", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
    }),
  );
  inputEl.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
    }),
  );
}

function pasteAndSendPrompt(promptText) {
  const text = (promptText || "").trim();
  if (!text) return;

  inputText(text);

  if (typeof pendingTimeout !== "undefined" && pendingTimeout)
    clearTimeout(pendingTimeout);
  pendingTimeout = setTimeout(() => {
    triggerSend();
    pendingTimeout = null;
  }, 1500);
}

function fillPanelInput(promptText) {
  const text = (promptText || "").trim();
  if (!text) return;
  const input = document.querySelector(".img-gen-input");
  if (!input) return;
  input.value = text;
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

setTimeout(createButtonPanel, 1000);

const observer = new MutationObserver(() => {
  if (!document.getElementById("img-gen-panel")) {
    createButtonPanel();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "fill-prompt") {
    fillPanelInput(message.text);
    return;
  }
  if (message.type === "send-prompt") {
    fillPanelInput(message.text);
    pasteAndSendPrompt(message.text);
    return;
  }
  if (message.type === "send-prompt-with-image") {
    fillPanelInput(message.text);
    handleSendPromptWithImage(
      message.text,
      message.fileData,
      message.fileName,
      message.fileType,
      message.delayMs,
    )
      .then(() => sendResponse({ status: "done" }))
      .catch((err) =>
        sendResponse({ status: "error", message: err.toString() }),
      );
    return true;
  }
  if (message.type === "scrape-images") {
    const urls = collectImageUrls();
    sendResponse({ urls });
  }
  if (message.type === "cancel-send") {
    handleCancelSend();
  }
});

function handleCancelSend() {
  if (typeof pendingTimeout !== "undefined" && pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  if (typeof pendingResolve !== "undefined" && pendingResolve) {
    pendingResolve();
    pendingResolve = null;
  }
  const stopBtn = document.querySelector(
    'button[aria-label="Stop generating"]',
  );
  if (stopBtn) {
    stopBtn.click();
  }
}

async function handleSendPromptWithImage(
  text,
  fileData,
  fileName,
  fileType,
  delayMs,
) {
  const inputEl = findChatInput();
  if (!inputEl) return;

  try {
    const res = await fetch(fileData);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: fileType });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dataTransfer,
    });

    inputEl.focus();
    inputEl.dispatchEvent(dropEvent);

    // Insert text immediately after a brief delay to allow drop to initiate
    setTimeout(() => {
      inputText(text);
    }, 500);

    // Wait for upload to process before sending text
    if (typeof pendingTimeout !== "undefined" && pendingTimeout)
      clearTimeout(pendingTimeout);

    await new Promise((resolve) => {
      pendingResolve = resolve;
      pendingTimeout = setTimeout(() => {
        triggerSend();
        pendingTimeout = null;
        pendingResolve = null;
        resolve();
      }, delayMs || 2500);
    });
  } catch (err) {
    console.error("Failed to upload image:", err);
    pasteAndSendPrompt(text);
  }
}

function collectImageUrls() {
  const urls = [];
  // Images
  document.body.querySelectorAll("img[src]").forEach((img) => {
    if ((img.getAttribute("alt") || "").trim() !== "Generated image") return;
    const src = img.getAttribute("src");
    if (!src) return;
    urls.push(normalizeUrl(src));
  });

  // Videos (Sora / OpenAI)
  document.body.querySelectorAll("video[src], source[src]").forEach((el) => {
    const src = el.getAttribute("src");
    if (src) {
      urls.push(normalizeUrl(src));
    }
  });

  const unique = new Set();
  return urls.filter((url) => {
    if (!url || unique.has(url)) return false;
    unique.add(url);
    return true;
  });
}

function normalizeUrl(raw) {
  try {
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
}
