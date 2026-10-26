'use strict';

/**
 * Pesquisa pela comunidade — Fase A (2026-09-26, estratégia pedida pelo Davi):
 * fontes da comunidade com consultas "site:", idioma por busca (o Reddit em
 * inglês sumia com pt-BR fixo), leitor de tópico (Reddit JSON, fórum
 * XenForo/Invision) e limite por domínio que não trata 3 tópicos do mesmo
 * fórum como "uma fonte só".
 *
 * Os HTML de fórum abaixo seguem a estrutura real dos dois motores:
 * Invision (Clube do Hardware) põe cada post em <div data-role="commentContent">;
 * XenForo (Fórum Adrenaline, Head-Fi) em <div class="bbWrapper">.
 */

const c = require('../../src/tools/comunidade');
const web = require('../../src/tools/web');
const { buscaFalsa, pagina } = require('../fixtures/busca-falsa');
const { ler, reiniciarPlacarReddit } = require('../../src/tools/extract');

const pesquisarELer = web.find((t) => t.name === 'pesquisar_e_ler');

const INVISION = (titulo, pergunta, respostas) =>
  `<html><head><title>${titulo} - Fones de ouvido - Clube do Hardware</title></head><body>
  <nav><a>Início</a> <a>Fóruns</a></nav>
  <article><div class="ipsComment_content">
    <div data-role="commentContent" class="ipsType_normal ipsType_richText ipsPadding_bottom ipsContained" data-controller="core.front.core.lightboxedImages"><p>${pergunta}</p></div>
  </div></article>
  ${respostas
    .map(
      (r) => `<article><div data-role="commentContent" class="ipsType_normal ipsType_richText">
      <blockquote class="ipsQuote" data-ipsquote=""><div class="ipsQuote_citation">fulano disse:</div><div class="ipsQuote_contents"><p>${pergunta}</p></div></blockquote>
      <p>${r}</p></div><div class="ipsSignature"><div>assinatura: PC i5 / RTX</div></div></article>`
    )
    .join('\n')}
  <footer>Clube do Hardware © 2026</footer></body></html>`;

const XENFORO = (titulo, pergunta, respostas) =>
  `<html><head><meta property="og:title" content="${titulo}"></head><body>
  <article class="message message--post"><div class="message-userContent"><article class="message-body">
    <div class="bbWrapper">${pergunta}</div>
  </article></div></article>
  ${respostas
    .map(
      (r) => `<article class="message message--post"><div class="message-userContent"><article class="message-body">
    <div class="bbWrapper"><blockquote class="bbCodeBlock bbCodeBlock--expandable bbCodeBlock--quote"><div class="bbCodeBlock-content"><div class="bbCodeBlock-expandContent">${pergunta}</div></div></blockquote>${r}<br />abraço</div>
  </article></div></article>`
    )
    .join('\n')}</body></html>`;

module.exports = [
  {
    nome: 'comunidade: consultas "site:" por fonte, com idioma certo e fonte de nicho só no assunto dela',
    tipo: 'unidade',
    executar() {
      const fones = c.consultasNaComunidade('fone intra auricular pubg');
      const cadeira = c.consultasNaComunidade('cadeira gamer');
      const doUsuario = c.consultasNaComunidade('monitor até 1000', {
        config: { fontesComunidade: ['https://www.clubedohardware.com.br/forums/topic/1683615-qual-melhor-monitor/', 'forum.meusite.com.br'] },
      });
      const acha = (lista, fonte) => lista.find((q) => q.fonte === fonte);
      return [
        acha(fones, 'Reddit')?.consulta === 'site:reddit.com fone intra auricular pubg' || `Reddit: ${JSON.stringify(acha(fones, 'Reddit'))}`,
        acha(fones, 'Reddit')?.idioma === 'all' || 'Reddit é em inglês: a busca não pode filtrar pt-BR',
        acha(fones, 'Clube do Hardware')?.idioma === 'pt-BR' || 'Clube do Hardware é em português',
        Boolean(acha(fones, 'Head-Fi')) || 'Head-Fi deveria entrar em pedido de fone',
        !acha(cadeira, 'Head-Fi') || 'Head-Fi (áudio) não deveria entrar em pedido de cadeira',
        !fones.some((q) => /youtube/.test(q.consulta)) || 'vídeo fica pra Fase E, não vira consulta de texto',
        JSON.stringify(doUsuario.map((q) => q.consulta)) ===
          JSON.stringify(['site:clubedohardware.com.br monitor até 1000', 'site:forum.meusite.com.br monitor até 1000']) ||
          `lista do usuário (endereço completo vira domínio): ${JSON.stringify(doUsuario)}`,
      ];
    },
  },

  {
    nome: 'comunidade: tópico do Reddit vira título, post e comentários mais votados (apagado fica de fora)',
    tipo: 'unidade',
    executar() {
      const coment = (body, score, replies = []) => ({ kind: 't1', data: { body, score, replies: replies.length ? { data: { children: replies } } : '' } });
      const dados = [
        { data: { children: [{ data: { title: 'Best IEM for PUBG footsteps?', subreddit: 'iems', selftext: 'Budget around $50.' } }] } },
        {
          data: {
            children: [
              coment('Truthear Zero: Red, great imaging for the price.', 12, [coment('Agreed, footsteps are clear.', 30, [coment('nível 2 conta', 5, [coment('nível 3 não entra', 99)])])]),
              coment('[deleted]', 50),
              coment('KZ EDX Pro is fine but the bass is too much.', 3),
              { kind: 'more', data: {} },
            ],
          },
        },
      ];
      const t = c.topicoDoReddit(dados);
      const linhas = t?.texto.split('\n') || [];
      return [
        t?.via === 'topico-reddit' || 'via errada',
        /^TÓPICO DO REDDIT \(r\/iems\): Best IEM for PUBG footsteps\?/.test(linhas[0] || '') || `título: ${linhas[0]}`,
        /POST: Budget around \$50\./.test(t?.texto || '') || 'faltou o post',
        linhas[3] === '- [30 votos] Agreed, footsteps are clear.' || `o mais votado deveria vir primeiro: ${linhas[3]}`,
        !/\[deleted\]/.test(t?.texto || '') || 'comentário apagado entrou',
        !/nível 3/.test(t?.texto || '') && /nível 2 conta/.test(t?.texto || '') || 'profundidade de resposta errada (até o 2º nível)',
        t?.comentarios === 4 || `esperava 4 comentários, vieram ${t?.comentarios}`,
        c.urlJsonDoReddit('https://www.redditmedia.com/r/HyperX/comments/1gzbg7z/cloud_ii_audio_is_terrible_in_games/') ===
          'https://www.reddit.com/r/HyperX/comments/1gzbg7z/cloud_ii_audio_is_terrible_in_games.json?limit=200&sort=top&raw_json=1' ||
          'o espelho redditmedia.com (visto no 9º teste real) deveria virar o JSON do reddit.com',
        c.urlJsonDoReddit('https://www.reddit.com/r/iems/') === null || 'página de subreddit (sem /comments/) não é tópico',
      ];
    },
  },

  {
    nome: 'comunidade: tópico de fórum Invision (Clube do Hardware) e XenForo (Adrenaline) vira pergunta + respostas, sem citação nem assinatura',
    tipo: 'unidade',
    executar() {
      const inv = c.topicoDeForum(
        INVISION('Qual melhor monitor até R$ 1000', 'Qual o melhor monitor até mil reais para jogar?', ['Recomendo o LG 24GS60F, 180 Hz IPS.', 'AOC 24G2SP também é bom.'])
      );
      const xen = c.topicoDeForum(XENFORO('Fone para CS2 e PUBG', 'Qual fone intra para jogos?', ['Vai de Truthear Zero Red.']));
      const artigo = c.topicoDeForum(pagina('Um artigo comum, sem posts de fórum.'));
      return [
        inv?.via === 'topico-invision' || `Invision não reconhecido: ${JSON.stringify(inv)?.slice(0, 200)}`,
        /^TÓPICO DE FÓRUM: Qual melhor monitor até R\$ 1000/.test(inv?.texto || '') || `título: ${inv?.texto?.split('\n')[0]}`,
        /PERGUNTA: Qual o melhor monitor até mil reais para jogar\?/.test(inv?.texto || '') || 'faltou a pergunta',
        /- Recomendo o LG 24GS60F, 180 Hz IPS\./.test(inv?.texto || '') && /- AOC 24G2SP também é bom\./.test(inv?.texto || '') || 'faltou resposta',
        (inv?.texto.match(/mil reais para jogar/g) || []).length === 1 || 'a citação da pergunta repetiu dentro das respostas',
        !/assinatura|Início|©/.test(inv?.texto || '') || 'assinatura, menu ou rodapé entraram',
        inv?.comentarios === 2 || `esperava 2 respostas, vieram ${inv?.comentarios}`,
        xen?.via === 'topico-xenforo' || 'XenForo não reconhecido',
        /^TÓPICO DE FÓRUM: Fone para CS2 e PUBG/.test(xen?.texto || '') && /- Vai de Truthear Zero Red\. abraço/.test(xen?.texto || '') || `XenForo: ${xen?.texto}`,
        (xen?.texto.match(/Qual fone intra/g) || []).length === 1 || 'citação repetida no XenForo',
        artigo === null || 'página sem posts de fórum não é tópico',
      ];
    },
  },

  {
    nome: 'comunidade (ponta a ponta): busca "site:" num fórum da lista lê vários tópicos do mesmo domínio, sem filtro de idioma e sem dividir a consulta',
    tipo: 'unidade',
    async executar() {
      const topicos = ['A', 'B', 'C'].map((t, i) => INVISION(`Tópico ${t}`, `Pergunta ${i + 1}: qual fone para PUBG?`, [`Resposta ${t}: uso o KZ EDX Pro.`]));
      const srv = await buscaFalsa([
        { contem: 'site:', mesmoHost: true, paginas: topicos },
        { contem: 'portal', mesmoHost: true, paginas: [pagina('Matéria 1 do portal.'), pagina('Matéria 2 do portal.'), pagina('Matéria 3 do portal.')] },
      ]);
      if (!srv) return [];
      try {
        const [forum, portal] = srv.hosts;
        const ctx = () => ({
          config: { searxngUrl: `http://127.0.0.1:${srv.porta}`, permitirRedeLocal: true, fontesComunidade: [forum], profundidadePesquisa: 'normal' },
          estado: {},
          emit() {},
          render: null,
          operacional: null,
        });
        const saida = await pesquisarELer.run({ consulta: 'site:forum.exemplo fone pubg e microfone', idioma: 'all' }, ctx());
        const comum = await pesquisarELer.run({ consulta: 'portal fones', idioma: 'pt-BR' }, ctx());
        return [
          ['Tópico A', 'Tópico B', 'Tópico C'].every((t) => saida.includes(`TÓPICO DE FÓRUM: ${t}`)) ||
            `3 tópicos do mesmo fórum deveriam ser lidos: ${saida.slice(0, 600)}`,
          srv.pedidos[0]?.idioma === 'all' || `idioma da busca: ${JSON.stringify(srv.pedidos[0])}`,
          srv.pedidos.filter((p) => p.q.startsWith('site:')).length === 1 || 'a consulta "site:" foi dividida em subconsultas',
          (comum.match(/--- FONTE \d+:/g) || []).length === 1 || `site comum (${portal}) continua com 1 página por busca`,
          srv.pedidos[1]?.idioma === 'pt-BR' || 'busca comum continua em pt-BR',
        ];
      } finally {
        await srv.fechar();
      }
    },
  },
  {
    nome: 'comunidade: Reddit recusando o JSON — página nova renderizada (shreddit) com comentários por voto; JSON no navegador como última saída (11º teste real)',
    tipo: 'unidade',
    async executar() {
      reiniciarPlacarReddit();
      const url = 'https://www.reddit.com/r/iems/comments/1qlhks6/best_iems_for_competetive_pubg/?tl=pt-br';
      const NOVO = `<html><head><title>Reddit - The heart of the internet</title></head><body>
        <shreddit-post post-title="Best IEMs for competitive PUBG" subreddit-prefixed-name="r/iems" score="120">
          <div slot="text-body"><div class="md text-14" id="t3_1qlhks6-post-rtjson-content"><p>Footsteps matter &amp; budget is $50.</p></div></div>
        </shreddit-post>
        <shreddit-comment-tree>
          <shreddit-comment thingid="t1_aaa" depth="0" score="12"><div slot="comment"><div class="md" id="t1_aaa-comment-rtjson-content"><p>KZ EDX Pro is fine for the price.</p></div></div>
            <shreddit-comment thingid="t1_bbb" depth="1" score="87"><div slot="comment"><div class="md" id="t1_bbb-comment-rtjson-content"><p>Truthear Zero: Red, <b>great</b> imaging.</p><blockquote><p>citado</p></blockquote></div></div></shreddit-comment>
          </shreddit-comment>
          <shreddit-comment thingid="t1_ccc" depth="0" score="5"><div slot="comment"><div class="md" id="t1_ccc-comment-rtjson-content"><p>[deleted]</p></div></div></shreddit-comment>
        </shreddit-comment-tree></body></html>`;
      const json = JSON.stringify([
        { data: { children: [{ data: { title: 'Best IEMs for competitive PUBG', subreddit: 'iems', selftext: 'Footsteps matter.' } }] } },
        { data: { children: [{ kind: 't1', data: { body: 'Truthear Zero: Red & 7Hz Zero 2 <3', score: 40, replies: '' } }] } },
      ]);
      // nenhuma rede de verdade: JSON e old.reddit "recusam" (conferir barra), o navegador é falso
      const conferir = async (u) => {
        if (/\.json|old\.reddit/.test(u)) throw new Error('HTTP 403');
      };
      const novo = await ler(url, { conferir, permitirExterno: false, render: async (u) => (/\.json/.test(u) ? '' : NOVO) });
      reiniciarPlacarReddit();
      const pedidos = [];
      const viaJson = await ler(url, {
        conferir,
        permitirExterno: false,
        render: async (u) => {
          pedidos.push(u);
          return /\.json/.test(u)
            ? `<html><body><pre style="word-wrap: break-word;">${json.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`
            : '<html><body><div>Reddit</div></body></html>';
        },
      });
      const linhas = novo.texto.split('\n');
      return [
        novo.via === 'topico-reddit-novo+render-js' || `via: ${novo.via} / ${JSON.stringify(novo.tentativas)}`,
        linhas[0] === 'TÓPICO DO REDDIT (r/iems): Best IEMs for competitive PUBG' || `título: ${linhas[0]}`,
        /POST: Footsteps matter & budget is \$50\./.test(novo.texto) || `post: ${novo.texto}`,
        linhas[3] === '- [87 votos] Truthear Zero: Red, great imaging.' || `o mais votado primeiro (resposta aninhada conta): ${linhas[3]}`,
        !/\[deleted\]|citado/.test(novo.texto) || 'apagado ou citação entrou',
        novo.comentarios === 2 || `esperava 2 comentários, vieram ${novo.comentarios}`,
        (novo.tentativas || []).some((t) => /^reddit json: .*403/.test(t)) || `a recusa do JSON direto deveria ficar registrada: ${JSON.stringify(novo.tentativas)}`,
        viaJson.via === 'topico-reddit+render-js' || `JSON no navegador como última saída: ${viaJson.via}`,
        /- \[40 votos\] Truthear Zero: Red & 7Hz Zero 2 <3/.test(viaJson.texto) || `JSON do <pre> mal decodificado: ${viaJson.texto}`,
        pedidos.some((u) => /\.json\?limit=200/.test(u)) || `o navegador deveria abrir o JSON: ${pedidos}`,
      ];
    },
  },

  {
    nome: 'comunidade: estratégia do Reddit que falhou 3 vezes na sessão é pulada (cada render custa segundos)',
    tipo: 'unidade',
    async executar() {
      reiniciarPlacarReddit();
      const conferir = async (u) => {
        if (/\.json|old\.reddit/.test(u)) throw new Error('HTTP 403');
      };
      const renders = [];
      const opcoes = { conferir, permitirExterno: false, render: async (u) => { renders.push(u); return '<html><body><p>nada</p></body></html>'; } };
      for (let i = 0; i < 3; i += 1) {
        await ler(`https://www.reddit.com/r/iems/comments/abc${i}/t/`, opcoes).catch(() => null);
      }
      const antes = renders.filter((u) => /\.json/.test(u)).length;
      const quarta = await ler('https://www.reddit.com/r/iems/comments/abc9/t/', opcoes).catch((e) => ({ tentativas: [e.message] }));
      const depois = renders.filter((u) => /\.json/.test(u)).length;
      reiniciarPlacarReddit();
      return [
        antes === 3 || `as 3 primeiras deveriam tentar o JSON no navegador: ${antes}`,
        depois === antes || 'na 4ª, o JSON no navegador (3 falhas) deveria ser pulado',
        !JSON.stringify(quarta.tentativas || '').includes('reddit json:') || `na 4ª, o JSON direto (3 falhas) deveria ser pulado: ${JSON.stringify(quarta.tentativas)}`,
      ];
    },
  },

  {
    nome: 'comunidade: old.reddit — post da página (não da barra lateral), comentários sem apagado nem citação',
    tipo: 'unidade',
    executar() {
      const ANTIGO = `<html><body><div class="side"><div class="md"><p>Regras do sub</p></div></div>
        <div id="siteTable" class="sitetable linklisting"><a class="title may-blank" href="/r/iems/comments/1qlhks6/x/">Best IEMs for competitive PUBG</a>
        <div class="usertext-body"><div class="md"><p>Footsteps matter.</p></div></div></div>
        <div class="commentarea"><div class="thing comment"><div class="usertext-body"><div class="md"><p>Moondrop Chu II, <b>very</b> good imaging.</p></div></div></div>
        <div class="thing comment"><div class="usertext-body"><div class="md"><p>[deleted]</p></div></div></div>
        <div class="thing comment"><div class="usertext-body"><div class="md"><p>Salnotes Zero.</p><blockquote><p>citado</p></blockquote></div></div></div></div></body></html>`;
      const t = c.topicoDoRedditAntigo(ANTIGO);
      return [
        /^TÓPICO DO REDDIT \(r\/iems\): Best IEMs for competitive PUBG/.test(t?.texto || '') || `título: ${t?.texto}`,
        /POST: Footsteps matter\./.test(t?.texto || '') && !/Regras do sub/.test(t?.texto || '') || 'post errado',
        /- Moondrop Chu II, very good imaging\./.test(t?.texto || '') && /- Salnotes Zero\./.test(t?.texto || '') || `comentários: ${t?.texto}`,
        !/\[deleted\]|citado/.test(t?.texto || '') || 'apagado ou citação entrou',
        c.urlAntigaDoReddit('https://www.reddit.com/r/iems/comments/1qlhks6/best_iems_for_competetive_pubg/?tl=pt-br') ===
          'https://old.reddit.com/r/iems/comments/1qlhks6/best_iems_for_competetive_pubg/?sort=top&limit=200' || 'url do old.reddit',
      ];
    },
  },

  {
    nome: 'comunidade: site marcado "render-js" na memória ainda passa pelo leitor de tópico de fórum (Clube do Hardware, 10º teste real)',
    tipo: 'unidade',
    async executar() {
      const html = INVISION('Intra-auricular barato e bom pra jogos', 'Qual intra barato pra jogar?', ['Uso o QKZ AK6, recomendo.']);
      const p = await ler('https://www.clubedohardware.com.br/forums/topic/1649117-intra-auricular-barato-e-bom-pra-jogos/', {
        estrategia: 'render-js',
        permitirExterno: false,
        render: async () => html,
      });
      return [
        p.via === 'topico-invision+render-js' || `via: ${p.via}`,
        /- Uso o QKZ AK6, recomendo\./.test(p.texto) || `texto: ${p.texto}`,
      ];
    },
  },
  {
    nome: 'comunidade: tópico lido na pesquisa planejada vai cru, sem destilação (o destilador devolvia "nada relevante" num tópico certo — 11º teste real)',
    tipo: 'unidade',
    async executar() {
      const { Agent } = require('../../src/agent/loop');
      const agente = new Agent({ config: { profundidadePesquisa: 'alta', destilarComModelo: true }, userDataPath: require('os').tmpdir() });
      let chamou = 0;
      agente._destilarUm = async () => {
        chamou += 1;
        return { texto: '(nada)', fatos: 0, destilado: true };
      };
      const topico = 'TÓPICO DE FÓRUM: Fones intra para FPS\nPERGUNTA: qual intra?\nRESPOSTAS (1, na ordem do tópico):\n- vai de kz edx pro';
      const [e] = await agente._destilarGrande({ objetivo: 'fones pubg', foco: 'descobrir opções', origem: 'o', texto: topico, url: 'https://www.clubedohardware.com.br/forums/topic/1-x/' });
      const [artigo] = await agente._destilarGrande({ objetivo: 'fones pubg', foco: 'descobrir opções', origem: 'o', texto: 'Artigo comum sobre fones.', url: 'https://techtudo.com.br/a' });
      const [semFoco] = await agente._destilarGrande({ objetivo: 'fones pubg', origem: 'o', texto: topico, url: 'https://www.clubedohardware.com.br/forums/topic/1-x/' });
      return [
        e?.cru === true && /vai de kz edx pro/.test(e.texto) || `tópico deveria ir cru: ${JSON.stringify(e)}`,
        chamou === 2 || `artigo comum e caminho normal (sem foco) continuam destilando: ${chamou} chamadas`,
        Boolean(artigo) && Boolean(semFoco) || 'entradas',
      ];
    },
  },
];
