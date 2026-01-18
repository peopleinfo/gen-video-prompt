chrome.runtime.onInstalled.addListener(() => {
  console.log('ChatGPT Image Generator extension installed');
  chrome.storage.local.set({ generatedImages: [] });
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_IMAGES') {
    chrome.storage.local.get(['generatedImages'], (result) => {
      sendResponse({ images: result.generatedImages || [] });
    });
    return true;
  }
  
  if (message.type === 'SAVE_IMAGE') {
    chrome.storage.local.get(['generatedImages'], (result) => {
      const images = result.generatedImages || [];
      images.push(message.image);
      chrome.storage.local.set({ generatedImages: images }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
});
