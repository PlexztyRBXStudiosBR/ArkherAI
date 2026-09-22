/* ARKHER PILOT — a IA opera a VM olhando a tela.
   Loop: print -> modelo com visao decide -> executa -> repete.
   Nao e "gerar comando"; e ver e agir, igual gente.

   COORDENADAS: o print vai reduzido (scale 0.5) pra economizar tokens.
   O modelo responde em pixels DA IMAGEM; aqui a gente converte pra
   pixels REAIS da tela antes de mandar pro agente. */
(function () {
  const A = {};
  A.ESCALA = 0.5;

  A.SYS = `Voce opera um Windows REAL por print de tela. Objetivo do usuario abaixo.
Voce recebe a cada passo: a imagem da tela e o que ja fez.
Responda SO com um JSON, nada de texto fora dele:
{"pensa":"1 frase do que ve e por que","acoes":[...],"fim":false,"resumo":""}

Acoes possiveis (coordenadas em pixels DA IMAGEM que voce recebeu):
 {"do":"click","x":100,"y":200}        clique esquerdo
 {"do":"dblclick","x":100,"y":200}
 {"do":"right","x":100,"y":200}
 {"do":"drag","x":10,"y":10,"x2":90,"y2":90}
 {"do":"scroll","x":500,"y":400,"amount":-400}
 {"do":"type","text":"texto"}
 {"do":"key","key":"{ENTER}"}          {TAB} {ESC} {F5} {DEL} {BACKSPACE}
 {"do":"hotkey","combo":"^s"}          ^=ctrl %=alt +=shift  (ex: "^+s", "%{F4}")
 {"do":"app","nome":"roblox"}          abre programa: roblox, blender, explorer, notepad, cmd, edge
 {"do":"wait","sec":3}
Regras:
 - No maximo 5 acoes por passo. Depois de cada passo voce ve a tela de novo.
 - Programa abrindo/carregando: devolva so [{"do":"wait","sec":5}].
 - Para abrir um programa prefira {"do":"app"} em vez de procurar icone.
 - Terminou o objetivo: {"fim":true,"resumo":"o que foi feito"}.
 - Travou 3x no mesmo lugar: tente outro caminho ou pare com fim:true explicando.
 - Roblox Studio pode pedir login manual. Se pedir, pare e avise no resumo.`;

  A.parse = function (t) {
    if (!t) return null;
    let s = String(t).replace(/```json/gi, '```').split('```');
    s = s.length > 1 ? s[1] : s[0];
    const i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j < 0) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) {}
    try { return JSON.parse(s.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
  };

  A.base = function () { return (typeof LS !== 'undefined' && LS.get('arkher_agent', '')) || ''; };

  A.vm = async function (rota, body, metodo, ms) {
    const base = A.base();
    if (!base) throw new Error('sem URL do agente — configure na aba Config');
    const alvo = base.replace(/\/$/, '') + rota;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms || 90000);
    let r;
    try {
      r = await fetch(alvo, {
        method: metodo || (body ? 'POST' : 'GET'),
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(window.explicarFetch ? window.explicarFetch(e, alvo) : e.message);
    } finally { clearTimeout(to); }
    return r.json();
  };

  /* converte as coordenadas da imagem (reduzida) para a tela real */
  A.real = function (acoes, fator) {
    const f = fator || (1 / A.ESCALA);
    return acoes.map(a => {
      const b = Object.assign({}, a);
      for (const k of ['x', 'y', 'x2', 'y2']) if (b[k] != null && isFinite(b[k])) b[k] = Math.round(Number(b[k]) * f);
      return b;
    });
  };

  A.parar = false;

  /* roda o objetivo. cb({tipo,...}) pra UI mostrar ao vivo */
  A.correr = async function (objetivo, cb, opt) {
    opt = opt || {};
    const maxP = opt.passos || 25;
    cb = cb || function () {};
    const hist = [];
    A.parar = false;

    const pronto = await A.vm('/guiready').catch(e => ({ ok: false, err: e.message }));
    if (!pronto.ok) {
      cb({ tipo: 'erro', txt: 'Sem sessao grafica na VM. ' + (pronto.nota || pronto.err || '') });
      return { ok: false, motivo: 'sem-gui' };
    }

    let ilegiveis = 0;
    for (let p = 1; p <= maxP; p++) {
      if (A.parar) { cb({ tipo: 'fim', txt: 'parado pelo usuario' }); return { ok: false, motivo: 'parado' }; }
      let sh;
      try { sh = await A.vm('/screen?scale=' + A.ESCALA + '&q=55'); }
      catch (e) { cb({ tipo: 'erro', txt: 'print falhou: ' + e.message }); return { ok: false }; }
      if (!sh.ok) { cb({ tipo: 'erro', txt: 'print falhou: ' + sh.err }); return { ok: false }; }
      cb({ tipo: 'tela', img: sh.img, passo: p, w: sh.w, h: sh.h });
      // fator real: se o agente informou a resolucao real, usa; senao 1/escala
      const fator = (sh.real_w && sh.w) ? (sh.real_w / sh.w) : (1 / A.ESCALA);

      const msg = [
        { role: 'system', content: A.SYS },
        { role: 'user', content: [
            { type: 'text', text:
              `OBJETIVO: ${objetivo}\n\nPasso ${p}/${maxP}. Imagem ${sh.w}x${sh.h}.` +
              (sh.titulo ? `\nJanela ativa: ${sh.titulo}` : '') +
              (hist.length ? `\nJa fiz:\n- ${hist.slice(-6).join('\n- ')}` : '\nPrimeiro passo.') },
            { type: 'image_url', image_url: { url: sh.img } },
        ] },
      ];

      let bruto;
      try {
        const rr = await Arkher.ask(msg, { visao: true, stage: 'visao', maxTries: 8 });
        bruto = (rr && typeof rr === 'object') ? (rr.text || '') : rr;
        if (rr && rr.model) cb({ tipo: 'modelo', txt: rr.model });
      } catch (e) {
        cb({ tipo: 'erro', txt: 'modelo falhou: ' + e.message }); return { ok: false };
      }

      const d = A.parse(bruto);
      if (!d) {
        ilegiveis++;
        cb({ tipo: 'aviso', txt: 'resposta ilegivel' + (ilegiveis >= 3 ? ' 3x — parando' : ', repetindo') });
        if (ilegiveis >= 3) return { ok: false, motivo: 'modelo nao respondeu em JSON' };
        continue;
      }
      ilegiveis = 0;
      if (d.pensa) cb({ tipo: 'pensa', txt: d.pensa, passo: p });

      if (d.fim) { cb({ tipo: 'fim', txt: d.resumo || 'concluido' }); return { ok: true, resumo: d.resumo }; }

      const acoes = (Array.isArray(d.acoes) ? d.acoes : []).slice(0, 5);
      if (!acoes.length) { hist.push('nada a fazer'); continue; }
      cb({ tipo: 'age', acoes: acoes });
      let r;
      try { r = await A.vm('/input', { acts: A.real(acoes, fator) }); }
      catch (e) { cb({ tipo: 'erro', txt: 'acao falhou: ' + e.message }); return { ok: false }; }
      hist.push(acoes.map(a => a.do + (a.x != null ? `(${a.x},${a.y})` : '') +
                                (a.text ? `"${String(a.text).slice(0, 25)}"` : '') +
                                (a.nome ? `(${a.nome})` : '')).join(' + '));
      if (!r.ok) {
        const erros = (r.res || []).filter(x => !x.ok).map(x => x.err).filter(Boolean);
        cb({ tipo: 'aviso', txt: 'alguma acao falhou' + (erros.length ? ': ' + erros.join('; ').slice(0, 200) : '') });
      }
      await new Promise(s => setTimeout(s, 700));
    }
    cb({ tipo: 'fim', txt: `parei em ${maxP} passos (limite)` });
    return { ok: false, motivo: 'limite' };
  };

  A.abrir = function (nome) { return A.vm('/app', { nome: nome, esperar: 8 }, 'POST', 60000); };

  if (typeof window !== 'undefined') window.Pilot = A;
  if (typeof module !== 'undefined') module.exports = A;
})();
