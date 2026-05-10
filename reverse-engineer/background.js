// Service worker. Apenas garante que clicar no icone da extensao abre
// o sidepanel. Toda a logica acontece na sidepanel + content-bridge.

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open) {
    try { await chrome.sidePanel.open({ tabId: tab.id }); } catch {}
  }
});
