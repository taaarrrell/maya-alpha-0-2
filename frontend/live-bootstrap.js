(() => {
  'use strict';
  const namespace = 'maya-e02-release:';
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
  const adapter = window.MayaAlpha02.createAdapter({
    workerUrl: window.MayaAlpha02.WORKER_URL,
    fetchImpl: (url, options) => window.fetch(url, { ...options, credentials: 'omit', redirect: 'error' }),
    identity,
    storage: storage ?? { getItem: () => null, setItem() {}, removeItem() {} }
  });
  const forms = ['signal', 'prism'].map(id => ({
    id,
    label: id === 'signal' ? 'Signal · PNG' : 'Prism · PNG',
    states: Object.fromEntries(['neutral','pending','reply'].map(state => [state, 'forms/' + id + '-' + state + '.png']))
  }));
  window.mountMayaFrontend({ adapter, identity, forms, storage });
})();
