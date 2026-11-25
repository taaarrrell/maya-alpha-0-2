/* M.A.Y.A. Alpha 0.2 — shared adapter (Assignment S01, local preparation).
   Plain JavaScript, no dependencies. Works in a browser via a <script> tag
   (attaches window.MayaAlpha02) and under Node with jsdom (module.exports).
   Synthetic fixtures and mock fetch only — it never makes a live call on its
   own, holds no secret, and sends no credential. The only URL in this file
   is the public Worker address, used as configuration.
   - WORKER_URL: the public Cloudflare Worker address (configuration, not a secret).
   - Identity: injected at construction. The system instruction is built from
     that identity at request time. The real IDENTITY_CONFIG is never
     hardcoded here; tests use a synthetic fixture identity.
   - Storage: the adapter owns ONLY the chain id key
     'maya-alpha-0-2-chain-v0.1'. It never reads or writes any
     conversation-history key (the UI owns that), and never touches the
     Alpha 0.1 keys 'maya-alpha-chain-v0.1' / 'maya-alpha-conversation-v0.1'.
   - Modes: send() handles BOTH modes. Live calls the Worker; Simulated
     returns a scripted reply from the M1 rule set. The adapter never
     returns a simulated reply when the mode is Live.
   - Count freshness: the remaining count is for the UTC day (the cap
     resets at midnight UTC). The UTC date (YYYY-MM-DD) is recorded when
     the count is set from an authoritative live reply; on every
     getRemaining() / isCountStale() access the current UTC date is
     compared to the recorded date, and a count from a previous UTC day
     is stale and never shown (getRemaining() returns 'unknown').
     A live request that SPANS midnight UTC is also invalidated
     conservatively: the UTC date is recorded when the send starts, and
     if the reply arrives on a different UTC day the count in that reply
     belongs to the old day — the reply text and chain id are still
     applied, but the count is dropped and resolves as 'unknown'.
     The clock is injectable (nowImpl) so tests can advance the UTC date.
   - Remaining counts are validated: an authoritative count must be an
     integer in [0, 20] (the daily cap is 20). Anything else is treated
     as "no authoritative count" — the previous value is kept and the
     count is marked stale.
   - Timeout: one client timeout covers the ENTIRE send (fetch,
     response-body parsing and handling). The timeout timer is cleared
     only when the send settles, never when the fetch resolves.
   - Timers are generation-isolated: a timer callback or cleanup only
     ever operates on the handle its own generation captured. A
     cancelled generation can never clear a newer generation's timer.
   - Errors: typed {code, kind, message}; the UI branches on code, never
     on message text. No automatic retries anywhere. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.MayaAlpha02 = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORKER_URL = 'https://maya-alpha-m3-proxy.macman2028.workers.dev';
  var CHAIN_KEY = 'maya-alpha-0-2-chain-v0.1';
  var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,255}$/;
  var DEFAULT_TIMEOUT_MS = 35000; /* client timeout; the Worker upstream timeout is 30 s */
  var DEFAULT_SIMULATED_DELAY_MS = 350; /* M1 simulated reply delay */
  var MAX_TEXT = 2000;
  var DAILY_CAP = 20; /* the Worker daily cap; an authoritative remaining count is an integer in [0, 20] */

  /* Worker error codes -> user-facing messages (Repair 2 classification).
     The adapter surfaces the Worker's code and this message. The UI
     branches on code, never on message text. */
  var WORKER_ERROR_MESSAGES = {
    forbidden: 'The Origin is not allowed.',
    bad_request: 'The request was not valid.',
    payload_too_large: 'The message is too long.',
    unsupported_media_type: 'The request must be JSON.',
    proxy_not_configured: 'The proxy\'s model key is not set.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    daily_limit_reached: 'The daily limit of 20 replies has been reached. Try again tomorrow.',
    upstream_rate_limited: 'Gemini is rate-limited right now. Wait a little and try again.',
    upstream_auth_failed: 'The proxy\'s model key was rejected. Check the Worker secret.',
    upstream_permission_denied: 'The model key does not have permission for this request.',
    upstream_overloaded: 'Gemini is overloaded right now. Wait a little and try again.',
    upstream_timeout: 'The model took too long to reply.',
    upstream_unreachable: 'Gemini could not be reached.',
    upstream_bad_json: 'Gemini returned a reply the proxy could not read.',
    upstream_empty_reply: 'Gemini returned no usable reply.',
    upstream_error: 'Gemini did not return a usable reply. Try again.',
    service_unavailable: 'The proxy is unavailable.'
  };
  /* Fallback code when an error response carries no usable error field. */
  var STATUS_DEFAULTS = {
    400: 'bad_request',
    403: 'forbidden',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    429: 'rate_limited',
    500: 'proxy_not_configured',
    502: 'upstream_error',
    503: 'service_unavailable'
  };

  function makeError(code, kind, message) {
    var err = new Error(message === null ? code : message);
    err.code = code;
    err.kind = kind;
    /* A cancellation carries no user-facing message; the UI must not
       display an error for it. message is null (not an empty string). */
    if (message === null) { err.message = null; }
    return err;
  }

  function textOf(v) {
    if (typeof v === 'string') { return v; }
    if (v && typeof v === 'object' && typeof v.text === 'string') { return v.text; }
    return '';
  }

  function createAdapter(opts) {
    opts = opts || {};
    var workerUrl = (typeof opts.workerUrl === 'string' && opts.workerUrl !== '') ? opts.workerUrl : WORKER_URL;
    var identity = opts.identity || null;
    var fetchFn = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    var storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    var simulatedDelayMs = (typeof opts.simulatedDelayMs === 'number' && opts.simulatedDelayMs >= 0) ? opts.simulatedDelayMs : DEFAULT_SIMULATED_DELAY_MS;
    /* Injectable clock (a function returning a Date). Tests advance it
       to cross midnight UTC; production defaults to the real clock. */
    var nowFn = (typeof opts.nowImpl === 'function') ? opts.nowImpl : function () { return new Date(); };

    var mode = 'simulated'; /* the default on every construction; Live is never remembered across loads */
    var remaining = null; /* last authoritative count, or null when none yet */
    var countStale = true; /* true until a successful live reply returns a count */
    var countDate = null; /* UTC date (YYYY-MM-DD) the count was last set from an authoritative live reply */
    var chainId = null;
    var pending = null; /* { generation, mode, controller, timer, deferred } or null */
    var generation = 0; /* increments per send; a reply is applied only while its generation is current */

    /* ---------- UTC-day count freshness ----------
       The remaining count is for the UTC day (the cap resets at
       midnight UTC). The date is recorded when the count is set from
       an authoritative live reply. On every access the current UTC
       date is compared to the recorded date; a count from a previous
       UTC day is stale and must not be shown (never overstate).
       The count is in-memory only; it is never persisted. */
    function utcDateString(d) {
      var y = d.getUTCFullYear();
      var m = d.getUTCMonth() + 1;
      var day = d.getUTCDate();
      return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day);
    }
    function todayUtc() { return utcDateString(nowFn()); }
    function countDayExpired() {
      return countDate !== null && countDate !== todayUtc();
    }

    /* ---------- Chain id storage (this key only) ---------- */
    function loadChainId() {
      if (!storage) { return null; }
      var raw;
      try { raw = storage.getItem(CHAIN_KEY); } catch (e) { return null; }
      if (raw === null || raw === undefined) { return null; }
      if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) {
        /* An invalid stored value is dropped (treated as null). */
        try { storage.removeItem(CHAIN_KEY); } catch (e) {}
        return null;
      }
      return raw;
    }
    function saveChainId(id) {
      if (!storage) { return; }
      try { storage.setItem(CHAIN_KEY, id); } catch (e) {}
    }
    function dropChainId() {
      if (!storage) { return; }
      try { storage.removeItem(CHAIN_KEY); } catch (e) {}
    }
    chainId = loadChainId();

    /* ---------- System instruction (built from the injected identity) ---------- */
    function buildSystemInstruction() {
      var id = identity || {};
      var lines = [];
      lines.push('You are ' + (id.display_name || 'M.A.Y.A.') + ' — ' + (id.full_name || 'Multimodal Artificial Yielding Agent') + '.');
      var purpose = textOf(id.purpose);
      if (purpose) { lines.push('Purpose: ' + purpose); }
      var personality = textOf(id.personality);
      if (personality) { lines.push('Personality: ' + personality); }
      if (Array.isArray(id.traits) && id.traits.length) {
        var traits = id.traits.map(textOf).filter(function (s) { return s !== ''; });
        if (traits.length) { lines.push('Traits: ' + traits.join(' ')); }
      }
      if (Array.isArray(id.principles) && id.principles.length) {
        var pr = id.principles.map(function (p) {
          if (typeof p === 'string') { return p; }
          if (p && typeof p === 'object') {
            var n = (typeof p.name === 'string') ? p.name : '';
            var t = textOf(p);
            return n ? (n + ': ' + t) : t;
          }
          return '';
        }).filter(function (s) { return s !== ''; });
        if (pr.length) { lines.push('Principles: ' + pr.join(' ')); }
      }
      if (Array.isArray(id.boundaries) && id.boundaries.length) {
        var b = id.boundaries.map(textOf).filter(function (s) { return s !== ''; });
        if (b.length) { lines.push('Boundaries: ' + b.join(' ')); }
      }
      return lines.join('\n');
    }

    /* ---------- Simulated replies (M1 rule set, ported faithfully) ----------
       Decision on the greeting: the M1 text hardcoded the owner's name
       ("Hello, Tarell."). The adapter must not hardcode a person's name,
       so the greeting uses a neutral phrasing. The identity's display
       name is used only in the "who are you" reply, where the name is
       the subject. The "who are you", "help", and fallback rules are
       unchanged from M1 (the fallback snippet is the message truncated
       to 60 chars + '…' when longer). */
    function simulatedReplyText(text) {
      var t = String(text).toLowerCase().trim();
      var isGreeting = /^(hi|hello|hey|good morning|good afternoon|good evening|yo)\b/.test(t);
      if (isGreeting) {
        return 'Hello. This is a simulated reply — no AI model is connected, but the chat interface and saved history are real. Try asking who I am, or what I can do.';
      }
      if (t.indexOf('who are you') !== -1 || t.indexOf('your name') !== -1 || t.indexOf('what are you') !== -1) {
        var id = identity || {};
        return 'I\'m ' + (id.display_name || 'M.A.Y.A.') + ' — ' + (id.full_name || 'Multimodal Artificial Yielding Agent') + '. ' +
          'That\'s my identity configuration, shown in full in the Identity panel. ' +
          'Right now my replies are simulated by fixed rules; I don\'t have genuine reasoning or any memory beyond the chat history on this page.';
      }
      if (t.indexOf('help') !== -1 || t.indexOf('what can you do') !== -1 || t.indexOf('capabilit') !== -1 || t.indexOf('what do you do') !== -1) {
        return 'In this milestone I can: hold a conversation here, save and restore the chat history in this browser, ' +
          'export it as JSON, and clear it with your confirmation. I can\'t browse, spend, share memories, use tools, ' +
          'or take any action outside this page — and my replies are simulated, not generated by a model.';
      }
      var snippet = text.length > 60 ? text.slice(0, 60) + '…' : text;
      return 'Simulated reply: my fixed rules don\'t have a specific response for \u201C' + snippet + '\u201D, ' +
        'so this is the fallback. I understood it as a message in our stored chat history — nothing more. ' +
        'Ask \u201Cwhat can you do?\u201D to see what this milestone covers.';
    }

    /* ---------- Send machinery ---------- */
    function isCurrentGen(gen) {
      return pending !== null && pending.generation === gen;
    }
    /* Settle the pending send exactly once, and only while its generation
       is still current. Clears this generation's own timer (the
       simulated delay timer, or the live timeout timer) — the timeout
       is cleared ONLY here, when the send settles, so it covers the
       whole operation. `p` is this generation's own pending record
       (verified above), so clearing its timer can never touch a newer
       generation's timer. Returns true when it settled. */
    function settleIfCurrent(gen, fn) {
      if (pending === null || pending.generation !== gen) { return false; }
      var p = pending;
      pending = null;
      if (p.timer) { try { clearTimeout(p.timer); } catch (e) {} }
      fn(p);
      return true;
    }

    function validateText(text) {
      if (typeof text !== 'string') { return false; }
      if (text.trim().length === 0) { return false; }
      if (text.length > MAX_TEXT) { return false; }
      return true;
    }

    function send(text) {
      /* Validate first: an invalid request is rejected without touching
         the in-flight request and without calling fetch. */
      if (!validateText(text)) {
        return Promise.reject(makeError('bad_request', 'worker', WORKER_ERROR_MESSAGES.bad_request));
      }
      /* Only one send may be in flight at a time (live or simulated).
         A second send rejects immediately; it does not disturb the
         in-flight request and does not consume a cap slot. */
      if (pending !== null) {
        return Promise.reject(makeError('busy', 'concurrent', 'A reply is already in progress. Wait for it to finish.'));
      }
      var gen = ++generation;
      var sendMode = mode;
      var deferred = {};
      var promise = new Promise(function (resolve, reject) {
        deferred.resolve = resolve;
        deferred.reject = reject;
      });
      if (sendMode === 'simulated') {
        runSimulatedSend(text, gen, deferred);
      } else {
        runLiveSend(text, gen, deferred);
      }
      return promise;
    }

    function runSimulatedSend(text, gen, deferred) {
      var timer = setTimeout(function () {
        /* A reply is applied only while its generation is still current;
           a clear() in the meantime discards it. */
        if (!isCurrentGen(gen)) { return; }
        var reply = simulatedReplyText(text);
        settleIfCurrent(gen, function () {
          /* Simulated sends do not touch the chain id, the Worker, or
             the count. The count freshness is unchanged. */
          deferred.resolve({ text: reply, remaining: 'unknown' });
        });
      }, simulatedDelayMs);
      pending = { generation: gen, mode: 'simulated', controller: null, timer: timer, deferred: deferred };
    }

    function runLiveSend(text, gen, deferred) {
      /* Record the UTC date this send STARTS on. If the reply arrives
         on a different UTC day, the count in that reply belongs to the
         old day and is invalidated conservatively (see
         handleLiveResponse). */
      var sendDate = todayUtc();
      if (!fetchFn) {
        /* No fetch implementation is available (for example, the adapter
           was constructed outside a browser with no fetch injected). */
        countStale = true;
        deferred.reject(makeError('network_error', 'network', 'Could not reach the proxy. Check your connection and try again.'));
        return;
      }
      var controller = null;
      try {
        if (typeof AbortController === 'function') { controller = new AbortController(); }
      } catch (e) { controller = null; }

      var body = {
        messages: [{ role: 'user', text: text }],
        system_instruction: buildSystemInstruction()
      };
      if (chainId) { body.previous_interaction_id = chainId; }

      var fetchPromise;
      try {
        fetchPromise = fetchFn(workerUrl + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined
        });
      } catch (e) {
        fetchPromise = Promise.reject(e);
      }
      /* Swallow the fetch promise's own rejection: the race below is the
         single place that observes it, so a late rejection never becomes
         an unhandled rejection. */
      if (fetchPromise && typeof fetchPromise.catch === 'function') {
        fetchPromise.catch(function () {});
      }

      /* --- One client timeout for the WHOLE send (fetch, response-body
         parsing and handling). The timer is this generation's own
         handle, captured in this closure and stored on this
         generation's pending record as `timer`. It is cleared ONLY
         when the send settles (in settleIfCurrent) or when clear()
         cancels it — never when the fetch resolves, so a hung body
         parse is still cut off by the timeout. No handler here ever
         reads a timer handle from the shared `pending` object, so a
         cancelled generation can never clear a newer generation's
         timer (generation-isolated timers). */
      /* Tracks whether this generation's client timeout has fired.
         The parse paths consult it so an abort-induced parse failure
         is never reported as upstream_bad_json (see
         handleLiveResponse). Set before the abort, so a parse
         rejection caused by the abort always sees it. */
      var timeoutState = { fired: false };
      var timeoutHandle = null;
      var timeoutPromise = new Promise(function (resolve, reject) {
        timeoutHandle = setTimeout(function () {
          timeoutState.fired = true;
          /* Abort the underlying request (so the Worker connection is
             released), then reject. Some fetch implementations do not
             reject on abort, so this rejection is what guarantees the
             send settles. */
          if (controller) { try { controller.abort(); } catch (e) {} }
          reject(makeError('client_timeout', 'timeout', 'The reply took too long. Try again.'));
        }, timeoutMs);
      });
      /* Suppress a possible unhandled rejection: if the send settles
         via the work promise first, this timer was cleared by
         settleIfCurrent and never fires; if it does fire, the race
         below observes it. */
      timeoutPromise.catch(function () {});

      pending = { generation: gen, mode: 'live', controller: controller, timer: timeoutHandle, deferred: deferred };

      /* The whole operation — fetch, then body parsing and handling —
         is raced against the timeout, so the timeout covers all of it.
         handleLiveResponse returns its parse chain, so a hung .json()
         still loses the race to the timeout. */
      var workPromise = fetchPromise.then(function (response) {
        return handleLiveResponse(response, gen, deferred, sendDate, timeoutState);
      });
      Promise.race([workPromise, timeoutPromise]).then(function () {
        /* The work completed. handleLiveResponse already settled the
           send via settleIfCurrent (which cleared this generation's
           timeout timer), or this generation was cancelled and the
           result was discarded by its generation check. Nothing
           further to do here — in particular, no timer is cleared
           here. */
      }).catch(function (err) {
        /* The race rejected: the timeout fired, or the fetch itself
           rejected. If this generation is no longer current (it was
           cancelled by clear()), discard. */
        if (!isCurrentGen(gen)) { return; }
        if (err && err.code === 'client_timeout') {
          settleIfCurrent(gen, function () {
            countStale = true;
            deferred.reject(err);
          });
        } else if (err && err.name === 'AbortError') {
          /* Aborted without a recorded kind. Treat it as a timeout. */
          settleIfCurrent(gen, function () {
            countStale = true;
            deferred.reject(makeError('client_timeout', 'timeout', 'The reply took too long. Try again.'));
          });
        } else {
          /* The fetch itself rejected: no response was received. */
          settleIfCurrent(gen, function () {
            countStale = true;
            deferred.reject(makeError('network_error', 'network', 'Could not reach the proxy. Check your connection and try again.'));
          });
        }
      });
    }

    /* A 200 whose body cannot be parsed as JSON is upstream_bad_json;
       a parsed 200 with no usable text is upstream_empty_reply. The two
       are distinct, so a parse failure is reported with a sentinel
       rather than as a null body.
       An abort (from the client timeout, or from clear()) rejects the
       body reader with an AbortError. That is NOT malformed JSON — it
       is rethrown (not converted to the sentinel) so the caller can
       settle it as a timeout (or discard it if the generation is
       already settled). */
    var PARSE_FAILED = { __parseFailed: true };
    function parseJsonBody(response) {
      if (response && typeof response.json === 'function') {
        try {
          return Promise.resolve(response.json()).catch(function (e) {
            if (e && e.name === 'AbortError') { throw e; }
            return PARSE_FAILED;
          });
        } catch (e) {
          if (e && e.name === 'AbortError') { return Promise.reject(e); }
          return Promise.resolve(PARSE_FAILED);
        }
      }
      if (response && typeof response.text === 'function') {
        try {
          return Promise.resolve(response.text()).then(function (t) {
            try { return JSON.parse(t); } catch (e) { return PARSE_FAILED; }
          }).catch(function (e) {
            if (e && e.name === 'AbortError') { throw e; }
            return PARSE_FAILED;
          });
        } catch (e) {
          if (e && e.name === 'AbortError') { return Promise.reject(e); }
          return Promise.resolve(PARSE_FAILED);
        }
      }
      return Promise.resolve(PARSE_FAILED);
    }

    /* Returns the parse-and-handle chain, so the caller's race covers
       the whole operation (fetch, body parsing and handling) and the
       timeout can still cut off a hung .json(). The chain settles the
       send's deferred via settleIfCurrent; it resolves (never rejects)
       once handling is done or the result was discarded. */
    function handleLiveResponse(response, gen, deferred, sendDate, timeoutState) {
      var status = response ? response.status : 0;
      var ok = (response && response.ok === true) || (status >= 200 && status < 300);
      return parseJsonBody(response).then(function (data) {
        if (!isCurrentGen(gen)) { return; } /* cancelled while parsing; discard */
        if (ok) {
          if (data === PARSE_FAILED) {
            /* If the client timeout fired for this generation, the
               parse failure may have been caused by the timeout's
               abort — it must not be reported as upstream_bad_json.
               The timeout takes precedence: settle as client_timeout.
               (If the race already settled the send as client_timeout,
               settleIfCurrent is a no-op.) */
            if (timeoutState && timeoutState.fired) {
              settleIfCurrent(gen, function () {
                countStale = true;
                deferred.reject(makeError('client_timeout', 'timeout', 'The reply took too long. Try again.'));
              });
              return;
            }
            settleIfCurrent(gen, function () {
              countStale = true;
              deferred.reject(makeError('upstream_bad_json', 'worker', WORKER_ERROR_MESSAGES.upstream_bad_json));
            });
            return;
          }
          if (!data || typeof data.text !== 'string' || data.text === '') {
            settleIfCurrent(gen, function () {
              countStale = true;
              deferred.reject(makeError('upstream_empty_reply', 'worker', WORKER_ERROR_MESSAGES.upstream_empty_reply));
            });
            return;
          }
          /* Valid reply. Store the new chain id (validated first) and
             the authoritative remaining count. */
          var newChain = (typeof data.interaction_id === 'string' && ID_PATTERN.test(data.interaction_id)) ? data.interaction_id : null;
          /* The daily cap is 20, so an authoritative remaining count
             must be an integer in [0, 20]. Anything else (a fraction,
             a negative number, a value above the cap, NaN, Infinity, a
             string, null) is treated as "no authoritative count": the
             reply and chain id are still applied, the previous
             remaining value is kept, and the count is marked stale. */
          var rem = (typeof data.remaining === 'number' && isFinite(data.remaining) &&
            Math.floor(data.remaining) === data.remaining &&
            data.remaining >= 0 && data.remaining <= DAILY_CAP) ? data.remaining : null;
          if (newChain !== null) {
            chainId = newChain;
            saveChainId(newChain);
          } else {
            /* The Worker returned no usable new chain head. Drop the
               chain rather than chaining to a superseded id; the next
               live request starts a fresh chain. */
            chainId = null;
            dropChainId();
          }
          /* Spanning-midnight check: the UTC date is recorded when the
             send STARTS (sendDate). If the reply arrives on a different
             UTC day, the count in that reply belongs to the old day
             (whose cap has reset) and must not be treated as fresh.
             Invalidate it conservatively: drop the count and resolve
             with 'unknown'. The conversation happened — the reply text
             and the chain id above are still applied. */
          if (typeof sendDate === 'string' && todayUtc() !== sendDate) {
            remaining = null;
            countDate = null;
            settleIfCurrent(gen, function () {
              countStale = true;
              deferred.resolve({ text: data.text, remaining: 'unknown' });
            });
            return;
          }
          if (rem !== null) {
            remaining = rem;
            countDate = todayUtc(); /* record the UTC day this count belongs to */
            settleIfCurrent(gen, function () {
              countStale = false;
              deferred.resolve({ text: data.text, remaining: rem });
            });
          } else {
            /* No authoritative count arrived. Keep the previous
               remaining value, but mark the count stale: we did not
               receive a fresh count. */
            settleIfCurrent(gen, function () {
              countStale = true;
              deferred.resolve({ text: data.text, remaining: (remaining === null ? 'unknown' : remaining) });
            });
          }
          return;
        }
        /* Error response: map the Worker's error code. */
        var code = (data && typeof data.error === 'string' && data.error !== '') ? data.error : null;
        if (code !== null) {
          if (!WORKER_ERROR_MESSAGES.hasOwnProperty(code)) { code = 'upstream_error'; }
        } else {
          code = STATUS_DEFAULTS[status] || 'upstream_error';
        }
        settleIfCurrent(gen, function () {
          countStale = true;
          deferred.reject(makeError(code, 'worker', WORKER_ERROR_MESSAGES[code]));
        });
      }).catch(function (err) {
        if (!isCurrentGen(gen)) { return; }
        /* A parse rejection caused by the timeout's abort (AbortError),
           or a rejection that arrived after the timeout fired for this
           generation, is a timeout — not malformed JSON. Settle as
           client_timeout. A genuine parse failure (no abort, no
           timeout) is upstream_bad_json. */
        if ((err && err.name === 'AbortError') || (timeoutState && timeoutState.fired)) {
          settleIfCurrent(gen, function () {
            countStale = true;
            deferred.reject(makeError('client_timeout', 'timeout', 'The reply took too long. Try again.'));
          });
          return;
        }
        settleIfCurrent(gen, function () {
          countStale = true;
          deferred.reject(makeError('upstream_bad_json', 'worker', WORKER_ERROR_MESSAGES.upstream_bad_json));
        });
      });
    }

    /* ---------- Public API ---------- */
    function setMode(newMode) {
      if (newMode !== 'live' && newMode !== 'simulated') {
        throw new TypeError('mode must be "live" or "simulated"');
      }
      /* Switching mode does NOT abort an in-flight request. The
         in-flight request completes and its reply is added, tagged
         with the mode it was sent in. The switch only affects future
         sends. */
      mode = newMode;
      return mode;
    }
    function getMode() { return mode; }
    function getRemaining() {
      /* A count from a previous UTC day belongs to a day whose cap has
         reset; it must not be shown. */
      if (typeof remaining !== 'number' || countDayExpired()) { return 'unknown'; }
      return remaining;
    }
    function isCountStale() { return countStale || countDayExpired(); }
    function getChainId() { return chainId; }
    function clear() {
      /* Clear drops the chain id. If a request is in flight, abort it
         and reject its send with 'cancelled' (message null, so the UI
         shows nothing). A late reply from the cancelled generation is
         never added. If no request was in flight, the count freshness
         is unchanged. */
      dropChainId();
      chainId = null;
      if (pending !== null) {
        var p = pending;
        pending = null;
        /* clear() operates on the current pending record (correct: it
           is the request being cancelled). Its timer is this
           generation's own handle, so clearing it cannot touch a
           newer generation's timer. */
        if (p.timer) { try { clearTimeout(p.timer); } catch (e) {} }
        if (p.controller) { try { p.controller.abort(); } catch (e) {} }
        countStale = true;
        p.deferred.reject(makeError('cancelled', 'cancelled', null));
      }
    }

    return {
      send: send,
      setMode: setMode,
      getMode: getMode,
      getRemaining: getRemaining,
      isCountStale: isCountStale,
      getChainId: getChainId,
      clear: clear,
      /* Constants exposed for tests and for the UI's configuration. */
      WORKER_URL: WORKER_URL,
      CHAIN_KEY: CHAIN_KEY,
      DAILY_CAP: DAILY_CAP,
      DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
      DEFAULT_SIMULATED_DELAY_MS: DEFAULT_SIMULATED_DELAY_MS,
      WORKER_ERROR_MESSAGES: WORKER_ERROR_MESSAGES
    };
  }

  return {
    createAdapter: createAdapter,
    WORKER_URL: WORKER_URL,
    CHAIN_KEY: CHAIN_KEY,
    DAILY_CAP: DAILY_CAP,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    DEFAULT_SIMULATED_DELAY_MS: DEFAULT_SIMULATED_DELAY_MS,
    WORKER_ERROR_MESSAGES: WORKER_ERROR_MESSAGES
  };
});
