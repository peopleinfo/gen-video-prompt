(() => {
  const SETTINGS_KEY = 'gen-video-prompt.gui.settings.v1';
  const inputId = 'downloadCookie';

  function updateSettingsCookie(cookie) {
    if (!cookie) return;
    let settings = {};
    try {
      settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch {
      settings = {};
    }
    const existing =
      typeof settings.downloadCookie === 'string'
        ? settings.downloadCookie.trim()
        : '';
    if (!existing) {
      settings.downloadCookie = cookie;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    const input = document.getElementById(inputId);
    if (input && !input.value) {
      input.value = cookie;
    }
  }

  function requestCookie() {
    chrome.runtime.sendMessage(
      { type: 'GET_CHATGPT_COOKIE', url: 'https://chatgpt.com/' },
      (response) => {
        if (!response || !response.ok || !response.cookie) return;
        updateSettingsCookie(response.cookie);
      }
    );
  }

  requestCookie();
})();
