'use strict';

/**
 * Como os recursos são chamados (23/10, revisão pedida pelo Davi depois de "onde fica a cidade de
 * Iconha-ES" virar pesquisa): os padrões de texto respondem na hora; o que eles deixam passar, o
 * entendimento (o modelo) manda para o recurso certo com os lugares que leu; nomes de lugar são
 * limpos num lugar só; faltando um dado, o recurso deixa o entendimento completar pela conversa.
 */

const nucleo = require('../../src/agent/nucleo');
const rotas = require('../../src/agent/rotas-do-codigo');
const capacidades = require('../../src/agent/capacidades');
const { normalizarLugar, tentativas, rastroDoCartao, escolherLugar, lugarDaConversa } = require('../../src/agent/lugares');
const clima = require('../../src/agent/clima-no-chat');

module.exports = [
  {
    nome: 'recursos: o entendimento conhece calendário, clima e mapa; "sugerir" de um recurso que responde vira "acao"; os lugares vêm limpos; a trava recusa ação sem relação com a pergunta',
    tipo: 'unidade',
    executar() {
      const ler = (j, p) => nucleo.lerEntendimento(JSON.stringify(j), p);
      const lista = capacidades.listaParaEntender();
      const iconha = ler({ precisa_buscar: true, acao: '', sugerir: 'mapa', lugares: ['Iconha, ES'] }, 'onde fica iconha ?');
      const chuva = ler({ acao: 'clima', lugares: ['Recife'] }, 'e amanhã, chove lá?');
      const errado = ler({ acao: 'clima', lugares: [] }, 'quem descobriu o Brasil?');
      const rede = ler({ acao: '', sugerir: 'teste_de_rede' }, 'como melhorar minha internet para jogar?');
      return [
        ['"calendario"', '"clima"', '"mapa"'].every((id) => lista.includes(id)) || 'os três na lista do entendimento',
        iconha.acao === 'mapa' && iconha.sugerir === null && iconha.lugares[0] === 'Iconha, ES' || JSON.stringify(iconha),
        chuva.acao === 'clima' && chuva.lugares[0] === 'Recife' || JSON.stringify(chuva),
        errado.acao === null || 'ação sem relação com a pergunta passou',
        rede.acao === null && rede.sugerir === 'teste_de_rede' || 'oferta de teste de rede continua oferta',
        /"lugares"/.test(nucleo.pedidoDeEntendimento({ pergunta: 'x', hoje: 'hoje' })) || 'o pedido ao modelo traz "lugares"',
        // lugar por relação: o código reconhece a intenção, o modelo resolve o lugar
        rotas.escolherRota({ objetivo: 'onde fica a capital da Bahia?', conversa: [] }) === null && rotas.intencao('onde fica a capital da Bahia?') === 'mapa' || 'capital da Bahia',
        rotas.intencao('como está o tempo na capital do Paraná?') === 'clima' || 'tempo na capital',
        rotas.intencao('quem descobriu o Brasil?') === null && rotas.intencao('qual a temperatura da minha cpu?') === null || 'sem intenção',
        // o modelo devolveu o que já estava escrito ("a maior cidade do Brasil" → ["Brasil"]): não resolveu
        require('../../src/agent/lugares').naoResolveu('onde fica a maior cidade do Brasil?', ['Brasil']) && !require('../../src/agent/lugares').naoResolveu('onde fica a capital da Bahia?', ['Salvador, BA']) && !require('../../src/agent/lugares').naoResolveu('onde fica iconha?', ['Iconha']) || 'relação não resolvida',
      ];
    },
  },
  {
    nome: 'recursos: nomes de lugar limpos num lugar só ("a cidade de Iconha-ES" → "Iconha, ES"; "Cidade do México" fica) e a ação chega ao recurso com os lugares do entendimento',
    tipo: 'unidade',
    async executar() {
      const pedidos = [];
      const baixar = async (url) => {
        pedidos.push(decodeURIComponent(url));
        if (url.includes('nominatim') && /q=Iconha/.test(url)) return { ok: true, status: 200, texto: JSON.stringify([{ name: 'Iconha', lat: '-20.79', lon: '-40.81', importance: 0.5, address: { town: 'Iconha', state: 'Espírito Santo', country: 'Brasil', country_code: 'br' } }]) };
        return { ok: true, status: 200, texto: '[]' };
      };
      const r = await rotas.executar('mapa', { objetivo: 'onde fica iconha ?', conversa: [], deps: { baixar }, config: {}, ent: { lugares: ['a cidade de Iconha-ES'] } });
      return [
        normalizarLugar('a cidade de Iconha-ES') === 'Iconha, ES' && normalizarLugar('Iconha (ES)') === 'Iconha, ES' && normalizarLugar('Cidade do México') === 'Cidade do México' && normalizarLugar('o município de Campinas') === 'Campinas' || 'normalização',
        tentativas('cidade de Iconha', ['Iconha, ES']).join('|') === 'Iconha|Iconha, ES' || tentativas('cidade de Iconha', ['Iconha, ES']).join('|'),
        r?.rota === 'mapa' && /^\*\*Iconha\*\* fica em Espírito Santo, Brasil\./.test(r.texto) || r?.texto?.slice(0, 120),
        pedidos.some((u) => u.includes('q=Iconha, ES')) || pedidos.join(' ; '),
      ];
    },
  },
  {
    nome: 'recursos: o cartão deixa um rastro curto no histórico; "lá", "ali", "nessa cidade" viram o último lugar da conversa (nunca são procurados no mapa); sem "lá", vale a cidade da memória',
    tipo: 'unidade',
    async executar() {
      const rastro = rastroDoCartao('mapa', JSON.stringify({ tipo: 'lugar', lugar: { nome: 'Iconha', onde: 'Espírito Santo, Brasil' } }));
      const rota = rastroDoCartao('mapa', JSON.stringify({ tipo: 'rota', origem: { nome: 'Vitória', onde: 'Espírito Santo, Brasil' }, destino: { nome: 'Iconha', onde: 'Espírito Santo, Brasil' } }));
      const conversa = [{ role: 'user', content: 'onde fica iconha?' }, { role: 'assistant', content: `**Iconha** fica em Espírito Santo, Brasil.\n${rastro}` }];
      // o clima pelo rastro: "e o clima lá amanhã?" pelos padrões, sem o modelo
      const pedidos = [];
      const baixar = async (url) => {
        pedidos.push(decodeURIComponent(url));
        if (url.includes('geocoding')) return { ok: true, status: 200, texto: JSON.stringify({ results: [{ name: 'Iconha', latitude: -20.79, longitude: -40.81, country_code: 'BR', country: 'Brasil', admin1: 'Espírito Santo', population: 12000 }] }) };
        return { ok: false, status: 503 };
      };
      await clima.responderClima({ pergunta: 'e o clima lá amanhã?', conversa, deps: { baixar }, config: {} });
      return [
        rastro === '[cartão de mapa: Iconha, Espírito Santo]' || rastro,
        rota === '[cartão de mapa: Vitória, Espírito Santo → Iconha, Espírito Santo]' && lugarDaConversa([{ role: 'assistant', content: rota }]) === 'Iconha, Espírito Santo' || rota,
        escolherLugar({ doTexto: 'lá', conversa }) === 'Iconha, Espírito Santo' || 'lá',
        escolherLugar({ doTexto: 'nessa cidade', conversa, memoria: 'Campinas' }) === 'Iconha, Espírito Santo' || 'nessa cidade',
        escolherLugar({ doTexto: null, conversa, pergunta: 'como está o tempo?', memoria: 'Campinas' }) === 'Campinas' || 'sem "lá", a memória',
        escolherLugar({ doTexto: 'lá', conversa: [] }) === null || '"lá" sem conversa não vira lugar',
        pedidos.some((u) => u.includes('geocoding') && u.includes('name=Iconha')) || pedidos.join(' ; '),
      ];
    },
  },
  {
    nome: 'recursos: nome ambíguo — numa rota vale o homônimo mais perto do outro ponto; sozinho, o do Brasil com metade da relevância ganha do mais famoso lá fora',
    tipo: 'unidade',
    async executar() {
      const mapa = require('../../src/agent/mapa-no-chat');
      const vitorias = [
        { name: 'Victoria', lat: '-37.0', lon: '144.0', importance: 0.8, address: { state: 'Victoria', country: 'Austrália', country_code: 'au' } },
        { name: 'Vitória', lat: '-20.31', lon: '-40.31', importance: 0.6, address: { city: 'Vitória', state: 'Espírito Santo', country: 'Brasil', country_code: 'br' } },
      ];
      const baixar = async (url) => {
        if (url.includes('nominatim')) return { ok: true, status: 200, texto: JSON.stringify(/q=Iconha/.test(url) ? [{ name: 'Iconha', lat: '-20.79', lon: '-40.81', importance: 0.4, address: { town: 'Iconha', state: 'Espírito Santo', country: 'Brasil', country_code: 'br' } }] : vitorias) };
        return { ok: true, status: 200, texto: JSON.stringify({ code: 'Ok', routes: [{ distance: 95000, duration: 4800, geometry: { coordinates: [[-40.31, -20.31], [-40.81, -20.79]] } }] }) };
      };
      const sozinha = await mapa.acharLugar('Vitória', { deps: { baixar } });
      const r = await mapa.responderMapa({ pergunta: 'quanto tempo de Vitória até Iconha?', deps: { baixar }, config: {} });
      return [
        sozinha.onde === 'Espírito Santo, Brasil' || `sozinha: ${sozinha.onde}`,
        /^De \*\*Vitória\*\* até \*\*Iconha\*\* de carro: \*\*1 h 20 min\*\* \(95 km\)/.test(r?.texto || '') || r?.texto?.slice(0, 120),
      ];
    },
  },
];
