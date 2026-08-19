(() => {
  'use strict';

  const state = {
    status: 'waiting', // waiting | recording | finished | stopped
    messages: [],
    processedNodes: new WeakSet(),
    observer: null,
    observerTarget: null,
    scanTimer: null,
    retryTimer: null,
    persistTimer: null,
    startedAt: null,
    endedAt: null,
    title: document.title,
    lastMessageAt: null,
    finishReason: null
  };

  const CHAT_CONTAINER_SELECTORS = [
    '[data-testid="chat-message-list"]',
    'ul[class*="chat-message-list"]',
    '[class*="chat-messages"]',
    '[class*="ChatMessages"]',
    '[class*="chat-list"]',
    '[class*="ChatList"]',
    '[role="log"]',
    '[aria-label*="chat" i]'
  ];

  const MESSAGE_SELECTORS = [
    'li[data-group="true"].chat-message',
    'li.chat-message',
    'li[class*="chat-message"]',
    '[data-testid="chat-message"]',
    '[role="listitem"][class*="ChatMessage"]'
  ].join(', ');

  function findChatContainer() {
    for (const selector of CHAT_CONTAINER_SELECTORS) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch (_) { /* Ignore unsupported selectors. */ }
    }
    return document.querySelector(MESSAGE_SELECTORS)?.parentElement || null;
  }

  function isMessageElement(element) {
    if (!(element instanceof Element)) return false;
    try { return element.matches(MESSAGE_SELECTORS); } catch (_) { return false; }
  }

  function textFrom(element, selectors) {
    for (const selector of selectors) {
      const value = element.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return '';
  }

  function readMessage(row) {
    const author = textFrom(row, [
      // Vimeo Live'in mevcut satır yapısı:
      // li.chat-message > ... > p.chat-message-author-name-label
      '.chat-message-author-name-label', '.chat-message-author-name-label p',
      'p[class*="author-name"]', '[class*="author-name"]', '[class*="AuthorName"]',
      '[data-testid*="author"]', '[data-testid*="username"]', '[class*="username"]', '[class*="UserName"]'
    ]);
    const text = textFrom(row, [
      'p.chat-message-content',
      '.chat-message-content', '[class*="message-content"]', '[class*="MessageContent"]',
      '[data-testid*="message-content"]'
    ]);
    const displayTime = textFrom(row, [
      'p.chat-message-time',
      '.chat-message-time', '[class*="message-time"]', '[class*="MessageTime"]', 'time'
    ]);
    return { author, text, displayTime };
  }

  function queuePersist() {
    if (state.persistTimer) return;
    state.persistTimer = setTimeout(() => {
      state.persistTimer = null;
      chrome.runtime.sendMessage({ type: 'PERSIST_RECORDING', recording: serializableState() }).catch(() => {});
    }, 750);
  }

  function serializableState() {
    return {
      status: state.status,
      title: state.title,
      url: location.href,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      updatedAt: new Date().toISOString(),
      finishReason: state.finishReason,
      messageCount: state.messages.length,
      messages: state.messages
    };
  }

  function setStatus(status, reason = null) {
    state.status = status;
    if (status === 'recording' && !state.startedAt) state.startedAt = new Date().toISOString();
    if ((status === 'finished' || status === 'stopped') && !state.endedAt) state.endedAt = new Date().toISOString();
    if (reason) state.finishReason = reason;
    queuePersist();
  }

  function recordRow(row) {
    if (!isMessageElement(row) || state.processedNodes.has(row) || state.status !== 'recording') return;
    state.processedNodes.add(row);
    const { author, text, displayTime } = readMessage(row);
    if (!author && !text) return;
    state.messages.push({
      author: author || 'Bilinmeyen kullanıcı',
      text,
      displayTime: displayTime || null,
      capturedAt: new Date().toISOString()
    });
    state.lastMessageAt = Date.now();
    queuePersist();
  }

  function collectMessages(node) {
    if (!(node instanceof Element)) return [];
    const rows = [];
    if (isMessageElement(node)) rows.push(node);
    node.querySelectorAll?.(MESSAGE_SELECTORS).forEach(row => rows.push(row));
    return rows;
  }

  function attachObserver() {
    const container = findChatContainer();
    if (!container) return false;
    if (state.observerTarget === container && state.observer) return true;
    state.observer?.disconnect();
    state.observer = new MutationObserver(mutations => {
      if (state.status !== 'recording') return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => collectMessages(node).forEach(recordRow));
      }
    });
    state.observer.observe(container, { childList: true, subtree: true });
    state.observerTarget = container;
    container.querySelectorAll(MESSAGE_SELECTORS).forEach(recordRow);
    return true;
  }

  function pageSignalsFinished() {
    const video = document.querySelector('video');
    if (video?.ended) return true;
    const pageText = document.body?.innerText?.slice(-12000).toLowerCase() || '';
    return /live event has ended|event has ended|yayın sona erdi|canlı yayın sona erdi/.test(pageText);
  }

  function watch() {
    if (state.status === 'waiting') {
      // Switch state before the initial scan so messages already visible when
      // the chat mounts are included as well as future mutations.
      if (findChatContainer()) {
        setStatus('recording');
        attachObserver();
      }
      return;
    }
    if (state.status !== 'recording') return;
    attachObserver();
    if (pageSignalsFinished()) finish('Yayın sona erdi', true);
  }

  function finish(reason = 'Kullanıcı tarafından durduruldu', isLiveEnd = false) {
    if (state.status !== 'recording' && state.status !== 'waiting') return;
    state.observer?.disconnect();
    state.observer = null;
    state.observerTarget = null;
    setStatus(isLiveEnd ? 'finished' : 'stopped', reason);
    const recording = serializableState();
    chrome.runtime.sendMessage({ type: 'PERSIST_RECORDING', recording }).catch(() => {});
    if (isLiveEnd && recording.messages.length) {
      chrome.storage.local.get('settings').then(({ settings }) => {
        if (settings?.autoDownloadOnFinish) {
          chrome.runtime.sendMessage({ type: 'AUTO_DOWNLOAD_RECORDING', recording }).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  function getStatus() {
    return { ...serializableState(), canExport: state.messages.length > 0 };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_STATUS') sendResponse(getStatus());
    if (message.type === 'STOP_RECORDING') { finish(); sendResponse(getStatus()); }
    if (message.type === 'START_RECORDING') {
      if (state.status === 'stopped' || state.status === 'finished') {
        state.messages = []; state.processedNodes = new WeakSet(); state.startedAt = null; state.endedAt = null; state.finishReason = null;
        setStatus('waiting');
      }
      watch(); sendResponse(getStatus());
    }
    return true;
  });

  window.addEventListener('pagehide', () => {
    if (state.status === 'recording') finish('Sayfa kapatıldı veya değiştirildi');
  });

  state.scanTimer = setInterval(watch, 1500);
  setTimeout(watch, 500);
})();
