'use strict';

/**
 * Perfis e nomes (27/10): "procure o perfil de Fulano no Instagram", "procure pelo nome Fulano de Tal".
 * A busca é dentro de cada rede; a resposta é a lista do buscador (perfil público + link), sem dossiê.
 */

const perfis = require('../../src/agent/perfis-no-chat');
const { escolherRota } = require('../../src/agent/rotas-do-codigo');

const R = (url, titulo, resumo = '') => ({ url, titulo, resumo });

module.exports = [
  {
    nome: 'perfis: reconhece "perfil de X no Instagram", "o Instagram do X", "procure pelo nome X", "busque o perfil de @x"; "perfil de consumo", "conta de luz", "o que é o instagram?" e "vídeos no youtube" não',
    tipo: 'unidade',
    executar() {
      const v = (t, nome, redes) => {
        const p = perfis.pedidoDePerfil(t);
        return (p && p.nome === nome && (!redes || p.redes.join() === redes)) || `${t} → ${JSON.stringify(p)}`;
      };
      return [
        v('procure o perfil de Casimiro Miguel no Instagram', 'Casimiro Miguel', 'instagram'),
        v('ache o instagram do Casimiro', 'Casimiro', 'instagram'),
        v('procure pelo nome Davi Pietralonga e veja o que acha', 'Davi Pietralonga', 'instagram,facebook,x,linkedin,tiktok,youtube'),
        v('encontre o linkedin da Maria Fernanda Lima', 'Maria Fernanda Lima', 'linkedin'),
        v('procure o perfil do Neymar no X', 'Neymar', 'x'),
        v('busque o perfil de @casimiro', '@casimiro'),
        ...['qual o melhor perfil de consumo para mim?', 'procure minha conta de luz', 'o que é o instagram?', 'procure no youtube videos de RTX 5080'].map((t) => perfis.pedidoDePerfil(t) === null || `não devia: ${t}`),
        escolherRota({ objetivo: 'procure o perfil de Casimiro Miguel no Instagram' })?.rota.id === 'perfis' || 'rota',
      ];
    },
  },
  {
    nome: 'perfis: busca dentro de cada rede (sem o Ollama, que traz sites-espelho); só links da própria rede, de perfil (post não), que citam o nome; um por usuário; resposta com o link e o aviso do que é público',
    tipo: 'unidade',
    async executar() {
      const consultas = [];
      const buscar = async (q, extra = {}) => {
        consultas.push([q, (extra.pular || []).join()]);
        if (/instagram\.com/.test(q)) {
          return { resultados: [
            R('https://www.instagram.com/casimiro/', 'Casimiro Miguel (@casimiro)', '4M followers. Public figure.'),
            R('https://www.instagram.com/casimiro/?hl=pt', 'Casimiro Miguel (@casimiro)', 'repetido'),
            R('https://www.instagram.com/p/ABC123/', 'post do Casimiro Miguel', ''),
            R('https://picmany.com/casimiro', 'Casimiro Miguel — espelho', ''),
            R('https://www.instagram.com/fulano/', 'Fernanda Ezabella', 'outra pessoa'),
          ] };
        }
        if (/linkedin\.com/.test(q)) return { resultados: [R('https://ao.linkedin.com/in/casimiro-miguel-6b614121b', 'Casimiro Miguel', 'Experiência: Sapura')] };
        return { resultados: [] };
      };
      const pedido = perfis.pedidoDePerfil('procure o perfil de Casimiro Miguel no Instagram e no LinkedIn');
      const r = await perfis.responderPerfis({ pergunta: 'x', pedido, deps: { buscarPerfis: buscar } });
      return [
        consultas.every(([q, pular]) => /^site:/.test(q) && /ollama/.test(pular)) || JSON.stringify(consultas),
        (/\[@casimiro\]\(https:\/\/www\.instagram\.com\/casimiro\/\)/.test(r.texto) && (r.texto.match(/@casimiro/g) || []).length === 1) || r.texto,
        (!/picmany|\/p\/ABC123|Fernanda/.test(r.texto)) || 'espelho, post ou outra pessoa entrou',
        /linkedin\.com\/in\/casimiro-miguel/.test(r.texto) || 'LinkedIn',
        /Achei 2 perfis públicos/.test(r.texto) || r.texto.split('\n')[0],
        /Só aparece o que é público/.test(r.texto) || 'aviso',
      ];
    },
  },
  {
    nome: 'perfis: nada achado diz por quê e o que tentar (perfil privado, outra grafia, uma pista)',
    tipo: 'unidade',
    async executar() {
      const r = await perfis.responderPerfis({ pergunta: 'procure o perfil de Fulano Inexistente da Silva no Instagram', deps: { buscarPerfis: async () => ({ resultados: [] }) } });
      return [/Não achei perfis públicos de \*\*Fulano Inexistente da Silva\*\*/.test(r.texto) && /perfil privado/.test(r.texto) || r.texto];
    },
  },
];
