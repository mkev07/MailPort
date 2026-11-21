browser.browserAction.onClicked.addListener(() => {
  return browser.tabs.create({ url: browser.runtime.getURL("import.html") });
});
