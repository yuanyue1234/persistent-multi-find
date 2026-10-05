window.chrome = {
  storage: parent.chrome.storage,
  tabs: { query: async () => [{ id: 1, windowId: 10 }], get: async id => ({ id, windowId: 10 }), sendMessage: async (_id, message) => parent.fixtureSend(message) },
  scripting: { executeScript: async () => {} }
};
