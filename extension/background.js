// background.js — Service Worker (Manifest V3)
// 拡張アイコンをクリックしたとき、content.js に選択モード切替を通知する

const ext = globalThis.browser ?? globalThis.chrome;

ext.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  ext.tabs.sendMessage(tab.id, { action: 'toggleSelectionMode' });
});
