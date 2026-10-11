'use strict';

/**
 * Rotina automática: agendamentos que disparam sozinhos, sem o usuário
 * precisar mandar a mensagem toda vez. Só funciona com o app aberto — não há
 * ícone de bandeja nem início automático com o sistema, então nada dispara
 * com a janela fechada. Cada agendamento guarda o TEXTO do pedido, exatamente
 * como se o usuário tivesse digitado — ao disparar, ele passa pelo mesmo
 * `agent.run()` de sempre, então rotinas (skill + workflow.json) continuam
 * funcionando normalmente quando o texto casa com um gatilho.
 *
 * Formato de um agendamento:
 *   {
 *     id: string,
 *     texto: string,                    // o "pedido" enviado ao agente
 *     tipo: 'intervalo' | 'horario',
 *     minutos: number,                  // tipo 'intervalo': a cada quantos minutos
 *     horario: 'HH:MM',                 // tipo 'horario': horário fixo diário (hora local)
 *     ativo: boolean,
 *     ultimaExecucao: number | null,    // timestamp ms da última vez que disparou
 *   }
 *
 * Tudo aqui é puro (sem Electron, sem I/O) para ser testável na bancada e
 * reutilizável fora do main process se um dia precisar.
 */

function mesmoDiaLocal(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Este agendamento deveria disparar agora? */
function deveDisparar(agendamento, agoraMs = Date.now()) {
  if (!agendamento || agendamento.ativo === false) return false;
  const ultima = agendamento.ultimaExecucao || 0;

  if (agendamento.tipo === 'intervalo') {
    const minutos = Number(agendamento.minutos) || 0;
    if (minutos <= 0) return false;
    return agoraMs - ultima >= minutos * 60000;
  }

  if (agendamento.tipo === 'horario') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(agendamento.horario || ''));
    if (!m) return false;
    const hora = Number(m[1]);
    const minuto = Number(m[2]);
    if (hora > 23 || minuto > 59) return false;

    const agora = new Date(agoraMs);
    const alvoHoje = new Date(agoraMs);
    alvoHoje.setHours(hora, minuto, 0, 0);

    if (agora < alvoHoje) return false; // ainda não chegou a hora hoje
    // já passou da hora hoje: só dispara se a última execução não foi hoje —
    // evita disparar de novo a cada checagem (a cada minuto) depois da primeira
    return !ultima || !mesmoDiaLocal(ultima, agoraMs);
  }

  return false;
}

/** Filtra, de uma lista de agendamentos, os que deveriam disparar agora. */
function agendamentosParaDisparar(lista, agoraMs = Date.now()) {
  return (lista || []).filter((a) => deveDisparar(a, agoraMs));
}

/** Cria um novo agendamento a partir do que a UI mandou, com defaults sãos. */
function criarAgendamento(dados = {}) {
  const tipo = dados.tipo === 'horario' ? 'horario' : 'intervalo';
  const horarioValido = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(dados.horario || ''));
  return {
    id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    texto: String(dados.texto || '').trim(),
    tipo,
    minutos: Math.max(1, Math.round(Number(dados.minutos)) || 60),
    horario: horarioValido ? dados.horario : '09:00',
    ativo: true,
    ultimaExecucao: null,
  };
}

module.exports = { deveDisparar, agendamentosParaDisparar, criarAgendamento };
