'use strict';

/**
 * Régua das peças 3D (27/11/2026): os 15 pedidos de pedidos.json pelo caminho de verdade (src/agent/nucleo/peca-3d.js,
 * a biblioteca src/cad/augpt.scad e o OpenSCAD do componente). Mede se gera, as medidas (caixa envolvente, quando o
 * pedido tem) e guarda a foto de cada peça numa folha só (folha.png) — o formato certo se confere olhando.
 *
 * Uso (na pasta do AuGPT, com o Ollama ligado e o OpenSCAD instalado em Ajustes → Componentes):
 *   node avaliacao/pecas-3d/medir.js                       # com o modelo do config (ou MODELO=gemma4:26b-a4b-it-qat)
 *   SO=gancho,engrenagem node avaliacao/pecas-3d/medir.js  # só alguns
 *
 * 27/11, olhando as peças (sem a biblioteca → com ela): Qwen 3.5 9B 2–3 → ~5 (3 nem geraram); Gemma 4 26B ~9 → ~11
 * (erra ainda: gancho às vezes em L, presilha sem o anel em C, a aba da tampa).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { criarPeca3d } = require('../../src/agent/nucleo/peca-3d');
const { openscadDe } = require('../../src/cad/openscad');

const dados = process.env.AUGPT_DADOS || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'AuGPT');
const config = JSON.parse(fs.readFileSync(path.join(dados, 'config.json'), 'utf8'));
const host = config.host || 'http://127.0.0.1:11434';
const modelo = process.env.MODELO || config.model;
const pedidos = require('./pedidos.json').filter((p) => !process.env.SO || process.env.SO.split(',').includes(p.id));
const saida = path.join(os.tmpdir(), 'augpt-pecas-3d', modelo.replace(/[:/]/g, '_'));
const openscad = openscadDe(dados);
if (!openscad?.instalado()) {
  console.log('o OpenSCAD não está instalado: Ajustes → Componentes → Peças 3D');
  process.exit(1);
}

async function chamar(messages, { numPredict = 3000 } = {}) {
  const r = await fetch(`${host}/api/chat`, { method: 'POST', body: JSON.stringify({ model: modelo, stream: false, think: false, options: { temperature: 0.2, num_ctx: 16384, num_predict: numPredict }, messages }) }).then((x) => x.json());
  return { content: r.message?.content || '' };
}

const confere = (esperado, tam) => {
  if (!esperado || !tam) return null;
  const a = [...esperado].sort((x, y) => x - y);
  const b = [...tam].sort((x, y) => x - y);
  return a.every((v, i) => Math.abs(v - b[i]) <= Math.max(1, v * 0.03));
};

(async () => {
  fs.rmSync(saida, { recursive: true, force: true });
  const caps = await fetch(`${host}/api/show`, { method: 'POST', body: JSON.stringify({ model: modelo }) }).then((x) => x.json()).then((j) => j.capabilities || []).catch(() => []);
  const fotos = [];
  for (const p of pedidos) {
    const pasta = path.join(saida, p.id);
    let n = 0;
    const deps = {
      chamar,
      modeloDaPeca: modelo,
      semVisao: caps.length && !caps.includes('vision') ? 'sem visão' : undefined,
      compilarPeca: async ({ codigo }) => {
        n += 1;
        const r = await openscad.compilar({ codigo, pasta, nome: `v${n}` });
        return r.ok ? { ...r, fotosBase64: r.fotos.map((f) => fs.readFileSync(f).toString('base64')) } : r;
      },
      guardarPeca: async ({ compilado, nome }) => ({ nome, foto: compilado.fotos[0], stl: 'x.stl', caminhos: { stl: compilado.stl, scad: compilado.scad } }),
    };
    const t = Date.now();
    const r = await criarPeca3d({ pergunta: p.pedido, deps }).catch((e) => ({ erro: e.message }));
    const caixa = r.pecaCriada?.caixa?.tam;
    if (r.pecaCriada) fotos.push([p.id, deps && path.join(pasta, `v${n}-iso.png`)]);
    console.log(`${p.id.padEnd(16)} ${r.pecaCriada ? `gerou ${caixa?.join(' x ')} mm, medidas ${confere(p.caixa, caixa)}, ${r.pecaCriada.correcoes} correção(ões)` : `NÃO GEROU ${(r.erro || r.texto || '').split('\n')[0].slice(0, 100)}`} · ${Math.round((Date.now() - t) / 1000)} s`);
  }
  // a folha com as fotos (Windows: System.Drawing)
  if (process.platform === 'win32' && fotos.length) {
    const lista = path.join(saida, 'fotos.txt');
    fs.writeFileSync(lista, fotos.map(([id, f]) => `${id}|${f}`).join('\n'));
    const ps = `Add-Type -AssemblyName System.Drawing; $l = Get-Content '${lista}'; $w=320;$h=240;$c=5;$r=[math]::Ceiling($l.Count/$c); $b=New-Object System.Drawing.Bitmap ($w*$c),($h*$r); $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White); $f=New-Object System.Drawing.Font 'Segoe UI',11,([System.Drawing.FontStyle]::Bold); for($i=0;$i -lt $l.Count;$i++){ $p=$l[$i].Split('|'); $x=($i%$c)*$w; $y=[math]::Floor($i/$c)*$h; if(Test-Path $p[1]){ $im=[System.Drawing.Image]::FromFile($p[1]); $g.DrawImage($im,$x,$y,$w,$h); $im.Dispose() }; $g.DrawString($p[0],$f,[System.Drawing.Brushes]::Black,$x+4,$y+4) }; $b.Save('${path.join(saida, 'folha.png')}')`;
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', ps]);
      console.log(`\nfolha com as peças: ${path.join(saida, 'folha.png')}`);
    } catch {
      /* sem a folha: as fotos ficam nas pastas */
    }
  }
})();
