/* ARKHER HUD — os controles virtuais prontos para cada programa
   ============================================================
   O HUD ja existia (d-pad, botoes e editor). O que faltava era CHEGAR
   PRONTO: quem abre o Roblox Studio no celular nao quer descobrir que a
   tecla de playtest e F5 e digitar botao por botao.

   Aqui ficam conjuntos prontos. Regra: cada tecla de cada conjunto tem
   que funcionar nos DOIS backends (Linux/xdotool e Windows/SendKeys) —
   senao o botao existe e nao faz nada, que e pior do que nao existir.
   O teste confere isso no mapa de teclas de verdade do dsos_core.py. */
(function () {
  const H = {};
  const chave = 'dsos_hud';          /* mesma chave do editor de HUD */
  const chaveSel = 'dsos_hud_preset';

  /* botoes: r = rotulo na tela, k = tecla enviada ao sistema remoto */
  H.presets = {
    navegar: {
      nome: 'Navegar (qualquer app)',
      dica: 'Para andar por menus, janelas e instaladores sem teclado físico.',
      botoes: [
        { k: 'Return', r: 'OK' }, { k: 'Escape', r: 'ESC' }, { k: 'Tab', r: 'TAB' },
        { k: 'BackSpace', r: '\u232B' }, { k: 'space', r: 'Espaço' },
        { k: 'Page_Up', r: 'PgUp' }, { k: 'Page_Down', r: 'PgDn' },
        { k: 'Home', r: 'Início' }, { k: 'End', r: 'Fim' }, { k: 'Delete', r: 'Del' },
      ],
    },
    roblox: {
      nome: 'Roblox Studio',
      dica: 'Ferramentas W/E/R, foco no objeto (F), playtest (F5) e parar (shift+F5). ' +
            'Para olhar em volta, ligue o Mouse e arraste o dedo.',
      botoes: [
        { k: 'F5', r: '▶ Play' }, { k: 'shift+F5', r: '■ Parar' },
        { k: 'f', r: 'Foco' }, { k: 'w', r: 'Mover' },
        { k: 'e', r: 'Girar' }, { k: 'r', r: 'Escalar' },
        { k: 'ctrl+z', r: 'Desfazer' }, { k: 'ctrl+s', r: 'Salvar' },
      ],
    },
    blender: {
      nome: 'Blender',
      dica: 'Mover (G), girar (R), escalar (S), apagar (X), enquadrar (Home) e render (F12). ' +
            'No Blender, mover/girar seguem o dedo: arraste e clique para confirmar.',
      botoes: [
        { k: 'g', r: 'Mover' }, { k: 'r', r: 'Girar' },
        { k: 's', r: 'Escalar' }, { k: 'x', r: 'Apagar' },
        { k: 'shift+A', r: '+ Objeto' }, { k: 'Tab', r: 'Editar' },
        { k: 'Home', r: 'Enquadrar' }, { k: 'F12', r: 'Renderizar' },
        { k: 'ctrl+z', r: 'Desfazer' },
      ],
    },
    desktop: {
      nome: 'Desktop (janelas)',
      dica: 'Copiar, colar, desfazer, trocar de janela e fechar — o básico de um PC.',
      botoes: [
        { k: 'ctrl+c', r: 'Copiar' }, { k: 'ctrl+v', r: 'Colar' },
        { k: 'ctrl+x', r: 'Recortar' }, { k: 'ctrl+z', r: 'Desfazer' },
        { k: 'ctrl+s', r: 'Salvar' }, { k: 'alt+Tab', r: 'Trocar janela' },
        { k: 'alt+F4', r: 'Fechar janela' },
      ],
    },
  };

  /* as setas ficam sempre no d-pad; o resto vai para a lista de botoes */
  H.dir = ['Up', 'Left', 'Right', 'Down'];

  H.nomes = function () { return Object.keys(H.presets); };
  H.atual = function () { return (window.LS ? LS.get(chaveSel, '') : '') || ''; };

  /* aplica o conjunto: grava na MESMA chave que o editor usa, entao o
     usuario pode ajustar depois do jeito dele (o preset e um ponto de partida) */
  H.aplicar = function (nome) {
    const p = H.presets[nome];
    if (!p) return false;
    const setas = H.dir.map(k => ({ k: k, r: { Up: '\u25B2', Left: '\u25C0', Right: '\u25B6', Down: '\u25BC' }[k] }));
    const l = setas.concat(p.botoes.map(b => ({ k: b.k, r: b.r })));
    if (window.LS) { LS.set(chave, l); LS.set(chaveSel, nome); }
    return true;
  };

  /* todas as teclas usadas, para o teste conferir contra o mapa do core */
  H.teclasUsadas = function () {
    const s = {};
    Object.keys(H.presets).forEach(n => {
      H.presets[n].botoes.forEach(b => { s[b.k] = n; });
    });
    H.dir.forEach(k => { s[k] = 'dpad'; });
    return s;
  };

  /* monta o <select> do HUD */
  H.montarSelect = function (sel) {
    if (!sel) return;
    sel.innerHTML = '';
    const z = document.createElement('option');
    z.value = ''; z.textContent = 'Controles: escolha o programa';
    sel.appendChild(z);
    H.nomes().forEach(function (n) {
      const o = document.createElement('option');
      o.value = n; o.textContent = H.presets[n].nome;
      sel.appendChild(o);
    });
    sel.value = H.atual();
  };

  window.HUD = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})();
