'use strict';

const tools = require('../../src/tools');
const { descrever } = require('../../src/tools/navegador');

/** Sessão falsa: o Electron não roda na bancada, mas o contrato sim. */
const sessaoFalsa = {
  paginas: [],
  async navegar(url) {
    this.paginas.push(`navegar:${url}`);
    return { url, titulo: 'Página de teste', elementos: ['[1] campo "usuário"', '[2] botão "Entrar"'], texto: 'Conteúdo.', truncado: false };
  },
  async ler() {
    return { url: 'https://exemplo.com', titulo: 'Página de teste', elementos: ['[1] campo "usuário"'], texto: 'Conteúdo.', truncado: false };
  },
  async clicar(n) {
    this.paginas.push(`clicar:${n}`);
    return { url: 'https://exemplo.com/depois', titulo: 'Depois do clique', elementos: [], texto: 'Você clicou.', truncado: false };
  },
};

module.exports = [
  {
    nome: 'navegador: a sessão injetada chega às ferramentas',
    pedido: 'Entre no site e clique em entrar',
    navegador: sessaoFalsa,
    roteiro: [
      { ferramenta: 'navegar', argumentos: { url: 'https://exemplo.com' } },
      { ferramenta: 'clicar', argumentos: { numero: 2 } },
      { ferramenta: 'responder', argumentos: { foco: 'o que aconteceu' } },
    ],
    redacao: 'A página foi aberta e o botão clicado.',
    espera: {
      ok: true,
      ferramentasChamadas: ['navegar', 'clicar'],
      // o bug real: o construtor do agente não recebia o navegador, e toda
      // ação falhava com "navegação interativa indisponível"
      erroContem: [],
      promptRedacaoContem: ['Você clicou'],
    },
  },

  {
    nome: 'navegador: ações reais exigem aprovação, leitura não',
    tipo: 'unidade',
    executar() {
      const guiado = { autonomy: 'guiado', alwaysAllow: [] };
      const acoes = ['navegar', 'clicar', 'preencher_campo', 'enviar_formulario'];
      const problemas = [];

      for (const nome of acoes) {
        const f = tools.get(nome);
        if (!f) problemas.push(`${nome} não foi registrada`);
        else if (f.risk !== 'alto') problemas.push(`${nome} está com risco ${f.risk}`);
        else if (!tools.precisaAprovacao(nome, guiado)) problemas.push(`${nome} passou sem aprovação`);
      }

      // reler a tela não muda nada no mundo: não deve interromper o usuário
      if (tools.precisaAprovacao('ver_pagina', guiado)) problemas.push('ver_pagina pede aprovação sem necessidade');

      return problemas.length ? problemas : [true];
    },
  },

  {
    nome: 'navegador: recusa com instrução quando a sessão não existe',
    tipo: 'unidade',
    async executar() {
      const ctx = { emit() {}, estado: {}, config: {} };
      const mensagens = [];
      for (const nome of ['navegar', 'clicar', 'ver_pagina']) {
        try {
          await tools.get(nome).run({ url: 'https://exemplo.com', numero: 1 }, ctx);
          mensagens.push(`${nome} não recusou sem sessão`);
        } catch (err) {
          if (!/indispon[íi]vel/.test(err.message)) mensagens.push(`${nome}: ${err.message}`);
          if (!/abrir_pagina/.test(err.message)) mensagens.push(`${nome} não sugere a alternativa mais barata`);
        }
      }
      return mensagens.length ? mensagens : [true];
    },
  },

  {
    nome: 'navegador: leitura vira lista numerada para o modelo',
    tipo: 'unidade',
    executar() {
      const texto = descrever({
        url: 'https://exemplo.com/entrar',
        titulo: 'Área do cliente',
        elementos: ['[1] campo "usuário"', '[2] campo de senha "senha"', '[3] botão "Entrar"'],
        texto: 'Informe suas credenciais para continuar.',
        truncado: false,
      });

      return [
        texto.includes('ELEMENTOS INTERAGÍVEIS') || 'não separou os elementos do conteúdo',
        texto.includes('use o número') || 'não instrui o modelo a agir por número',
        texto.includes('[3] botão "Entrar"') || 'perdeu a numeração',
        texto.includes('https://exemplo.com/entrar') || 'não informa em que página está',
      ];
    },
  },

  {
    nome: 'navegador: skill orienta a tentar leitura simples antes',
    tipo: 'unidade',
    async executar() {
      const path = require('path');
      const os = require('os');
      const { Skills } = require('../../src/skills');
      const s = new Skills({
        dirEmbutidas: path.join(__dirname, '..', '..', 'skills'),
        dirUsuario: path.join(os.tmpdir(), `augpt-nav-${Date.now()}`),
      });

      const skill = s.lista.find((k) => k.pasta === 'navegacao-interativa');
      const ativa = await s.selecionar('preciso entrar no portal e consultar meu extrato', { etapa: 'decisao' });

      return [
        Boolean(skill) || 'skill de navegação não foi carregada',
        /abrir_pagina.*primeiro|Tente .abrir_pagina. primeiro/s.test(skill.corpo) ||
          'não orienta a tentar a leitura barata antes',
        /não invente credencial|Não invente credencial/i.test(skill.corpo) || 'não proíbe inventar senha',
        ativa.some((k) => k.pasta === 'navegacao-interativa') || 'não ativou no pedido com login e portal',
      ];
    },
  },
];
