(function () {
  'use strict';

  var ENDPOINT = 'https://mgx-cs-agent-production.up.railway.app/chat';
  var BRAND_NAME = 'Microgenix Support';
  var AGENT_NAME = 'Willow';
  var PLACEHOLDER = 'Ask us anything...';

  var styles = `
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');

    #mgx-chat-launcher {
      position: fixed;
      bottom: 28px;
      right: 28px;
      height: 48px;
      padding: 0 20px 0 16px;
      border-radius: 50px;
      background: #2b3a72;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(43,58,114,0.32);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      z-index: 99998;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      white-space: nowrap;
    }
    #mgx-chat-launcher:hover {
      transform: scale(1.04);
      box-shadow: 0 6px 20px rgba(43,58,114,0.42);
    }
    #mgx-chat-launcher svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    #mgx-chat-launcher-text {
      color: #ffffff;
      font-family: 'Roboto', sans-serif;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    #mgx-chat-window {
      position: fixed;
      bottom: 96px;
      right: 28px;
      width: 368px;
      max-height: 560px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(43,58,114,0.18);
      display: flex;
      flex-direction: column;
      z-index: 99999;
      font-family: 'Roboto', sans-serif;
      overflow: hidden;
      transition: opacity 0.2s ease, transform 0.2s ease;
      border: 1px solid #D2D7E5;
    }
    #mgx-chat-window.mgx-hidden {
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      pointer-events: none;
    }

    #mgx-chat-header {
      background: #2b3a72;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #mgx-chat-header-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: #ffffff;
      font-weight: 700;
      font-family: 'Roboto', sans-serif;
      flex-shrink: 0;
    }
    #mgx-chat-header-info {
      flex: 1;
    }
    #mgx-chat-header-name {
      color: #ffffff;
      font-weight: 700;
      font-size: 14px;
      font-family: 'Roboto', sans-serif;
    }
    #mgx-chat-header-status {
      color: rgba(255,255,255,0.72);
      font-size: 12px;
      font-family: 'Roboto', sans-serif;
      margin-top: 1px;
    }
    #mgx-chat-close {
      background: none;
      border: none;
      cursor: pointer;
      color: rgba(255,255,255,0.7);
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: color 0.15s;
    }
    #mgx-chat-close:hover {
      color: #ffffff;
    }

    #mgx-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #ffffff;
      min-height: 280px;
      max-height: 360px;
    }
    #mgx-chat-messages::-webkit-scrollbar {
      width: 4px;
    }
    #mgx-chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    #mgx-chat-messages::-webkit-scrollbar-thumb {
      background: #D2D7E5;
      border-radius: 4px;
    }

    .mgx-msg {
      display: flex;
      flex-direction: column;
      max-width: 82%;
    }
    .mgx-msg-agent {
      align-self: flex-start;
    }
    .mgx-msg-user {
      align-self: flex-end;
    }
    .mgx-bubble {
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.5;
      font-family: 'Roboto', sans-serif;
      color: #131313;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .mgx-msg-agent .mgx-bubble {
      background: #EFF1F6;
      border-bottom-left-radius: 4px;
    }
    .mgx-msg-user .mgx-bubble {
      background: #2b3a72;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .mgx-msg-name {
      font-size: 11px;
      color: #888;
      margin-bottom: 4px;
      font-family: 'Roboto', sans-serif;
      padding: 0 4px;
    }

    .mgx-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 14px;
      background: #EFF1F6;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      width: fit-content;
    }
    .mgx-typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #2b3a72;
      opacity: 0.4;
      animation: mgx-bounce 1.2s infinite;
    }
    .mgx-typing span:nth-child(2) { animation-delay: 0.2s; }
    .mgx-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes mgx-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40% { transform: translateY(-5px); opacity: 1; }
    }

    #mgx-chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid #EFF1F6;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      background: #ffffff;
    }
    #mgx-chat-input {
      flex: 1;
      border: 1px solid #D2D7E5;
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 14px;
      font-family: 'Roboto', sans-serif;
      color: #131313;
      outline: none;
      resize: none;
      max-height: 96px;
      min-height: 40px;
      line-height: 1.4;
      background: #ffffff;
      transition: border-color 0.15s;
      overflow-y: auto;
    }
    #mgx-chat-input:focus {
      border-color: #2b3a72;
    }
    #mgx-chat-input::placeholder {
      color: #aaa;
    }
    #mgx-chat-send {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #2b3a72;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, transform 0.15s;
    }
    #mgx-chat-send:hover {
      background: #1e2a56;
      transform: scale(1.05);
    }
    #mgx-chat-send:disabled {
      background: #D2D7E5;
      cursor: not-allowed;
      transform: none;
    }
    #mgx-chat-send svg {
      width: 30px;
      height: 30px;
    }
    @media (max-width: 600px) {
      #mgx-chat-send svg {
        width: 36px;
        height: 36px;
      }
    }

    .mgx-escalated-note {
      font-size: 12px;
      color: #627D47;
      text-align: center;
      padding: 4px 8px;
      font-family: 'Roboto', sans-serif;
    }

    @media (max-width: 600px) {
      #mgx-chat-launcher {
        bottom: 16px;
        right: 16px;
        height: 48px;
        padding: 0 16px 0 12px;
      }

      #mgx-chat-window {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        top: auto;
        width: 100%;
        height: 420px;
        max-height: 80vh;
        border-radius: 20px 20px 0 0;
        border: none;
        border-top: 1px solid #D2D7E5;
        box-shadow: 0 -4px 24px rgba(43,58,114,0.14);
      }

      #mgx-chat-messages {
        flex: 1;
        min-height: 0;
        max-height: none;
        padding: 14px 12px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
      }

      #mgx-chat-header {
        padding: 14px 16px;
        border-radius: 20px 20px 0 0;
        flex-shrink: 0;
      }

      #mgx-chat-input-area {
        padding: 10px 12px 14px;
        flex-shrink: 0;
      }

      #mgx-chat-input {
        font-size: 16px;
      }

      .mgx-bubble {
        font-size: 15px;
      }
    }
  `;

  function injectStyles() {
    var el = document.createElement('style');
    el.textContent = styles;
    document.head.appendChild(el);
  }

  function buildHTML() {
    var launcher = document.createElement('button');
    launcher.id = 'mgx-chat-launcher';
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="white"/></svg><span id="mgx-chat-launcher-text">Chat with us</span>';

    var win = document.createElement('div');
    win.id = 'mgx-chat-window';
    win.className = 'mgx-hidden';
    win.setAttribute('aria-live', 'polite');
    win.innerHTML = `
      <div id="mgx-chat-header">
        <div id="mgx-chat-header-avatar">W</div>
        <div id="mgx-chat-header-info">
          <div id="mgx-chat-header-name">${AGENT_NAME}</div>
          <div id="mgx-chat-header-status">${BRAND_NAME}</div>
        </div>
        <button id="mgx-chat-close" aria-label="Close chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div id="mgx-chat-messages"></div>
      <div id="mgx-chat-input-area">
        <textarea id="mgx-chat-input" placeholder="${PLACEHOLDER}" rows="1"></textarea>
        <button id="mgx-chat-send" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;

    document.body.appendChild(launcher);
    document.body.appendChild(win);
    return { launcher: launcher, win: win };
  }

  function addMessage(role, text) {
    var messages = document.getElementById('mgx-chat-messages');
    var wrapper = document.createElement('div');
    wrapper.className = 'mgx-msg mgx-msg-' + role;

    if (role === 'agent') {
      var name = document.createElement('div');
      name.className = 'mgx-msg-name';
      name.textContent = AGENT_NAME;
      wrapper.appendChild(name);
    }

    var bubble = document.createElement('div');
    bubble.className = 'mgx-bubble';
    bubble.textContent = text;
    wrapper.appendChild(bubble);

    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
    return wrapper;
  }

  function showTyping() {
    var messages = document.getElementById('mgx-chat-messages');
    var wrapper = document.createElement('div');
    wrapper.className = 'mgx-msg mgx-msg-agent';
    wrapper.id = 'mgx-typing-indicator';

    var name = document.createElement('div');
    name.className = 'mgx-msg-name';
    name.textContent = AGENT_NAME;
    wrapper.appendChild(name);

    var typing = document.createElement('div');
    typing.className = 'mgx-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    wrapper.appendChild(typing);

    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('mgx-typing-indicator');
    if (el) el.remove();
  }

  function getOrCreateSession() {
    var key = 'mgx_session';
    var session = sessionStorage.getItem(key);
    if (!session) {
      session = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      sessionStorage.setItem(key, session);
    }
    return session;
  }

  function getCustomerEmail() {
    // Try WooCommerce logged-in user data if available
    if (window.mgx_customer && window.mgx_customer.email) {
      return window.mgx_customer.email;
    }
    // Fall back to anonymous session-based email
    return getOrCreateSession() + '@widget.mgx';
  }

  function getCustomerName() {
    if (window.mgx_customer && window.mgx_customer.name) {
      return window.mgx_customer.name;
    }
    return 'Website Visitor';
  }

  function sendMessage(text, sendBtn, input) {
    if (!text.trim()) return;

    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    addMessage('user', text);
    showTyping();

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerEmail: getCustomerEmail(),
        customerName: getCustomerName(),
        message: text,
        sessionId: getOrCreateSession(),
      }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        hideTyping();
        if (data.reply) {
          addMessage('agent', data.reply);
          if (data.escalated) {
            var messages = document.getElementById('mgx-chat-messages');
            var note = document.createElement('div');
            note.className = 'mgx-escalated-note';
            note.textContent = 'A team member will follow up by email if needed.';
            messages.appendChild(note);
            messages.scrollTop = messages.scrollHeight;
          }
        } else {
          addMessage('agent', 'Sorry, something went wrong. Please try again or email us at support@microgenix.com.');
        }
      })
      .catch(function () {
        hideTyping();
        addMessage('agent', 'Sorry, we could not connect right now. Please email us at support@microgenix.com.');
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  }

  function init() {
    injectStyles();
    var els = buildHTML();
    var launcher = els.launcher;
    var win = els.win;
    var isOpen = false;

    // Add welcome message
    addMessage('agent', 'Hey! We know AI bots usually feel useless, but I\'ve been trained by the best humans. Ask me anything: products, orders, tracking, dosing, mushroom knowledge. I\'m fully connected to the store.');

    function open() {
      isOpen = true;
      win.classList.remove('mgx-hidden');
      launcher.setAttribute('aria-expanded', 'true');
      document.getElementById('mgx-chat-input').focus();
    }

    function close() {
      isOpen = false;
      win.classList.add('mgx-hidden');
      launcher.setAttribute('aria-expanded', 'false');
    }

    launcher.addEventListener('click', function () {
      isOpen ? close() : open();
    });

    document.getElementById('mgx-chat-close').addEventListener('click', close);

    var sendBtn = document.getElementById('mgx-chat-send');
    var input = document.getElementById('mgx-chat-input');

    sendBtn.addEventListener('click', function () {
      sendMessage(input.value, sendBtn, input);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value, sendBtn, input);
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 96) + 'px';
    });

    // Keep widget above keyboard on mobile
    if (window.visualViewport) {
      function onViewportChange() {
        if (window.innerWidth > 600) return;
        var vv = window.visualViewport;
        // How far the keyboard has pushed up from the bottom
        var keyboardOffset = window.innerHeight - vv.height - vv.offsetTop;
        if (keyboardOffset < 0) keyboardOffset = 0;
        // Pin chat window just above keyboard
        win.style.bottom = keyboardOffset + 'px';
        // Shrink window height to fit in visible space, leaving room for header + messages + input
        var availableHeight = vv.height;
        var maxH = Math.min(availableHeight, 520);
        win.style.height = maxH + 'px';
        // Scroll messages to bottom
        var msgs = document.getElementById('mgx-chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      }
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
