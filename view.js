// Runs before CSS layout; only standalone hosts use viewport-sized roots.
(() => {
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'window' || view === 'side') document.documentElement.classList.add('persistent-view');
})();
