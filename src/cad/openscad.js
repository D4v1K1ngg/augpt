'use strict';

/**
 * OpenSCAD (27/11, Ajustes → Componentes): transforma o código de CAD que o modelo escreve em peça para impressão 3D
 * (STL e 3MF) e em fotos para o modelo conferir. Versão FIXA (2026.11-RC0: a 1ª com o motor Manifold — a estável é de
 * 2021 e leva minutos no que esta faz em 0,1 s), conferida pelo SHA-256 publicado pelo GitHub.
 *
 * A biblioteca do AuGPT (augpt.scad: gancho, suportes, engrenagem, caixa com tampa…) vai para a pasta do componente a
 * cada uso — o programa de fora não lê arquivos de dentro do pacote do app.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { baixarConferindo } = require('../gerador-de-imagens');

const VERSAO = '2026.11-RC0';
const PACOTE = {
  nome: `OpenSCAD-${VERSAO}-x86-64.zip`,
  url: `https://github.com/openscad/openscad/releases/download/openscad-${VERSAO}/OpenSCAD-${VERSAO}-x86-64.zip`,
  bytes: 70621809,
  sha256: 'bc43fe44712bd063b7d8065fc6ca051daf7271f03379f25bdb0f5bbfeed56f63',
};
const BIBLIOTECA = path.join(__dirname, 'augpt.scad');

function rodar(exe, args, { env, timeoutMs = 120000 } = {}) {
  return new Promise((ok) => execFile(exe, args, { timeout: timeoutMs, windowsHide: true, env, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => ok({ err, saida: `${so || ''}\n${se || ''}` })));
}

/** Medidas da peça (caixa envolvente) lidas do STL, ASCII ou binário: { tam: [x, y, z], min: [x, y, z] } ou null. */
function caixaDoStl(arquivo) {
  const b = fs.readFileSync(arquivo);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  const ponto = (p) => {
    for (let k = 0; k < 3; k += 1) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  };
  if (b.slice(0, 5).toString() === 'solid' && b.includes('facet')) {
    for (const m of b.toString().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) ponto([+m[1], +m[2], +m[3]]);
  } else if (b.length >= 84) {
    const n = b.readUInt32LE(80);
    for (let i = 0; i < n && 84 + i * 50 + 50 <= b.length; i += 1) for (let v = 0; v < 3; v += 1) {
      const o = 84 + i * 50 + 12 + v * 12;
      ponto([b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]);
    }
  }
  if (!Number.isFinite(min[0])) return null;
  const r = (x) => Math.round(x * 100) / 100;
  return { tam: max.map((m, k) => r(m - min[k])), min: min.map(r) };
}

/** As linhas de erro do OpenSCAD que o modelo precisa ver ('' = nada de grave). */
function errosDaSaida(saida) {
  return String(saida)
    .split('\n')
    .filter((l) => /^(ERROR|WARNING)/.test(l.trim()) && !/Viewall|camera|font/i.test(l))
    .slice(0, 6)
    .join('\n');
}

class OpenScad {
  constructor(dir, { buscar = (...a) => fetch(...a), plataforma = process.platform, extrairZip, executar = rodar } = {}) {
    this.dir = dir;
    this.bin = path.join(dir, 'bin');
    this.lib = path.join(dir, 'lib');
    this.buscar = buscar;
    this.plataforma = plataforma;
    this.extrairZip = extrairZip || ((buffer, destino) => require('../searxng-runtime').extrairZipPara(buffer, destino, { descartarRaizComum: true }));
    this.executar = executar;
  }

  get exe() {
    return path.join(this.bin, this.plataforma === 'win32' ? 'openscad.com' : 'openscad');
  }

  instalado() {
    return fs.existsSync(this.exe);
  }

  estado() {
    return { instalado: this.instalado(), suportado: this.plataforma === 'win32', versao: VERSAO, tamanhoMB: Math.round(PACOTE.bytes / 1e6), pasta: this.dir };
  }

  async instalar({ emitir = () => {} } = {}) {
    if (this.plataforma !== 'win32') throw new Error('por enquanto o OpenSCAD é instalado só no Windows (no Linux/Mac: instale pelo gerenciador de pacotes)');
    fs.mkdirSync(this.dir, { recursive: true });
    const zip = path.join(this.dir, PACOTE.nome);
    await baixarConferindo(PACOTE.url, zip, { sha256: PACOTE.sha256, buscar: this.buscar, emitir, rotulo: 'o OpenSCAD', total: PACOTE.bytes });
    emitir({ texto: 'Extraindo…' });
    const novo = `${this.bin}.novo`;
    fs.rmSync(novo, { recursive: true, force: true });
    this.extrairZip(fs.readFileSync(zip), novo);
    fs.rmSync(zip, { force: true });
    if (!fs.existsSync(path.join(novo, path.basename(this.exe)))) throw new Error('o pacote baixado não tem o openscad');
    fs.rmSync(this.bin, { recursive: true, force: true });
    fs.renameSync(novo, this.bin);
    emitir({ texto: 'Testando…' });
    const teste = await this.compilar({ codigo: 'include <augpt.scad>\nplaca_com_furos(20, 10, 2, 3);', pasta: path.join(this.dir, 'teste'), nome: 'teste', fotos: false });
    if (!teste.ok) throw new Error(`o OpenSCAD não gerou a peça de teste: ${teste.erro}`);
    emitir({ texto: 'Pronto.' });
    return this.estado();
  }

  remover() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    return this.estado();
  }

  _prepararBiblioteca() {
    fs.mkdirSync(this.lib, { recursive: true });
    const destino = path.join(this.lib, 'augpt.scad');
    const conteudo = fs.readFileSync(BIBLIOTECA, 'utf8');
    if (!fs.existsSync(destino) || fs.readFileSync(destino, 'utf8') !== conteudo) fs.writeFileSync(destino, conteudo);
  }

  /**
   * Gera a peça: <nome>.scad, .stl, .3mf e as fotos (<nome>-iso.png de cima e <nome>-baixo.png de baixo).
   * Devolve { ok, erro, avisos, stl, tresmf, fotos, caixa }.
   */
  async compilar({ codigo, pasta, nome = 'peca', fotos = true }) {
    if (!this.instalado()) return { ok: false, erro: 'o OpenSCAD não está instalado' };
    this._prepararBiblioteca();
    fs.mkdirSync(pasta, { recursive: true });
    const scad = path.join(pasta, `${nome}.scad`);
    fs.writeFileSync(scad, codigo);
    const env = { ...process.env, OPENSCADPATH: this.lib };
    const stl = path.join(pasta, `${nome}.stl`);
    fs.rmSync(stl, { force: true });
    const r = await this.executar(this.exe, ['-o', stl, '--backend=manifold', scad], { env });
    const erro = errosDaSaida(r.saida);
    if (!fs.existsSync(stl) || fs.statSync(stl).size < 200 || /^ERROR/m.test(erro)) return { ok: false, erro: erro || String(r.saida).trim().split('\n').slice(-4).join('\n') || 'a peça saiu vazia' };
    const tresmf = path.join(pasta, `${nome}.3mf`);
    await this.executar(this.exe, ['-o', tresmf, '--backend=manifold', scad], { env });
    const imagens = [];
    if (fotos) {
      for (const [sufixo, camera] of [['iso', null], ['baixo', '0,0,0,235,0,35,0']]) {
        const png = path.join(pasta, `${nome}-${sufixo}.png`);
        await this.executar(this.exe, ['-o', png, '--render', '--imgsize=800,600', '--viewall', '--autocenter', '--colorscheme=Tomorrow', ...(camera ? [`--camera=${camera}`] : []), scad], { env });
        if (fs.existsSync(png)) imagens.push(png);
      }
    }
    return { ok: true, avisos: erro, scad, stl, tresmf: fs.existsSync(tresmf) ? tresmf : null, fotos: imagens, caixa: caixaDoStl(stl) };
  }
}

const instancias = new Map();
function openscadDe(userDataPath) {
  if (!userDataPath) return null;
  const dir = path.join(userDataPath, 'componentes', 'openscad');
  if (!instancias.has(dir)) instancias.set(dir, new OpenScad(dir));
  return instancias.get(dir);
}

module.exports = { OpenScad, openscadDe, caixaDoStl, errosDaSaida, PACOTE, VERSAO, BIBLIOTECA };
