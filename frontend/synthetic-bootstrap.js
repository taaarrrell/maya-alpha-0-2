(() => {
  'use strict';
  const namespace = 'maya-e01-synthetic:';
  let storage;
  try {
    const tabStorage = window.sessionStorage;
    storage = {
      getItem: key => tabStorage.getItem(namespace + key),
      setItem: (key, value) => tabStorage.setItem(namespace + key, value),
      removeItem: key => tabStorage.removeItem(namespace + key)
    };
  } catch {
    // Explicit inert storage below keeps the adapter away from its default storage.
  }
  const identity = window.MAYA_IDENTITY_CONFIG;
  if (!identity || !window.MayaAlpha02) {
    document.querySelector('#feedback').textContent = 'The shared adapter or identity configuration could not be loaded.';
    return;
  }
  const endpoint = 'https://e01-synthetic.invalid';
  const calls = [];
  const responses = [];
  let time = null;
  const now = () => time === null ? new Date() : new Date(time);

  function fetchImpl(url, options) {
    if (url !== endpoint + '/chat' || options.method !== 'POST') throw new Error('Unexpected synthetic route');
    calls.push({ body: JSON.parse(options.body), signal: options.signal });
    const result = responses.shift() ?? { status: 200, body: { text: 'Synthetic transport reply.', remaining: 19, interaction_id: 'e01-synthetic' } };
    if (result.network) return Promise.reject(new Error('Synthetic network failure'));
    return Promise.resolve({
      status: result.status,
      ok: result.status === 200,
      json: () => result.hang ? new Promise(() => {}) :
        new Promise(resolve => setTimeout(() => resolve(result.body), result.delay ?? 0))
    });
  }

  const adapter = window.MayaAlpha02.createAdapter({
    workerUrl: endpoint, fetchImpl, nowImpl: now, identity,
    storage: storage ?? { getItem: () => null, setItem() {}, removeItem() {} },
    timeoutMs: window.MAYA_E01_TESTING ? 900 : 35000, simulatedDelayMs: window.MAYA_E01_TESTING ? 250 : 350
  });
  const forms = ['signal', 'prism'].map(id => ({
    id,
    label: id === 'signal' ? 'Signal · PNG' : 'Prism · PNG',
    states: Object.fromEntries(['neutral','pending','reply'].map(state => [state, 'forms/' + id + '-' + state + '.png']))
  }));
  if (window.MAYA_E01_TESTING === true) {
    window.MayaE01Synthetic = {
      calls, enqueue: response => responses.push(response), setTime: value => { time = value; },
      startSend: text => adapter.send(text).catch(error => error.code)
    };
  }
  window.mountMayaFrontend({ adapter, identity, forms, synthetic: true, storage });
})();
