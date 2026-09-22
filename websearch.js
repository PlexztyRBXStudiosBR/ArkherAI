/* ARKHER WEB — busca na internet, sem chave de API.
   O navegador nao pode ler sites de outras origens (CORS), entao a leitura passa
   por: (1) proxies publicos de CORS, (2) qualquer no seu (VM Windows, Kaggle, Android)
   que esteja configurado — o agente nao tem essa limitacao. */
(function () {
  const W = {};

  const PROXIES = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  ];

  function nos() {
    const l = [];
    const k = LS.get('arkher_kaggle', ''); if (k) l.push({ base: k, sh: 'bash' });
    const d = LS.get('arkher_droid', ''); if (d) l.push({ base: d, sh: 'bash' });
    const a = LS.get('arkher_agent', ''); if (a) l.push({ base: a, sh: 'ps' });
    return l;
  }

  async function comTimeout(url, opt, ms) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 15000);
    try { return await fetch(url, Object.assign({ signal: c.signal }, opt || {})); }
    finally { clearTimeout(t); }
  }

  /* baixa uma URL por um dos nos (curl no Linux, Invoke-WebRequest no Windows) */
  W.viaNo = async function (url) {
    const lista = nos();
    if (!lista.length) throw new Error('sem no configurado');
    let ultimo = null;
    for (const n of lista) {
      const cmd = n.sh === 'bash'
        ? 'curl -sL --max-time 25 -A "Mozilla/5.0" ' + JSON.stringify(url)
        : '(Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 -UserAgent "Mozilla/5.0" ' + JSON.stringify(url) + ').Content';
      try {
        const r = await comTimeout(n.base.replace(/\/$/, '') + '/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, timeout: 40 }),
        }, 45000);
        const j = await r.json();
        if (j.out && j.out.length > 50) return j.out;
        ultimo = new Error(j.err || 'resposta vazia');
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error('nenhum no respondeu');
  };

  /* baixa HTML: tenta os proxies e depois os nos */
  W.baixar = async function (url) {
    let ultimo = null;
    for (const p of PROXIES) {
      try {
        const r = await comTimeout(p(url), {}, 12000);
        if (!r.ok) { ultimo = new Error('proxy HTTP ' + r.status); continue; }
        const t = await r.text();
        if (t && t.length > 50) return t;
        ultimo = new Error('proxy devolveu vazio');
      } catch (e) { ultimo = e; }
    }
    try { return await W.viaNo(url); }
    catch (e) { throw new Error('nao consegui baixar ' + url + ' (' + (ultimo ? ultimo.message : '') + '; ' + e.message + ')'); }
  };

  const tira = t => String(t || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  /* DuckDuckGo HTML: sem chave, sem limite pratico */
  W.buscar = async function (q, n) {
    n = n || 6;
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const html = await W.baixar(url);
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const rs = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m, snips = [];
    while ((m = rs.exec(html))) snips.push(tira(m[1]));
    let i = 0;
    while ((m = re.exec(html)) && out.length < n) {
      let href = m[1].replace(/&amp;/g, '&');
      const u = href.match(/uddg=([^&]+)/);
      if (u) { try { href = decodeURIComponent(u[1]); } catch (e) {} }
      if (/duckduckgo\.com\/y\.js|ad_provider/.test(href)) { i++; continue; }   // anuncio
      out.push({ titulo: tira(m[2]), url: href, texto: snips[i] || '' });
      i++;
    }
    return out;
  };

  /* le uma pagina e devolve o texto limpo */
  W.abrir = async function (url, max) {
    max = max || 6000;
    const html = await W.baixar(url);
    const txt = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
    return txt.slice(0, max);
  };

  /* busca + le os 2 primeiros: contexto pronto pro modelo */
  W.pesquisar = async function (q, onLog) {
    const log = onLog || function () {};
    log('buscando: ' + q);
    const res = await W.buscar(q, 6);
    if (!res.length) return { q: q, resultados: [], texto: 'nada encontrado para "' + q + '"' };
    log(res.length + ' resultados');
    for (let i = 0; i < Math.min(2, res.length); i++) {
      try { log('lendo ' + res[i].url); res[i].conteudo = await W.abrir(res[i].url, 3500); }
      catch (e) { res[i].conteudo = ''; }
    }
    const texto = res.map((r, i) =>
      `[${i + 1}] ${r.titulo}\n${r.url}\n${r.conteudo || r.texto}`).join('\n\n');
    return { q: q, resultados: res, texto: texto };
  };

  if (typeof window !== 'undefined') window.Web = W;
  if (typeof module !== 'undefined') module.exports = W;
})();
