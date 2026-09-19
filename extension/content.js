// content.js — Clip2Obs メインスクリプト
// 選択モード / ホバー強調 / Shiftクリック / フローティングバー

(function () {
  'use strict';

  // ─── 状態 ───────────────────────────────────────────────────────────
  let selectionMode = false;
  let selectedMessages = new Set();   // 選択中の Element の集合
  let lastClickedIndex = -1;          // Shift クリック用の基点インデックス
  let floatingBar = null;

  // ─── メッセージ要素の取得 ────────────────────────────────────────────
  // 各サービス用の converter_*.js で定義された getMessageElements() を使用

  // ─── フローティングバー ──────────────────────────────────────────────
  function createFloatingBar() {
    const bar = document.createElement('div');
    bar.id = 'clip2obs-bar';
    bar.innerHTML = `
      <span id="clip2obs-mode-label">📌 Selection Mode</span>
      <span id="clip2obs-count">0 selected</span>
      <button id="clip2obs-copy-btn">📋 Copy</button>
      <button id="clip2obs-clear-btn">✕ Clear</button>
      <button id="clip2obs-exit-btn">Exit</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('clip2obs-copy-btn')
      .addEventListener('click', copySelected);
    document.getElementById('clip2obs-clear-btn')
      .addEventListener('click', clearSelection);
    document.getElementById('clip2obs-exit-btn')
      .addEventListener('click', exitSelectionMode);

    return bar;
  }

  function updateFloatingBar() {
    if (!floatingBar) return;
    const count = selectedMessages.size;
    document.getElementById('clip2obs-count').textContent =
      count === 1 ? '1 selected' : `${count} selected`;

    const copyBtn = document.getElementById('clip2obs-copy-btn');
    copyBtn.disabled = count === 0;
  }

  // ─── 選択モード ON ───────────────────────────────────────────────────
  function enterSelectionMode() {
    selectionMode = true;
    document.body.classList.add('clip2obs-active');

    if (!floatingBar) {
      floatingBar = createFloatingBar();
    }
    floatingBar.style.display = 'flex';
    updateFloatingBar();

    // 各メッセージにインデックスを付与してイベントを登録
    getMessageElements().forEach((el, index) => {
      el.classList.add('clip2obs-selectable');
      el.dataset.clip2obsIdx = index;
      el.addEventListener('click', handleMessageClick, true);
    });
  }

  // ─── 選択モード OFF ──────────────────────────────────────────────────
  function exitSelectionMode() {
    selectionMode = false;
    document.body.classList.remove('clip2obs-active');

    clearSelection();

    getMessageElements().forEach(el => {
      el.classList.remove(
        'clip2obs-selectable',
        'clip2obs-selected'
      );
      el.removeEventListener('click', handleMessageClick, true);
    });

    if (floatingBar) {
      floatingBar.style.display = 'none';
    }
  }

  // ─── クリックハンドラ ─────────────────────────────────────────────────
  function handleMessageClick(e) {
    if (!selectionMode) return;

    e.preventDefault();
    e.stopPropagation();

    // Shift+クリックでブラウザのテキスト選択が走るのをクリア
    window.getSelection().removeAllRanges();

    const messages = getMessageElements();
    const clickedIndex = parseInt(this.dataset.clip2obsIdx, 10);

    if (e.shiftKey && lastClickedIndex !== -1) {
      // ─── Shift クリック: 範囲選択 ───────────────────────────────
      const start = Math.min(lastClickedIndex, clickedIndex);
      const end   = Math.max(lastClickedIndex, clickedIndex);
      for (let i = start; i <= end; i++) {
        selectedMessages.add(messages[i]);
        messages[i].classList.add('clip2obs-selected');
      }
    } else {
      // ─── 通常クリック: トグル ────────────────────────────────────
      if (selectedMessages.has(this)) {
        selectedMessages.delete(this);
        this.classList.remove('clip2obs-selected');
      } else {
        selectedMessages.add(this);
        this.classList.add('clip2obs-selected');
      }
      lastClickedIndex = clickedIndex;
    }

    updateFloatingBar();
  }

  // ─── クリア ───────────────────────────────────────────────────────────
  function clearSelection() {
    selectedMessages.forEach(el =>
      el.classList.remove('clip2obs-selected')
    );
    selectedMessages.clear();
    lastClickedIndex = -1;
    updateFloatingBar();
  }

  // ─── コピー ───────────────────────────────────────────────────────────
  function copySelected() {
    if (selectedMessages.size === 0) return;

    // DOM 順にソート
    const allMessages = getMessageElements();
    const sorted = allMessages.filter(el => selectedMessages.has(el));

    const markdown = '\n' + convertMessagesToMarkdown(sorted);

    navigator.clipboard.writeText(markdown).then(() => {
      flashCopySuccess();
    }).catch(err => {
      console.error('[Clip2Obs] clipboard error:', err);
    });
  }

  function flashCopySuccess() {
    const btn = document.getElementById('clip2obs-copy-btn');
    if (!btn) return;
    btn.textContent = '✅ Copied!';
    btn.classList.add('clip2obs-copied');
    setTimeout(() => {
      exitSelectionMode();
    }, 1500);
  }

  // ─── 拡張アイコンからのメッセージ受信 ──────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'toggleSelectionMode') {
      if (selectionMode) {
        exitSelectionMode();
      } else {
        enterSelectionMode();
      }
    }
  });

})();
