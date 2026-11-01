# A voz natural do AuGPT (Qwen3-TTS 0.6B CustomVoice, Apache 2.0) — o processo que fala (1/11, pedido do Davi).
#
# O AuGPT (src/fala/voz-qwen.js) inicia este arquivo com o Python do componente e conversa por linhas de JSON:
#   entrada:  {"id": 1, "texto": "Bom dia.", "voz": "ryan"}
#   saída:    {"pronto": true, "vozes": [...], "taxa": 24000}            (uma vez, ao terminar de carregar)
#             {"id": 1, "taxa": 24000, "pcm": "<float32 little-endian em base64>"} ou {"id": 1, "erro": "..."}
#
# A aceleração (medida numa RTX 3060 Ti: 0,55x -> 1,4x o tempo real, mesmo resultado): o "preditor de códigos"
# chamava um generate() do Hugging Face a cada pedaço de áudio (~200 chamadas pequenas por segundo de fala). Aqui
# o passo dele é escrito com cache de tamanho fixo e gravado em CUDA graphs — a placa repete sem o Python no meio.
import base64
import json
import os
import sys
import types

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # o modelo já está na pasta; nada de consultar o site
PROTOCOLO = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
sys.stdout = sys.stderr  # avisos das bibliotecas (SoX, pad_token_id…) não sujam o protocolo

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from qwen_tts import Qwen3TTSModel  # noqa: E402
from qwen_tts.core.models.modeling_qwen3_tts import apply_rotary_pos_emb  # noqa: E402


def responder(obj):
    PROTOCOLO.write(json.dumps(obj) + "\n")
    PROTOCOLO.flush()


class PreditorEmGrafo:
    """O passo do preditor com cache fixo; uma etapa (de 15) = um CUDA graph."""

    def __init__(self, pred, etapas=15):
        self.p = pred
        m = pred.model
        cfg = pred.config
        par = next(pred.parameters())
        dev, dt = par.device, par.dtype
        self.hd = cfg.head_dim
        self.etapas = etapas
        maximo = etapas + 2
        self.K = [torch.zeros(1, cfg.num_key_value_heads, maximo, self.hd, device=dev, dtype=dt) for _ in m.layers]
        self.V = [torch.zeros_like(k) for k in self.K]
        self.pos = {p: torch.arange(p, p + n, device=dev).unsqueeze(0) for p, n in [(0, 2)] + [(s + 1, 1) for s in range(1, etapas)]}
        entrada = getattr(pred.small_to_mtp_projection, "in_features", cfg.hidden_size)
        self.pre_in = torch.zeros(1, 2, entrada, device=dev, dtype=dt)
        self.tok = torch.zeros(1, 1, device=dev, dtype=torch.long)
        self.saidas = {}
        self.grafos = {}

    def camadas(self, x, p0, n):
        m = self.p.model
        cos, sin = m.rotary_emb(x, self.pos[p0])
        for i, camada in enumerate(m.layers):
            a = camada.self_attn
            h = camada.input_layernorm(x)
            q = a.q_norm(a.q_proj(h).view(1, n, -1, self.hd)).transpose(1, 2)
            k = a.k_norm(a.k_proj(h).view(1, n, -1, self.hd)).transpose(1, 2)
            v = a.v_proj(h).view(1, n, -1, self.hd).transpose(1, 2)
            q, k = apply_rotary_pos_emb(q, k, cos, sin)
            self.K[i][:, :, p0:p0 + n] = k
            self.V[i][:, :, p0:p0 + n] = v
            o = F.scaled_dot_product_attention(q, self.K[i][:, :, : p0 + n], self.V[i][:, :, : p0 + n], is_causal=n > 1, enable_gqa=True, scale=a.scaling)
            x = x + a.o_proj(o.transpose(1, 2).reshape(1, n, -1))
            x = x + camada.mlp(camada.post_attention_layernorm(x))
        return m.norm(x)

    def etapa(self, s):
        if s == 0:
            h = self.camadas(self.p.small_to_mtp_projection(self.pre_in), 0, 2)
        else:
            emb = self.p.model.get_input_embeddings()[s - 1](self.tok)
            h = self.camadas(self.p.small_to_mtp_projection(emb), s + 1, 1)
        return self.p.lm_head[s](h[:, -1])

    @torch.no_grad()
    def gravar(self):
        lado = torch.cuda.Stream()
        lado.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(lado):
            for _ in range(3):
                for s in range(self.etapas):
                    self.etapa(s)
        torch.cuda.current_stream().wait_stream(lado)
        pool = None
        for s in range(self.etapas):
            g = torch.cuda.CUDAGraph()
            with torch.cuda.graph(g, pool=pool):
                self.saidas[s] = self.etapa(s)
            pool = g.pool()
            self.grafos[s] = g


def sortear(logits, do_sample, top_k, temperature):
    if not do_sample:
        return logits.argmax(-1, keepdim=True)
    logits = logits.float() / max(temperature or 1.0, 1e-5)
    if top_k:
        corte = torch.topk(logits, top_k, dim=-1).values[..., -1, None]
        logits = logits.masked_fill(logits < corte, float("-inf"))
    return torch.multinomial(logits.softmax(-1), 1)


def acelerar(tts):
    pred = tts.model.talker.code_predictor
    g = PreditorEmGrafo(pred)
    g.gravar()

    def gerar(self, inputs_embeds=None, max_new_tokens=15, do_sample=True, top_p=1.0, top_k=50, temperature=0.9, **_):
        g.pre_in.copy_(inputs_embeds)
        g.grafos[0].replay()
        logits = g.saidas[0]
        seq = []
        for s in range(1, max_new_tokens + 1):
            tok = sortear(logits, do_sample, top_k, temperature)
            seq.append(tok)
            if s == max_new_tokens:
                break
            g.tok.copy_(tok)
            g.grafos[s].replay()
            logits = g.saidas[s]
        return types.SimpleNamespace(sequences=torch.cat(seq, dim=1))

    pred.generate = types.MethodType(gerar, pred)


def main():
    pasta = sys.argv[1]
    tts = Qwen3TTSModel.from_pretrained(pasta, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    acelerar(tts)
    vozes = [v.lower() for v in tts.get_supported_speakers()]
    _, taxa = tts.generate_custom_voice(text="Oi.", language="Portuguese", speaker=vozes[0])  # aquece
    responder({"pronto": True, "vozes": vozes, "taxa": taxa})
    for linha in sys.stdin:
        try:
            pedido = json.loads(linha)
        except ValueError:
            continue
        ident = pedido.get("id")
        try:
            voz = str(pedido.get("voz") or "ryan").lower()
            if voz not in vozes:
                voz = vozes[0]
            texto = str(pedido.get("texto") or "").strip()[:600]
            if not texto:
                responder({"id": ident, "taxa": taxa, "pcm": ""})
                continue
            wavs, taxa = tts.generate_custom_voice(text=texto, language="Portuguese", speaker=voz)
            audio = np.asarray(wavs[0], dtype=np.float32)
            responder({"id": ident, "taxa": int(taxa), "pcm": base64.b64encode(audio.tobytes()).decode("ascii")})
        except Exception as erro:  # uma frase que falhou não derruba a voz
            responder({"id": ident, "erro": str(erro)[:300]})


if __name__ == "__main__":
    main()
