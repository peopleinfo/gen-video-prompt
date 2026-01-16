async function createButtonPanel() {
  if (document.getElementById('img-gen-panel')) return;

  const toggle = document.createElement('button');
  toggle.id = 'img-gen-float-toggle';
  toggle.type = 'button';
  toggle.textContent = '<';
  toggle.setAttribute('aria-label', 'Collapse panel');

  const panel = document.createElement('div');
  panel.id = 'img-gen-panel';
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

  const stored = await chrome.storage.local.get(['panelCollapsed']);
  const isCollapsed = stored.panelCollapsed !== false;
  if (isCollapsed) {
    panel.classList.add('collapsed');
  }
  toggle.setAttribute('aria-label', isCollapsed ? 'Expand panel' : 'Collapse panel');
  toggle.textContent = isCollapsed ? '>' : '<';

  const input = panel.querySelector('.img-gen-input');
  const button = panel.querySelector('.img-gen-btn');

  button.addEventListener('click', () => {
    pasteAndSendPrompt(input.value);
    input.value = '';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      pasteAndSendPrompt(input.value);
      input.value = '';
    }
  });

  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    const isCollapsed = panel.classList.contains('collapsed');
    toggle.setAttribute(
      'aria-label',
      isCollapsed ? 'Expand panel' : 'Collapse panel'
    );
    toggle.textContent = isCollapsed ? '>' : '<';
    chrome.storage.local.set({ panelCollapsed: isCollapsed });
  });
}

function findChatInput() {
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector('textarea[data-id="root"]') ||
    document.querySelector('textarea') ||
    document.querySelector('[contenteditable="true"][role="textbox"]') ||
    document.querySelector('[contenteditable="true"]')
  );
}

function pasteAndSendPrompt(promptText) {
  const text = (promptText || '').trim();
  if (!text) return;

  const inputEl = findChatInput();
  if (!inputEl) return;

  inputEl.focus();

  if (inputEl.isContentEditable) {
    inputEl.textContent = text;
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setTimeout(() => {
    const sendBtn = document.querySelector(
      'button[data-testid="send-button"], button[aria-label*="Send"]'
    );
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return;
    }

    inputEl.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' })
    );
    inputEl.dispatchEvent(
      new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' })
    );
    inputEl.dispatchEvent(
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' })
    );
  }, 1500);
}

function fillPanelInput(promptText) {
  const text = (promptText || '').trim();
  if (!text) return;
  const input = document.querySelector('.img-gen-input');
  if (!input) return;
  input.value = text;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

setTimeout(createButtonPanel, 1000);

const observer = new MutationObserver(() => {
  if (!document.getElementById('img-gen-panel')) {
    createButtonPanel();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === 'fill-prompt') {
    fillPanelInput(message.text);
    return;
  }
  if (message.type === 'send-prompt') {
    fillPanelInput(message.text);
    pasteAndSendPrompt(message.text);
  }
});
