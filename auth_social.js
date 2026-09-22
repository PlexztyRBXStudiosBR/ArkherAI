/* ============================================================
   LOGIN DO SITE — o jeito facil: e-mail/senha (Supabase) e Google.

   O ponto que importa aqui, e que nao pode se perder:

     • esta conta e a conta do SEU SITE. Ela serve para identificar a
       pessoa, guardar os dados dela e dar acesso ao ARKHER.
     • ela NAO e, e nao cria, uma conta no Puter. O Puter e conectado
       depois, com UM clique, e continua sendo a conta daquela pessoa
       (ela autoriza, o credito e dela, e nos nunca vemos a senha).

   Por que a gente nao "cria a conta no Puter pelo site": criar conta em
   nome de alguem, de forma programatica, e cadastro automatizado — e
   alem disso a conta ficaria sob o nosso controle, o que e exatamente
   o desenho que este projeto recusa (credito de quem entra sendo gasto
   por outro). Aqui a pessoa cria a dela, loga na dela, gasta a dela.
   ============================================================ */
'use strict';

const AuthSocial = {
  /* ---- 1) quem voltou do Google: ler os tokens da URL ----
     O Supabase devolve de dois jeitos, dependendo da configuracao do
     projeto: no "hash" (#access_token=…) ou num "code" na query.
     A gente entende os dois.                                                */

  /** chamado no load, antes de qualquer decisao de login */
  async capturarRetorno() {
    if (typeof location === 'undefined') return false;
    try {
      // (a) fluxo implícito: os tokens vem no hash
      const h = String(location.hash || '').replace(/^#/, '');
      if (h && h.includes('access_token=')) {
        const q = new URLSearchParams(h);
        const j = {
          access_token: q.get('access_token'),
          refresh_token: q.get('refresh_token') || '',
          expires_in: Number(q.get('expires_in') || 3600),
          token_type: q.get('token_type') || 'bearer',
        };
        if (j.access_token) {
          Auth._guardar(j);
          try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {}
          return true;
        }
      }
      // (b) fluxo PKCE: veio ?code=… e a gente troca pelo token
      const code = new URLSearchParams(location.search).get('code');
      if (code) {
        const ver = LS.get('arkher_pkce', '');
        if (ver) {
          const c = Auth.cfg();
          const r = await fetch(c.url + '/auth/v1/token?grant_type=pkce', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: c.anon },
            body: JSON.stringify({ auth_code: code, code_verifier: ver }),
          });
          const j = await r.json();
          if (j && j.access_token) {
            Auth._guardar(j);
            LS.set('arkher_pkce', '');
            try { history.replaceState({}, '', location.pathname); } catch (e) {}
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  },

  /* ---- 2) ir para o Google ---- */
  async entrarGoogle(redirecionarPara) {
    const c = Auth.cfg();
    if (!c.url || !c.anon) throw new Error('Configure o Supabase primeiro (URL + anon key).');
    const volta = redirecionarPara || (location.origin + location.pathname);

    /* PKCE: gera um segredo local e manda só o "desafio" pro Supabase.
       Se o navegador nao tiver crypto.subtle, cai no fluxo simples. */
    let extra = '';
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const verifier = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      LS.set('arkher_pkce', verifier);
      const enc = new TextEncoder().encode(verifier);
      const dig = await crypto.subtle.digest('SHA-256', enc);
      const chal = btoa(String.fromCharCode(...new Uint8Array(dig)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      extra = '&code_challenge=' + chal + '&code_challenge_method=s256';
    } catch (e) { extra = ''; }

    const url = c.url + '/auth/v1/authorize?provider=google'
      + '&redirect_to=' + encodeURIComponent(volta) + extra;
    location.href = url;
  },

  /** tem Google ligado no projeto? (a gente só mostra o botão se der) */
  googleProvalvel() {
    return Auth.configurado();
  },
};

/* roda assim que o arquivo entra na página: se a pessoa acabou de voltar
   do Google, a sessao já existe antes de qualquer outra checagem. */
if (typeof window !== 'undefined' && typeof Auth !== 'undefined') {
  Auth.sessDoHash = () => AuthSocial.capturarRetorno();
}
if (typeof window !== 'undefined') window.AuthSocial = AuthSocial;
if (typeof module !== 'undefined' && module.exports) module.exports = { AuthSocial };
