chrome.action.onClicked.addListener(tab => {
  chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files: ['imgwhy.js'] });
});
