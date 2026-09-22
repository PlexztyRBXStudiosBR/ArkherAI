/* ============================================================
   MEGA PACK + COFRE NEURAL ARKHER
   ("Arkher's dynamic neural vault" — em português claro)

   O que este arquivo faz, dito sem enfeite:

     ENTRA: um pacote grande de instruções, docs, comandos e notas
            (colado ou de arquivo .txt/.md).
     VIRA:  blocos indexados no motor neural (neural.js), pesquisáveis
            por SIGNIFICADO — não por palavra exata.
     SAI:   os trechos relevantes entram sozinhos no prompt de TODO
            modelo (é o Arkher.preparar fazendo a injeção), e ficam
            guardados no cofre, que cresce sozinho com o uso.

   A parte "dinâmica" é real e já roda: cada resposta boa vira lição
   (Neural.licao), e quando juntam lições o "destilar" comprime tudo em
   REGRAS que entram fixas no prompt. O cofre exporta tudo isso num
   arquivo só — backup e transporte do que o site aprendeu.

   O QUE AQUI NÃO ACONTECE (e não existe em lugar nenhum):
     • "fazer o Claude/GPT/Kimi aprender X" — modelo fechado não recebe
       treino de fora. O que dá é dar o contexto certo na hora certa;
     • "bilhões de instruções dentro do modelo" — contexto é FINITO:
       o que entra no prompt é o que couber. Por isso o cofre indexa
       tudo e manda só os pedaços relevantes;
     • treinar peso no navegador. Quem treina é o nó com GPU, via LoRA
       (neural.js › enviarParaNo), e isso muda UM modelo seu, não os
       modelos dos outros.

   Pack é conhecimento recuperável. Peso é o que o modelo já sabe.
   Misturar os dois é o erro que faz projeto de IA virar fumaça.
   ============================================================ */
'use strict';

const MegaPack = {
  /* ---------- formato do pack ----------
     # PACK: nome                  (título, opcional)
     ## Assunto                    (vira tag de tudo que vier abaixo)
     @tags: a, b                   (opcional, tags extras)
     @fonte: https://...           (opcional, origem)
     - instrução / comando         (cada linha vira um bloco)
     parágrafo solto               (vira bloco; separado por linha vazia)
  */
  MODELO: [
    '# PACK: exemplos que funcionam',
    '## Linux / servidor',
    '@fonte: anotações próprias',
    '- para ver quem está usando a porta 8000: ss -ltnp | grep 8000',
    '- o serviço reinicia sozinho: systemctl restart arkher',
    '',
    '## Preferências do projeto',
    '- respostas curtas, sem introdução; código primeiro, explicação depois.',
    '- nunca inventar caminho de arquivo: confirmar antes.',
  ].join('\n'),

  /* ---------- leitura do pack ---------- */
  parsear(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const itens = [];
    let secao = '', tags = '', fonte = '', buffer = [];

    const fecha = () => {
      const t = buffer.join(' ').replace(/\s+/g, ' ').trim();
      buffer = [];
      if (t.length < 12) return;                       // ruído
      itens.push({ txt: t, tags: (secao + ' ' + tags).trim(), fonte: fonte });
    };

    for (const cru of linhas) {
      const l = cru.trim();
      if (!l) { fecha(); continue; }
      if (/^#\s/.test(l)) { fecha(); continue; }                     // título do pack
      if (/^##+\s/.test(l)) { fecha(); secao = l.replace(/^#+\s*/, ''); continue; }
      if (/^@tags\s*:/i.test(l)) { tags = l.replace(/^@tags\s*:/i, '').trim(); continue; }
      if (/^@fonte\s*:/i.test(l)) { fonte = l.replace(/^@fonte\s*:/i, '').trim(); continue; }
      if (/^[-*•]\s+/.test(l)) {                                     // item de lista
        fecha();
        const t = l.replace(/^[-*•]\s+/, '').trim();
        if (t.length >= 12) itens.push({ txt: t, tags: (secao + ' ' + tags).trim(), fonte: fonte });
        continue;
      }
      buffer.push(l);
    }
    fecha();
    return itens;
  },

  /* ---------- ingestão: é isto que faz o pack virar memória ---------- */
  async ingerir(texto, onLog) {
    if (typeof Neural === 'undefined') return { ok: false, err: 'motor neural não carregado' };
    const log = onLog || (() => {});
    if (!Neural.pronto) { try { await Neural.init(log); } catch (e) {} }

    const itens = this.parsear(texto);
    if (!itens.length) return { ok: false, err: 'nenhum bloco válido no pack (veja o modelo)' };

    log('pack lido: ' + itens.length + ' bloco(s) — indexando…');
    const antes = Neural.stats_().itens;
    const n = await Neural.addMuitos(itens, { src: 'megapack', peso: 1.5, max: 1000 }, log);
    const depois = Neural.stats_().itens;

    return {
      ok: true, blocos: itens.length, adicionados: n,
      novos: depois - antes, base: depois,
      porFonte: Neural.stats_().porFonte,
    };
  },

  /* pacote -> arquivo (no navegador) */
  async ingerirArquivo(file, onLog) {
    const texto = await file.text();
    const r = await this.ingerir(texto, onLog);
    return Object.assign({ arquivo: file.name }, r);
  },

  /* ---------- o COFRE: tudo que o site aprendeu, num arquivo só ---------- */
  exportar(maxItens) {
    if (typeof Neural === 'undefined') return '';
    const linhas = [];
    linhas.push('# PACK: Cofre Neural ARKHER');
    linhas.push('@fonte: exportado em ' + new Date().toISOString().slice(0, 10));
    linhas.push('');

    const regras = Neural.regrasTexto(60);
    if (regras) {
      linhas.push('## regras destiladas (entram sempre no prompt)');
      regras.split('\n').forEach(r => linhas.push(r));   // já vêm com "- "
      linhas.push('');
    }

    const itens = (Neural.itens || []).slice(0, maxItens || 400);
    if (itens.length) {
      linhas.push('## memória indexada (' + itens.length + ' bloco(s))');
      for (const it of itens) {
        if (it.tags) linhas.push('@tags: ' + String(it.tags).slice(0, 120));
        linhas.push('- ' + String(it.txt).replace(/\s+/g, ' ').trim().slice(0, 900));
      }
    }

    const treino = (Neural.treino || []).length;
    if (treino) {
      linhas.push('');
      linhas.push('## lições guardadas');
      linhas.push('- ' + treino + ' par(es) pergunta/resposta no dataset de treino (use "Exportar dataset" para o JSONL)');
    }
    return linhas.join('\n');
  },

  stats() {
    if (typeof Neural === 'undefined') return null;
    const s = Neural.stats_();
    s.tamanhoPack = (this.exportar()).length;
    return s;
  },

  limpar(oque) { return (typeof Neural !== 'undefined') ? Neural.limpar(oque) : null; },
};

if (typeof window !== 'undefined') window.MegaPack = MegaPack;
if (typeof module !== 'undefined' && module.exports) module.exports = { MegaPack };
