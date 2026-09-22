--[[ =====================================================================
     TESTE DO PACOTE ARKHER (roda fora do Studio, e roda no Studio)

     Como rodar aqui (CI, lupa):
         python3 -c "import lupa; L=lupa.LuaRuntime(); ..."   (o teste_roblox.js faz isso)
     Como rodar no Studio:
         em ReplicatedStorage, crie um ModuleScript com ARKHER.lua e outro
         com ARKHER_Telemetria.lua, um Script com este arquivo, e deixe
         ARKHER / ARKHER_TEL como globais antes de exigir este arquivo.

     Este arquivo NAO toca no Roblox: por isso ele testa de verdade a
     inteligencia (inventario, missoes, NPC, seguranca, salvamento) e a
     fila da telemetria. O que so existe no Studio (RemoteFunction,
     DataStore) e testado na casca, com dubles.
   ===================================================================== ]]

local cont = { ok = 0, falhou = 0 }

local function ok(cond, texto, extra)
  if cond then
    cont.ok = cont.ok + 1
    print("  ok  " .. texto)
  else
    cont.falhou = cont.falhou + 1
    print("  FALHOU: " .. texto .. (extra and ("\n          -> " .. tostring(extra)) or ""))
  end
  return cond
end

local function igual(a, b, texto)
  return ok(a == b, texto, "esperado " .. tostring(b) .. ", veio " .. tostring(a))
end

local function sem(v, agulha, texto)
  return ok(type(v) == "string" and v:find(agulha, 1, true) == nil, texto, tostring(v))
end

print("=== 1) inventario: somar, tirar, peso, pilha e salvamento ===\n")
do
  local inv = ARKHER.Inventario.novo({ pilhaMax = 10, maxPeso = 12, peso = { pedra = 2, poco = 0 } })
  igual(inv:dar("poco", 3), 3, "guardou 3 pocoes")
  local moedas = ARKHER.Inventario.novo({ pilhaMax = 10, pilhas = { moeda = 500 } })
  igual(moedas:dar("moeda", 300), 300, "moeda tem pilha propria (nao fica presa no teto generico)")
  igual(moedas:dar("moeda", 300), 200, "e ela tambem respeita o proprio teto (500)")
  igual(inv:dar("pedra", 7), 6, "respeitou o PESO (so cabiam 6 pedras de 2 kg)")
  igual(inv:dar("pedra", 5), 0, "peso cheio: nao entra mais nada")
  igual(inv:tirar("pedra", 2), 2, "tirou 2 pedras")
  igual(inv:peso(), 8, "peso agora e 8 kg")
  igual(inv:tirar("pedra", 99), 4, "tirar mais do que tem sai so o que tem")
  igual(inv:tirar("nada", 1), 0, "tirar o que nao existe nao faz nada")
  ok(not inv:tem("pedra", 1), "depois de tirar tudo, tem() diz que nao tem")
  igual(inv:dar("pedra", 25), 6, "o PESO manda: 12 kg / 2 kg = 6, mesmo com pilha de 10")

  local saida = inv:saida()
  igual(#saida, 2, "saida() lista os dois itens")
  ok(saida[1].id == "pedra" and saida[2].id == "poco", "e vem em ordem estavel (pedra, poco)")

  local j = ARKHER.Inventario.novo({ pilhaMax = 10 })
  j:deSalvar({ { id = "pedra", q = 4 }, { id = "poco", q = 99 }, { q = 3 }, "lixo", { id = "x", q = 5 } })
  igual(j.itens["pedra"], 4, "salvamento: leu o item valido")
  igual(j.itens["poco"], 10, "salvamento: cortou a quantidade no teto da pilha")
  igual(j.itens["x"], 5, "salvamento: aceita item que so apareceu depois")
  ok(j.itens["nil"] == nil, "salvamento: item sem id foi ignorado")
  igual(j:dar("", 5), 0, "id vazio nao entra")
end

print("\n=== 2) missoes: so fica pronta cumprindo, e so entrega pronta ===\n")
do
  local m = ARKHER.Missoes.nova({
    { id = "matar5", evento = "zumbi", alvo = 5 },
    { id = "chefe", evento = "chefe", alvo = 1, precisa = { "matar5" } },
  })
  ok(m:aceitar("chefe") == false, "missao com dependencia nao aceita antes da outra")
  ok(m:aceitar("matar5") == true, "aceitou a primeira")
  igual(#m:registrar("zumbi", 3), 0, "com 3 de 5 ainda nao fica pronta")
  local prontas = m:registrar("zumbi", 2)
  igual(prontas[1], "matar5", "com 5 de 5 fica pronta, e diz qual")
  ok(m:entregar("matar5", nil, {}) ~= nil, "entregou a pronta")
  ok(m:entregar("matar5", nil, {}) == nil, "entregar de novo nao faz nada")
  ok(m:aceitar("chefe") == true, "agora a dependente aceita")
  igual(m.concluidas, 1, "o placar conta 1 concluida")

  local inv = ARKHER.Inventario.novo({})
  m:registrar("chefe", 1)
  local ganhou = m:entregar("chefe", inv, { { item = "coroa", q = 1 } })
  igual(inv.itens["coroa"], 1, "a recompensa caiu no inventario")
  ok(ganhou and ganhou["coroa"] == 1, "e a entrega diz o que entrou")
  igual(#m:listar(), 2, "listar() mostra as duas missoes com estado")
end

print("\n=== 3) NPC: a tabela de comportamento decide direito ===\n")
do
  local cfg = ARKHER.NPC.padrao
  igual(ARKHER.NPC.decidir({ vidaPct = 0.1, ve = true, dist = 5 }, cfg), "fugir", "com pouca vida, foge (mesmo com o alvo na frente)")
  igual(ARKHER.NPC.decidir({ vidaPct = 1, ve = true, dist = 5 }, cfg), "atacar", "perto: ataca")
  igual(ARKHER.NPC.decidir({ vidaPct = 1, ve = true, dist = 30 }, cfg), "perseguir", "vendo de longe: persegue")
  igual(ARKHER.NPC.decidir({ vidaPct = 1, ve = false, modo = "perseguir", tempoSemVer = 2 }, cfg), "perseguir",
        "lembra do jogador por alguns segundos depois de perde-lo")
  igual(ARKHER.NPC.decidir({ vidaPct = 1, ve = false, modo = "perseguir", tempoSemVer = 20 }, cfg), "patrulhar",
        "passou a memoria: volta a patrulhar")
  igual(ARKHER.NPC.decidir({ vidaPct = 1, ve = false }, cfg), "patrulhar", "sem ninguem: patrulha")

  local pontos = { { x = 0 }, { x = 10 }, { x = 20 } }
  local p, i, volta = ARKHER.NPC.proximoPosto(pontos, 1, false)
  ok(i == 2 and volta == false, "ronda: vai para o posto 2", "i=" .. tostring(i))
  p, i, volta = ARKHER.NPC.proximoPosto(pontos, 2, false)
  ok(i == 3 and volta == "fim", "chegou no ultimo posto (marca fim)", "i=" .. tostring(i))
  p, i, volta = ARKHER.NPC.proximoPosto(pontos, 3, true)
  ok(i == 2 and volta == true, "e volta pelo caminho (nao teleporta para o inicio)", "i=" .. tostring(i))
  p, i, volta = ARKHER.NPC.proximoPosto({ { x = 0 } }, 1, false)
  ok(volta == "fim", "um posto so: fica nele")
end

print("\n=== 4) seguranca: quem decide e o servidor ===\n")
do
  local s = ARKHER.Seguranca.nova({ limite = 3, janela = 1, maxDist = 40 })
  local t = 100
  ok(s:permite("p1", t) == true, "primeiro pedido passa")
  s:permite("p1", t); s:permite("p1", t)
  local pode, motivo = s:permite("p1", t)
  ok(pode == false and motivo == "pedidos demais", "o quarto pedido no mesmo segundo e recusado (limite de taxa)")
  ok(s:permite("p2", t) == true, "e a recusa de um jogador nao afeta outro")
  ok(s:permite("p1", t + 1.2) == true, "passada a janela, volta a aceitar")

  local okp, d = s:posicaoOK({ x = 0, y = 0, z = 0 }, { x = 120, y = 0, z = 0 }, 5, 60)
  ok(okp == false and d == "salto longo demais", "teleporte de 120 metros e recusado")
  okp, d = s:posicaoOK({ x = 0, y = 0, z = 0 }, { x = 10, y = 0, z = 0 }, 10, 60)
  ok(okp == true and d == 10, "10 metros em 10 s e normal (diz a distancia medida)")
  okp = s:posicaoOK({ x = 0, y = 0, z = 0 }, { x = 38, y = 0, z = 0 }, 0.2, 60)
  ok(okp == false, "38 metros em 0,2 s e impossivel: recusado (velocidade)")
  okp = s:posicaoOK("nada", { x = 1 }, 1, 60)
  ok(okp == false, "posicao invalida e recusada")

  local inv = ARKHER.Inventario.novo({})
  inv:dar("moeda", 100)
  local c, valor = s:compraOK(inv, "espada", 50, 2)
  ok(c == false and valor == "moeda insuficiente", "sem moeda suficiente, recusa")
  c, valor = s:compraOK(inv, "espada", 50, 1)
  ok(c == true and valor == 50, "com moeda, autoriza — e o PRECO veio do servidor")
  c, valor = s:compraOK(inv, "espada", nil, 1)
  ok(c == false and valor == "item sem preco no servidor", "item sem preco no servidor: recusa")
  c = s:compraOK(inv, "espada", 1, 500)
  ok(c == false, "quantidade absurda e recusada")
end

print("\n=== 5) Jogo.pedido(): o cliente pede, o servidor confere ===\n")
do
  local j = ARKHER.novoJogo({ nome = "Teste", precos = { pocao = 30 }, seguranca = { limite = 50 },
                              inventario = { pilhas = { moeda = 999999 } } })
  local inv = j:inventarioDe("j1")
  inv:dar("moeda", 100)

  local okc, r = j:pedido("j1", "comprar", { item = "pocao", qtd = 2 })
  ok(okc == true and r.qtd == 2 and r.pago == 60, "compra autorizada: 2 pocoes por 60 (preco do servidor)", tostring(r.pago))
  igual(inv.itens["moeda"], 40, "a moeda saiu")
  igual(inv.itens["pocao"], 2, "e o item entrou")

  okc, r = j:pedido("j1", "comprar", { item = "pocao", qtd = 2 })
  ok(okc == false and r == "moeda insuficiente", "moeda insuficiente (60 pedidos, 40 na mao): recusa", tostring(r))
  okc, r = j:pedido("j1", "comprar", { item = "pocao" })
  ok(okc == true, "e com 40 moedas, 1 pocao de 30 ainda passa")

  okc, r = j:pedido("j1", "voar", {})
  ok(okc == false and r == "pedido desconhecido", "pedido que nao existe e recusado com o motivo")

  local j2 = ARKHER.novoJogo({ seguranca = { limite = 2, janela = 10 } })
  j2:pedido("j2", "comprar", {}, 500)
  j2:pedido("j2", "comprar", {}, 500)
  okc, r = j2:pedido("j2", "comprar", {}, 500)
  ok(okc == false and r == "pedidos demais", "o servidor corta o cliente que pede demais")

  local j3 = ARKHER.novoJogo({ precos = { poco = 10 } })
  local inv3 = j3:inventarioDe("j3")
  inv3:dar("moeda", 100)
  okc, r = j3:pedido("j3", "comprar", { item = "poco", qtd = 5 }, 700)
  ok(okc == false or r.qtd == 5, "compra normal ou recusa explicada", tostring(r))

  local npc = j:registrarNPC("z1", { ver = 50 }, { { x = 0 }, { x = 10 } })
  local acao = j:passoNPC("z1", { ve = true, dist = 5, vidaPct = 1 }, 0.1)
  igual(acao, "atacar", "NPC com alvo na frente: ataca")
  acao = j:passoNPC("z1", { ve = false, dist = 99, vidaPct = 1 }, 0.1)
  igual(acao, "perseguir", "perdeu de vista agora: ainda persegue (memoria)")
  for _ = 1, 70 do j:passoNPC("z1", { ve = false, dist = 99, vidaPct = 1 }, 0.1) end
  acao = j:passoNPC("z1", { ve = false, dist = 99, vidaPct = 1 }, 0.1)
  igual(acao, "patrulhar", "passada a memoria: voltou a patrulhar")
end

print("\n=== 6) animacao e dialogo ===\n")
do
  local A = ARKHER.Animacao
  igual(A.escolher({ ferido = true, atacando = true, correndo = true }), "ferido", "ferido ganha de tudo")
  igual(A.escolher({ atacando = true, correndo = true }), "atacando", "atacando ganha de correr")
  igual(A.escolher({ noChao = false, subindo = true }), "pulando", "subindo: pulando")
  igual(A.escolher({ noChao = false }), "caindo", "sem chao e sem subir: caindo")
  igual(A.escolher({ correndo = true, velocidade = 20 }), "correndo", "correndo")
  igual(A.escolher({ velocidade = 8 }), "andando", "andando")
  igual(A.escolher({ velocidade = 0 }), "parado", "parado")
  ok(A.deveTrocar("andando", "correndo", 0) == true, "subir de estado troca na hora")
  ok(A.deveTrocar("correndo", "parado", 0.05) == false, "descer de estado espera um pouco (nao pisca)")
  ok(A.deveTrocar("correndo", "parado", 0.5) == true, "passado o tempo, desce tambem")

  local d = ARKHER.Dialogo.novo({
    inicio = { fala = "oi", opcoes = { { ir = "missao" } } },
    missao = { fala = "pega 5", opcoes = { { ir = "fim" } } },
    fim = { fala = "valeu" },
  })
  ok(d:primeiraVez() == true, "primeira vez que a fala aparece: sim")
  igual(d:escolher(1), "missao", "escolher leva para o proximo no")
  ok(d:primeiraVez() == true, "o no novo tambem e primeira vez")
  ok(d:escolher(9) == nil, "opcao que nao existe nao vai a lugar nenhum")
  d:escolher(1)
  igual(d.atual, "fim", "chegou no fim")
end

print("\n=== 7) salvamento: nada de confiar no que chega ===\n")
do
  local S = ARKHER.Salvar
  local bom = S.montar({ jogador = "anon", inventario = { { id = "pedra", q = 2 } } })
  local lido, motivo = S.ler(bom)
  ok(lido ~= nil and lido.v == S.VERSAO, "salvamento normal passa")
  lido, motivo = S.ler(nil)
  ok(lido == nil and motivo == "salvamento vazio", "salvamento vazio e recusado")
  lido, motivo = S.ler({ v = 99, inventario = {} })
  ok(lido == nil and motivo == "salvamento de versao futura", "versao futura e recusada (nao adivinha)")
  lido, motivo = S.ler({ v = 3, inventario = { { id = 5, q = 1 } } })
  ok(lido == nil and motivo:find("item invalido") ~= nil, "item com id errado e recusado com a posicao")
  lido = S.ler({ v = 3, inventario = {} })
  ok(lido ~= nil, "inventario vazio e valido (jogo novo)")
  ok(S.MAX_BYTES == 200 * 1024, "existe teto declarado para o salvamento")
end

print("\n=== 8) telemetria: fila, limites, anonimato e limpeza ===\n")
do
  local a1 = ARKHER_TEL.apelido("sal-1", 12345)
  local a2 = ARKHER_TEL.apelido("sal-1", 12345)
  local a3 = ARKHER_TEL.apelido("sal-2", 12345)
  igual(a1, a2, "o mesmo apelido sai igual (da para agrupar por jogador)")
  ok(a1 ~= a3, "sal diferente gera apelido diferente (nao da para seguir entre servidores)")
  sem(a1, "12345", "e o apelido NAO contem o id do jogador")

  local limpo = ARKHER_TEL.limparDados({
    fase = 3, x = 120, z = -44, causa = "queda",
    nome = "Fulano", email = "a@b.c", chat = "oi", userId = 99,
    texto = string.rep("a", 300), nan = 0 / 0, inf = 1 / 0, funcao = print,
  })
  ok(limpo ~= nil, "limparDados devolve a copia limpa")
  ok(limpo.nome == nil and limpo.email == nil and limpo.chat == nil and limpo.userId == nil,
     "nome, e-mail, conversa e id do jogador NAO passam (bloqueados por regra)")
  igual(#limpo.texto, 80, "texto longo e cortado em 80")
  ok(limpo.nan == nil and limpo.inf == nil, "nan e infinito nao passam")
  ok(limpo.funcao == nil, "funcao nao passa")
  igual(limpo.fase, 3, "o que interessa (fase, posicao, causa) passa inteiro")
  local fundo = ARKHER_TEL.limparDados({ a = { b = { c = { d = 1 } } } })
  ok(fundo.a == nil or fundo.a.b == nil, "tabela funda demais nao e copiada inteira")

  local c = ARKHER_TEL.novoCliente({ url = "http://no:8777", jogo = "jogo-teste", filaMax = 3, loteMax = 2, limiteEnvio = 2 })
  igual(c:pendente(), 0, "fila começa vazia")
  c:registrar("morte", { fase = 1 }, 111)
  c:registrar("morte", { fase = 2 }, 111)
  c:registrar("travou", { fase = 2, x = 1, z = 1 })
  ok(c:pendente() == 3, "tres eventos na fila")
  c:registrar("morte", { fase = 3 }, 222)
  ok(c:pendente() == 3, "o teto da fila segura: continua com 3", tostring(c:pendente()))
  ok(c.descartados == 1, "e conta o que foi descartado (nao esconde)")
  ok(c.fila[1].evento == "morte" and c.fila[1].dados.fase == 2, "o mais ANTIGO saiu (o novo ficou)")

  ok(c:registrar("", {}) == false, "evento sem nome e recusado")
  ok(c:registrar(string.rep("x", 99), {}) == false, "evento com nome absurdo e recusado")

  local lote = c:lote()
  igual(#lote, 2, "lote() pega no maximo o tamanho do lote")
  igual(c:pendente(), 1, "e o que saiu nao esta mais na fila")

  -- limite por minuto
  ok(c:podeEnviar(1000) == true, "pode enviar no primeiro minuto")
  c.envios = { 1000, 1000 }
  ok(c:podeEnviar(1005) == false, "no teto por minuto, NAO manda (nao estoura o limite do Roblox)")
  ok(c:podeEnviar(1070) == true, "passado o minuto, volta a poder")

  -- envio com dublê de HttpService
  local recebido = {}
  local httpOk = { Post = function(self, url, corpo, tipo, compressao)
    recebido[#recebido + 1] = { url = url, corpo = corpo, tipo = tipo }
    return '{"ok":true}'
  end }
  local c2 = ARKHER_TEL.novoCliente({ url = "http://no:8777/", jogo = "j", loteMax = 10 })
  c2:registrar("morte", { fase = 1 }, 7)
  local okE, r = c2:enviar(httpOk, function(x) return "json:" .. tostring(x.lote[1].evento) end, 2000)
  ok(okE == true and r.enviados == 1, "enviou 1 evento", tostring(r.enviados))
  igual(recebido[1].url, "http://no:8777/evento", "chamou a rota /evento do no (sem barra dupla)")
  ok(recebido[1].corpo:find("json:morte", 1, true) ~= nil, "o corpo e o que o encode montou")
  ok(c2.enviados == 1, "e o placar conta o que saiu")

  local httpRuim = { Post = function() error("no fora do ar") end }
  local c3 = ARKHER_TEL.novoCliente({ url = "http://no:8777", jogo = "j" })
  c3:registrar("morte", {}, 1)
  local okE2, r2 = c3:enviar(httpRuim, function(x) return "{}" end, 3000)
  ok(okE2 == false and r2.motivo == "falha de rede", "no fora do ar: falha de rede (e o jogo NAO quebra)")
  igual(c3:pendente(), 0, "o lote perdido NAO volta para a fila (senao o jogo acumula lixo)")
  ok(c3.descartados == 1, "e o descarte e contado")
  ok(c3.erros == 1, "e o erro e contado")

  local s = c3:stats()
  ok(s.naFila == 0 and s.enviados == 0 and s.descartados == 1, "stats() diz a verdade sobre a fila")
  ok(ARKHER_TEL.MAX_FILA == 300 and ARKHER_TEL.ENVIOS_POR_MINUTO == 30,
     "os tetos estao declarados no arquivo (nao sao surpresa)")
end

print("\n=== 9) a casca do Roblox: ligar() com dubles ===\n")
do
  -- ReplicatedStorage de mentira + Instance de mentira
  local criados = {}
  local InstanceFalso = { new = function(classe)
    local o = { ClassName = classe, nome = "", filhos = {} }
    o.__index = o
    setmetatable(o, {
      __newindex = function(t, k, v) if k == "Name" then rawset(t, "nome", v) else rawset(t, k, v) end end,
      __index = function(t, k) return rawget(t, k) end,
    })
    criados[#criados + 1] = o
    return o
  end }
  local j = ARKHER.novoJogo({ nome = "Casca" })
  local okL, msg = j:ligar({ ReplicatedStorage = { nome = "RS" }, Instance = InstanceFalso })
  ok(okL == true and msg == "ligado", "ligar() aceitou os servicos")
  igual(#criados, 1, "criou UM RemoteFunction (nao um por sistema)")
  igual(criados[1].ClassName, "RemoteFunction", "e e um RemoteFunction")
  ok(type(j.pedidoRemoto.OnServerInvoke) == "function", "com a porta do servidor ligada")

  -- o cliente chama pela porta: quem responde e o servidor
  local jogadorFalso = { UserId = 777 }
  local okp, r = j.pedidoRemoto.OnServerInvoke(jogadorFalso, "voar", {})
  ok(okp == false and r == "pedido desconhecido", "pedido pela porta passa pela mesma regra do servidor")

  local semRS, msg2 = ARKHER.novoJogo({}):ligar({})
  ok(semRS == false and msg2:find("ReplicatedStorage") ~= nil,
     "sem ReplicatedStorage, recusa e diz o que falta (nao finge que ligou)")
end

print("\n   resumo: a inteligencia e Lua puro e foi testada; a casca do Roblox e fina de proposito.")
print(string.format("\n%s %d ok, %d falha(s)\n",
  cont.falhou == 0 and "ARKHER_LUA_OK" or "ARKHER_LUA_FALHOU", cont.ok, cont.falhou))

if _G.__arkherTesteSaida then _G.__arkherTesteSaida(cont) end
return cont
