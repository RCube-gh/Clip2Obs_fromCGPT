// content.js — Clip2Obs selection UI
// Handles dynamically rendered conversation pages (including ChatGPT).

(function () {
  'use strict';

  let selectionMode = false;
  let selectedMessageKeys = new Set();
  let lastClickedKey = null;
  let floatingBar = null;
  let observer = null;
  let isCopyingAll = false;

  function getMessageKey(element, index) {
    // ChatGPT assigns stable IDs to each message. Other supported services do
    // not necessarily have one, so retain a local key on the element instead.
    const id = element.getAttribute('data-message-id');
    if (id) return `message:${id}`;

    const turnId = element.closest('[data-turn-id]')?.getAttribute('data-turn-id');
    if (turnId) return `turn:${turnId}:${element.getAttribute('data-message-author-role') || ''}`;

    if (!element.dataset.clip2obsKey) {
      element.dataset.clip2obsKey = `local:${crypto.randomUUID?.() || `${Date.now()}-${index}`}`;
    }
    return element.dataset.clip2obsKey;
  }

  function getMessagesWithKeys() {
    return getMessageElements().map((element, index) => ({
      element,
      key: getMessageKey(element, index),
    }));
  }

  function syncMessageClasses() {
    getMessagesWithKeys().forEach(({ element, key }) => {
      element.classList.toggle('clip2obs-selectable', selectionMode);
      element.classList.toggle('clip2obs-selected', selectedMessageKeys.has(key));
    });
  }

  function createFloatingBar() {
    const bar = document.createElement('div');
    bar.id = 'clip2obs-bar';
    bar.innerHTML = `
      <span id="clip2obs-mode-label">📌 Selection Mode</span>
      <span id="clip2obs-count">0 selected</span>
      <button id="clip2obs-copy-btn">📋 Copy</button>
      <button id="clip2obs-copy-all-btn">📚 Copy all</button>
      <button id="clip2obs-clear-btn">✕ Clear</button>
      <button id="clip2obs-exit-btn">Exit</button>
    `;
    document.body.appendChild(bar);

    bar.querySelector('#clip2obs-copy-btn').addEventListener('click', copySelected);
    bar.querySelector('#clip2obs-copy-all-btn').addEventListener('click', copyAllMessages);
    bar.querySelector('#clip2obs-clear-btn').addEventListener('click', clearSelection);
    bar.querySelector('#clip2obs-exit-btn').addEventListener('click', exitSelectionMode);
    return bar;
  }

  function updateFloatingBar() {
    if (!floatingBar) return;
    const count = selectedMessageKeys.size;
    floatingBar.querySelector('#clip2obs-count').textContent =
      count === 1 ? '1 selected' : `${count} selected`;
    floatingBar.querySelector('#clip2obs-copy-btn').disabled = count === 0;
  }

  function setCopyAllBusy(isBusy) {
    if (!floatingBar) return;
    const button = floatingBar.querySelector('#clip2obs-copy-all-btn');
    button.disabled = isBusy;
    button.textContent = isBusy ? '⌛ Collecting…' : '📚 Copy all';
    floatingBar.querySelector('#clip2obs-copy-btn').disabled = isBusy || selectedMessageKeys.size === 0;
    floatingBar.querySelector('#clip2obs-clear-btn').disabled = isBusy;
    floatingBar.querySelector('#clip2obs-exit-btn').disabled = isBusy;
  }

  function observeConversationChanges() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (selectionMode) syncMessageClasses();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function enterSelectionMode() {
    selectionMode = true;
    document.body.classList.add('clip2obs-active');

    if (!floatingBar) floatingBar = createFloatingBar();
    floatingBar.style.display = 'flex';
    syncMessageClasses();
    updateFloatingBar();
    observeConversationChanges();
  }

  function exitSelectionMode() {
    selectionMode = false;
    observer?.disconnect();
    observer = null;
    document.body.classList.remove('clip2obs-active');
    clearSelection();
    syncMessageClasses();

    if (floatingBar) floatingBar.style.display = 'none';
  }

  function clearSelection() {
    selectedMessageKeys.clear();
    lastClickedKey = null;
    syncMessageClasses();
    updateFloatingBar();
  }

  function selectRange(messages, startKey, endKey) {
    const start = messages.findIndex(message => message.key === startKey);
    const end = messages.findIndex(message => message.key === endKey);
    if (start === -1 || end === -1) return false;

    const [from, to] = start < end ? [start, end] : [end, start];
    messages.slice(from, to + 1).forEach(message => selectedMessageKeys.add(message.key));
    return true;
  }

  // Listen on window so ChatGPT's own click handlers cannot consume the event
  // before a dynamically added message reaches this extension.
  function handleWindowClick(event) {
    if (!selectionMode || isCopyingAll || floatingBar?.contains(event.target)) return;

    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const messageElement = target?.closest?.('[data-message-author-role]');
    if (!messageElement) return;

    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();

    const messages = getMessagesWithKeys();
    const clicked = messages.find(message => message.element === messageElement);
    if (!clicked) return;

    if (event.shiftKey && lastClickedKey && selectRange(messages, lastClickedKey, clicked.key)) {
      // Range selection only adds messages, matching standard shift-click behavior.
    } else if (selectedMessageKeys.has(clicked.key)) {
      selectedMessageKeys.delete(clicked.key);
      lastClickedKey = clicked.key;
    } else {
      selectedMessageKeys.add(clicked.key);
      lastClickedKey = clicked.key;
    }

    syncMessageClasses();
    updateFloatingBar();
  }

  function copySelected() {
    if (selectedMessageKeys.size === 0) return;

    const selected = getMessagesWithKeys()
      .filter(message => selectedMessageKeys.has(message.key))
      .map(message => message.element);
    const markdown = '\n' + convertMessagesToMarkdown(selected);

    navigator.clipboard.writeText(markdown).then(flashCopySuccess).catch(error => {
      console.error('[Clip2Obs] clipboard error:', error);
    });
  }

  function getConversationScrollContainer() {
    // ChatGPT's current application shell exposes its actual conversation
    // scroller explicitly. Prefer it over a generic overflow ancestor.
    const chatGptScrollRoot = document.querySelector('[data-scroll-root]');
    if (chatGptScrollRoot) return chatGptScrollRoot;

    const firstMessage = getMessageElements()[0];
    for (let element = firstMessage?.parentElement; element && element !== document.body; element = element.parentElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
        return element;
      }
    }
    return document.scrollingElement;
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitForRenderedMessages(collectVisibleMessages, scrollContainer) {
    // A programmatic scroll can cause ChatGPT to replace its visible turns on
    // a later rendering pass. In particular, bottom turns can arrive after a
    // short quiet period, so always allow one second before judging the DOM.
    await wait(1000);

    // Then collect repeatedly until the rendered message IDs and scroll height
    // have stopped changing twice in a row.
    let previousSnapshot = '';
    let stablePasses = 0;

    for (let pass = 0; pass < 4; pass += 1) {
      await wait(120);
      collectVisibleMessages();

      const visibleKeys = getMessagesWithKeys().map(message => message.key).join('|');
      const snapshot = `${scrollContainer.scrollHeight}:${visibleKeys}`;
      if (snapshot === previousSnapshot) {
        stablePasses += 1;
        if (stablePasses >= 2) return;
      } else {
        previousSnapshot = snapshot;
        stablePasses = 0;
      }
    }
  }

  async function copyAllMessages() {
    if (isCopyingAll) return;

    const scrollContainer = getConversationScrollContainer();
    if (!scrollContainer) {
      console.error('[Clip2Obs] could not find the conversation scroll container');
      return;
    }

    isCopyingAll = true;
    setCopyAllBusy(true);
    const originalScrollTop = scrollContainer.scrollTop;
    const messages = new Map();
    const seenTurnNumbers = new Set();
    let discoveryOrder = 0;

    const collectVisibleMessages = () => {
      getMessagesWithKeys().forEach(({ element, key }) => {
        const turnTestId = element.closest('[data-testid^="conversation-turn-"]')?.dataset.testid;
        const turnNumber = Number.parseInt(turnTestId?.replace('conversation-turn-', ''), 10);
        if (Number.isInteger(turnNumber)) seenTurnNumbers.add(turnNumber);

        if (!messages.has(key)) {
          messages.set(key, {
            markdown: convertMessageToMarkdown(element),
            turnNumber: Number.isInteger(turnNumber) ? turnNumber : null,
            discoveryOrder: discoveryOrder++,
          });
        }
      });
    };

    const missingTurnNumbers = () => {
      const highestTurn = Math.max(0, ...seenTurnNumbers);
      return Array.from({ length: highestTurn }, (_, index) => index + 1)
        .filter(turnNumber => !seenTurnNumbers.has(turnNumber));
    };

    const walkConversation = async (viewportFraction) => {
      scrollContainer.scrollTop = 0;
      await waitForRenderedMessages(collectVisibleMessages, scrollContainer);

      const maxSteps = 2000;
      for (let step = 0; step < maxSteps; step += 1) {
        const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        if (scrollContainer.scrollTop >= maxScrollTop - 1) {
          await waitForRenderedMessages(collectVisibleMessages, scrollContainer);
          return true;
        }

        const nextScrollTop = Math.min(
          maxScrollTop,
          scrollContainer.scrollTop + Math.max(100, Math.floor(scrollContainer.clientHeight * viewportFraction)),
        );
        if (nextScrollTop <= scrollContainer.scrollTop) return false;
        scrollContainer.scrollTop = nextScrollTop;
        await waitForRenderedMessages(collectVisibleMessages, scrollContainer);
      }
      return false;
    };

    let copied = false;
    let copyError = null;
    try {
      // ChatGPT may virtualize long conversations. First do a normal
      // overlapping pass. If ChatGPT's numbered turns reveal a gap, retry
      // with much smaller moves so no rendered viewport is skipped.
      if (!await walkConversation(0.75)) {
        throw new Error('stopped before the end of the conversation');
      }

      let missingTurns = missingTurnNumbers();
      if (missingTurns.length > 0) {
        console.info('[Clip2Obs] retrying missed ChatGPT turns:', missingTurns);
        if (!await walkConversation(0.25)) {
          throw new Error('the detailed pass stopped before the end of the conversation');
        }
        missingTurns = missingTurnNumbers();
      }

      if (missingTurns.length > 0) {
        throw new Error(`could not render ChatGPT turns: ${missingTurns.join(', ')}`);
      }

      // ChatGPT assigns conversation-turn-N in chronological order. A
      // virtualized page may render the bottom turns before the top ones, so
      // Map insertion order is not the conversation order.
      const orderedMessages = Array.from(messages.values())
        .sort((left, right) => {
          if (left.turnNumber !== null && right.turnNumber !== null) {
            return left.turnNumber - right.turnNumber;
          }
          return left.discoveryOrder - right.discoveryOrder;
        });
      const markdown = '\n' + orderedMessages.map(message => message.markdown).join('\n\n');
      if (!messages.size) throw new Error('no conversation messages were found');
      console.info(
        `[Clip2Obs] copy all report: collected=${messages.size}, highestChatGptTurn=${Math.max(0, ...seenTurnNumbers)}`,
      );
      await navigator.clipboard.writeText(markdown);
      copied = true;
      flashCopySuccess('#clip2obs-copy-all-btn');
    } catch (error) {
      console.error('[Clip2Obs] copy all error:', error);
      copyError = error;
    } finally {
      scrollContainer.scrollTop = originalScrollTop;
      isCopyingAll = false;
      if (copied) {
        // Keep the success label until flashCopySuccess closes the bar, but
        // release the other controls immediately for the next invocation.
        floatingBar?.querySelector('#clip2obs-copy-all-btn').removeAttribute('disabled');
        floatingBar?.querySelector('#clip2obs-clear-btn').removeAttribute('disabled');
        floatingBar?.querySelector('#clip2obs-exit-btn').removeAttribute('disabled');
        updateFloatingBar();
      } else {
        setCopyAllBusy(false);
        if (copyError) {
          const button = floatingBar?.querySelector('#clip2obs-copy-all-btn');
          if (button) {
            button.textContent = '⚠ Copy failed';
            setTimeout(() => {
              if (!isCopyingAll && button.textContent === '⚠ Copy failed') {
                button.textContent = '📚 Copy all';
              }
            }, 4000);
          }
        }
      }
    }
  }

  function flashCopySuccess(buttonSelector = '#clip2obs-copy-btn') {
    const button = floatingBar?.querySelector(buttonSelector);
    if (!button) return;
    button.textContent = '✅ Copied!';
    button.classList.add('clip2obs-copied');
    setTimeout(() => {
      button.textContent = buttonSelector === '#clip2obs-copy-all-btn' ? '📚 Copy all' : '📋 Copy';
      button.classList.remove('clip2obs-copied');
      exitSelectionMode();
    }, 1500);
  }

  window.addEventListener('click', handleWindowClick, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== 'toggleSelectionMode') return;
    if (selectionMode) exitSelectionMode();
    else enterSelectionMode();
  });
})();
