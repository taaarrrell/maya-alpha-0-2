(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const form = document.querySelector('.composer');
  const log = document.querySelector('.log');
  const reset = document.querySelector('.reset');
  const send = document.querySelector('.send');
  const image = byId('form-image');
  const connection = byId('connection');
  const embodiment = byId('embodiment');
  const quota = byId('quota');
  const input = byId('message');
  const feedback = byId('feedback');
  const status = byId('pending');
  let mounted = false;
  const HISTORY_KEY = 'maya-alpha-0-2-conversation-v0.1';
  const HISTORY_LIMIT = 100;

  function addMessage(batch, author, text, mode, user = false) {
    const line = document.createElement('p');
    line.className = user ? 'message user' : 'message';
    const label = document.createElement('span');
    label.className = 'micro';
    line.dataset.mode = mode;
    label.textContent = author + ' · ' + (mode === 'live' ? 'Live' : 'Simulated');
    line.append(label, document.createTextNode(text));
    batch.append(line);
  }

  window.mountMayaFrontend = function mount({ adapter, identity, forms = [], synthetic = false, storage, quotaRefreshMs = 1000 }) {
    if (mounted) throw new Error('M.A.Y.A. frontend already mounted');
    adapter.setMode('simulated');
    mounted = true;
    let pending = false;
    let clearing = false;
    let generation = 0;
    let pendingLive = false;
    let expression = 'neutral';
    let history = [];
    const storageStatus = byId('storage-status');

    function storageUnavailable() {
      storageStatus.textContent = 'Conversation storage unavailable. Reload persistence could not be verified.';
      storageStatus.hidden = false;
    }

    try {
      const raw = storage?.getItem(HISTORY_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved?.version === 1 && Array.isArray(saved.turns)) {
        history = saved.turns.slice(-2 * HISTORY_LIMIT).filter(turn =>
          turn && (turn.mode === 'live' || turn.mode === 'simulated') &&
          typeof turn.user === 'string' && turn.user.length <= 2000 &&
          typeof turn.reply === 'string' && turn.reply.length > 0);
      }
    } catch {
      storageUnavailable();
    }
    if (!storage) storageUnavailable();

    function appendTurn(target, turn) {
      addMessage(target, 'You', turn.user, turn.mode, true);
      addMessage(target, 'M.A.Y.A.', turn.reply, turn.mode);
    }

    function renderHistory() {
      const batch = document.createDocumentFragment();
      const mode = adapter.getMode();
      history.filter(turn => turn.mode === mode).forEach(turn => appendTurn(batch, turn));
      log.replaceChildren(batch);
      log.scrollTop = log.scrollHeight;
    }

    function saveHistory() {
      try {
        if (history.length) {
          storage?.setItem(HISTORY_KEY, JSON.stringify({ version: 1, turns: history }));
        } else {
          storage?.removeItem(HISTORY_KEY);
        }
      } catch {
        storageUnavailable();
      }
    }


    if (identity) {
      const panel = byId('identity');
      const content = panel.querySelector('.identity-content');
      function display(tag, text) {
        const element = document.createElement(tag);
        element.textContent = text;
        content.append(element);
        return element;
      }
      display('h3', identity.display_name);
      display('p', identity.full_name);
      for (const [label, key] of [
        ['Purpose', 'purpose'], ['Personality', 'personality'], ['Traits', 'traits'],
        ['Principles', 'principles'], ['Boundaries', 'boundaries']
      ]) {
        display('h4', label);
        if (Array.isArray(identity[key])) {
          const list = display('ul', '');
          for (const text of identity[key]) {
            const item = document.createElement('li');
            item.textContent = text;
            list.append(item);
          }
        } else {
          display('p', identity[key]);
        }
      }
      panel.hidden = false;
    }
    if (synthetic) byId('scope').textContent = 'Synthetic transport · History saved in this tab';
    const visualForms = new Map(forms.map(visual => [visual.id, visual]));
    const failedImages = new Set();
    for (const visual of forms) embodiment.add(new Option(visual.label, visual.id));

    function renderEmbodiment() {
      const visual = visualForms.get(embodiment.value);
      const preferred = visual?.states[expression];
      const neutral = visual?.states.neutral;
      const source = [preferred, neutral].find(path => path && !failedImages.has(path));
      image.hidden = !source;
      byId("embodiment-label").textContent = source ? "PNG AVATAR" : "NANOSWARM";
      window.MayaSwarm.setVisible(!source);
      if (!source) {
        image.removeAttribute('src');
        delete image.dataset.source;
        return;
      }
      if (image.dataset.source !== source) {
        image.dataset.source = source;
        image.src = source;
      }
    }

    function renderQuota() {
      const count = pendingLive || adapter.isCountStale() ? 'unknown' : adapter.getRemaining();
      const text = 'Remaining: ' + count;
      if (quota.textContent !== text) quota.textContent = text;
    }

    function render() {
      const live = adapter.getMode() === 'live';
      connection.value = live ? 'live' : 'simulated';
      connection.disabled = clearing;
      send.disabled = pending || clearing;
      reset.disabled = clearing;
      input.disabled = clearing;
      input.readOnly = pending;
      byId('mode-title').closest('.stage').querySelector('.signal').textContent =
        live ? (synthetic ? 'LIVE · SYNTHETIC' : 'LIVE') : 'SIMULATED';
      quota.hidden = !live;
      renderQuota();
      status.textContent = pending ? 'Waiting for a reply…' : '';
      renderEmbodiment();
    }

    image.addEventListener('error', () => {
      if (image.dataset.source) failedImages.add(image.dataset.source);
      renderEmbodiment();
    });
    embodiment.addEventListener('change', renderEmbodiment);

    window.addEventListener('focus', renderQuota);
    window.addEventListener('pageshow', renderQuota);
    setInterval(renderQuota, quotaRefreshMs);
    document.addEventListener('visibilitychange', renderQuota);

    connection.addEventListener('change', () => {
      if (clearing) return;
      adapter.setMode(connection.value);
      renderHistory();
      feedback.textContent = '';
      render();
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || pending || clearing) return;

      const request = ++generation;
      const sentMode = adapter.getMode();
      pending = true;
      pendingLive = sentMode === 'live';
      expression = 'pending';
      feedback.textContent = '';
      render();

      try {
        const reply = await adapter.send(text);
        if (request !== generation) return;
        if (history.filter(turn => turn.mode === sentMode).length >= HISTORY_LIMIT) {
          history.splice(history.findIndex(turn => turn.mode === sentMode), 1);
        }
        history.push({ mode: sentMode, user: text, reply: reply.text });
        saveHistory();
        renderHistory();
        input.value = '';
        expression = 'reply';
      } catch (error) {
        if (request !== generation) return;
        if (error?.code !== 'cancelled' && error?.code !== 'busy') {
          feedback.textContent = typeof error?.message === 'string' && error?.code
            ? error.message : 'The adapter did not return a usable reply.';
        }
        expression = 'neutral';
      } finally {
        if (request === generation) {
          pending = false;
          pendingLive = false;
          render();
        }
      }
    });

    reset.addEventListener('click', async () => {
      if (clearing) return;
      generation++;
      pending = false;
      clearing = true;
      feedback.textContent = '';
      expression = 'neutral';
      render();
      try {
        await adapter.clear();
        history = [];
        saveHistory();
        renderHistory();
        input.value = '';
      } catch {
        feedback.textContent = 'The conversation could not be cleared.';
      } finally {
        pendingLive = false;
        clearing = false;
        render();
      }
    });

    renderHistory();
    render();
  };
})();
