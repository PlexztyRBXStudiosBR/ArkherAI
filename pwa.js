/* ============================================================
   PWA — o site vira app instalavel (celular, Windows, Linux, Mac).

   Por que assim e nao um app nativo:
   - o ARKHER e o proprio agente que roda em Windows/Linux/Kaggle.
     Um app nativo seria 2 codigos (Android + Windows) pra manter o
     mesmo painel, e teria de reimplementar: cascata de modelos,
     Supabase, DsOS... Tudo isso ja vive no navegador e funciona em
     qualquer aparelho, inclusive o celular (que e o "terceiro no").
   - Com o service worker (sw.js) o casco do site fica guardado:
     abre offline, abre instantaneo, e entra na gaveta de apps com icone.
   - O que um nativo daria de extra e justamente o que NAO serve aqui:
     acesso cru a rede sem CORS (isso o agente ja resolve) e rodar em
     segundo plano (o trabalho pesado ja roda no no, nao no seu PC).

   Este arquivo: registra o service worker, mostra o botao "Instalar"
   quando o navegador oferecer, e avisa quando esta offline. Nao faz
   nada silencioso: o botao so aparece se o navegador permitir.
   ============================================================ */
'use strict';
(function () {
  const P = {};
  P.registrado = false;
  P.podeInstalar = false;
  P.offline = false;

  /* ninguem quer cache velho durante o desenvolvimento: em localhost, fora */
  const localidade = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    || location.protocol === 'file:';

  /* mesmo aviso que a ui.js usa (o #ark-toast e criado na hora se nao existir) */
  function avisar(txt) {
    try {
      if (typeof window.toast === 'function') return window.toast(txt);
      let t = document.getElementById('ark-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'ark-toast';
        t.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;max-width:320px;' +
          'padding:10px 13px;border-radius:9px;background:#14301f;border:1px solid #2f7a4a;' +
          'color:#a8f0c4;font-size:12px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.5)';
        document.body.appendChild(t);
      }
      t.textContent = txt;
      t.style.display = 'block';
      clearTimeout(t._x);
      t._x = setTimeout(() => { t.style.display = 'none'; }, 6000);
      return true;
    } catch (e) { console.log('[ARKHER] ' + txt); return false; }
  }

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator && !localidade) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      P.registrado = true;
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        if (!novo) return;
        novo.addEventListener('statechange', () => {
          if (novo.state === 'installed' && navigator.serviceWorker.controller) {
            avisar('Versão nova do ARKHER baixada — feche e abra de novo pra usar.');
          }
        });
      });
    }).catch(e => console.log('[PWA] service worker nao registrou:', e.message));
  }

  /* ---------- botao instalar ---------- */
  let eventoInstalar = null;
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    eventoInstalar = ev;
    P.podeInstalar = true;
    const b = document.getElementById('b-instalar');
    if (b) { b.style.display = ''; b.title = 'Instalar o ARKHER como app'; }
  });

  P.instalar = async function () {
    if (!eventoInstalar) { avisar('Este navegador não ofereceu a instalação ainda. No Chrome/Edge: menu > Instalar app. No iPhone: Compartilhar > Adicionar à Tela de Início.'); return false; }
    eventoInstalar.prompt();
    const escolha = await eventoInstalar.userChoice;
    P.podeInstalar = false;
    eventoInstalar = null;
    const b = document.getElementById('b-instalar');
    if (b && escolha.outcome === 'accepted') b.style.display = 'none';
    return escolha.outcome === 'accepted';
  };

  window.addEventListener('appinstalled', () => {
    P.podeInstalar = false;
    avisar('ARKHER instalado — agora ele abre como qualquer app.');
  });

  /* ---------- offline / online ---------- */
  function marcar() {
    P.offline = !navigator.onLine;
    const b = document.getElementById('b-offline');
    if (b) b.style.display = P.offline ? '' : 'none';
    if (!P.offline && typeof window.pingAgent === 'function') { try { window.pingAgent(); } catch (e) {} }
  }
  window.addEventListener('online', marcar);
  window.addEventListener('offline', marcar);

  /* ---------- atalhos do manifest (?aba=term) ---------- */
  try {
    const aba = new URLSearchParams(location.search).get('aba');
    if (aba) {
      const tab = document.querySelector('.tab[data-v="' + aba + '"]');
      if (tab) setTimeout(() => tab.click(), 400);
    }
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('b-instalar');
    if (b) b.onclick = () => P.instalar();
    marcar();
    if (P.podeInstalar && b) b.style.display = '';
  });

  window.PWA = P;
})();
