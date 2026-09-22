/* ARKHER KAGGLE — no Linux com GPU (P100/T4, 32GB RAM).
   Mesmo protocolo do agent.py: /health /exec /spawn /job. */
(function () {
  const K = {};
  K.url = function () { return LS.get('arkher_kaggle', ''); };
  K.setUrl = function (u) { LS.set('arkher_kaggle', (typeof normUrl === 'function') ? normUrl(u) : String(u || '').trim().replace(/\/+$/, '')); };

  K.call = async function (rota, body) {
    const b = K.url();
    if (!b) throw new Error('sem no Kaggle — cole a URL na aba VM');
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 120000);
    try {
      const r = await fetch(b + rota, {
        method: body ? 'POST' : 'GET', signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      return await r.json();
    } catch (e) {
      throw new Error(window.explicarFetch ? window.explicarFetch(e, b) : e.message);
    } finally { clearTimeout(to); }
  };

  K.health = function () { return K.call('/health'); };
  K.exec = async function (cmd) {
    const j = await K.call('/exec', { cmd: cmd, timeout: 600 });
    return (j.out || '') + (j.err ? '\n' + j.err : '');
  };
  K.gerar3d = function (prompt, motor) {
    return K.call('/gerar3d', { prompt: prompt, motor: motor || 'auto' });
  };

  if (typeof window !== 'undefined') window.Kaggle = K;
  if (typeof module !== 'undefined') module.exports = K;
})();
