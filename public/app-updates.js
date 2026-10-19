/* Detect a new deployment without interrupting a form, recording or game. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function startUpdates(env) {
  const doc = env.document;
  let revision = doc.documentElement.dataset.appRevision || null;
  let busy = false, stopped = false, notice = null, lastChecked = 0;
  const timer = env.setInterval(() => check(), 60000);
  async function check(force = false) {
    if (stopped || busy || doc.hidden || env.navigator.onLine === false) return;
    if (!force && Date.now() - lastChecked < 10000) return;
    busy = true;
    lastChecked = Date.now();
    const ctl = new AbortController();
    const timeout = env.setTimeout(() => ctl.abort(), 5000);
    try {
      const response = await env.fetch('/api/version', {cache:'no-store', signal:ctl.signal});
      if (!response.ok) return;
      const data = await response.json();
      if (stopped || typeof data.revision !== 'string' || !data.revision) return;
      if (!revision) { revision = data.revision; return; }
      if (data.revision === revision || notice) return;
      doc.documentElement.dataset.appUpdate = 'available';
      const css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = '/app-updates.css'; doc.head.append(css);
      notice = doc.createElement('aside'); notice.className = 'app-update-notice'; notice.setAttribute('role','status'); notice.setAttribute('aria-label','Website update');
      const text = doc.createElement('span'); text.textContent = 'An update is ready.';
      const reload = doc.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload when ready';
      reload.addEventListener('click', () => env.location.reload());
      const dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Later';
      dismiss.addEventListener('click', () => { notice.remove(); });
      notice.append(text,reload,dismiss); doc.body.append(notice);
    } catch { /* Keep the current page usable when offline or during a deploy. */ }
    finally { env.clearTimeout(timeout); busy = false; }
  }
  const resume = () => { void check(); };
  function stop() {
    stopped = true; env.clearInterval(timer);
    doc.removeEventListener('visibilitychange',resume);
    env.removeEventListener('online',resume); env.removeEventListener('focus',resume);
    env.removeEventListener('pagehide',onPageHide);
  }
  const onPageHide = (event) => { if (!event.persisted) stop(); };
  doc.addEventListener('visibilitychange',resume);
  env.addEventListener('online',resume); env.addEventListener('focus',resume);
  env.addEventListener('pagehide',onPageHide);
  void check(true);
  return {check,stop};
});
