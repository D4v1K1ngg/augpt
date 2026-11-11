# Estúdio de voz do AuGPT (11/11): um processo por motor (Qwen3-TTS ou OmniVoice), conversando por JSON,
# uma linha por mensagem, no stdin/stdout. O AuGPT (src/estudio-de-voz/index.js) copia este arquivo para a
# pasta do estúdio e o roda com o Python do ambiente do motor. Só gera áudio: não abre porta, não lê a rede
# (os modelos vêm do Hugging Face na primeira vez, para a pasta hf do estúdio).
#
# Pedidos:  {"id": 1, "tipo": "info"}
#           {"id": 2, "tipo": "gerar", "partes": ["texto 1", "texto 2"], "saida": "C:/.../parte", ...opções}
#           {"id": 3, "tipo": "descarregar"}
# Respostas: {"id": 2, "ok": true, ...} · progresso: {"id": 2, "progresso": "...", "parte": 1, "de": 3}
import json, os, sys, time, traceback

MOTOR = sys.argv[1]  # 'qwen' ou 'omni'
_saida = sys.stdout
sys.stdout = sys.stderr  # o que as bibliotecas imprimem não pode se misturar com o protocolo


def enviar(msg):
    _saida.write(json.dumps(msg, ensure_ascii=False) + '\n')
    _saida.flush()


import torch  # noqa: E402
import soundfile as sf  # noqa: E402

CARREGADO = {'nome': None, 'modelo': None}


def carregar(nome, pedido):
    if CARREGADO['nome'] == nome:
        return CARREGADO['modelo']
    descarregar()
    enviar({'id': pedido, 'progresso': f'Carregando {nome} (a 1ª vez baixa o modelo)…'})
    t = time.time()
    if MOTOR == 'qwen':
        from qwen_tts import Qwen3TTSModel
        m = Qwen3TTSModel.from_pretrained(nome, device_map='cuda:0' if torch.cuda.is_available() else 'cpu', dtype=torch.bfloat16)
    else:
        from omnivoice import OmniVoice
        m = OmniVoice.from_pretrained(nome, device_map='cuda:0' if torch.cuda.is_available() else 'cpu', dtype=torch.float16)
    CARREGADO.update(nome=nome, modelo=m)
    enviar({'id': pedido, 'progresso': f'{nome} carregado em {time.time() - t:.0f} s'})
    return m


def descarregar():
    if CARREGADO['modelo'] is not None:
        CARREGADO.update(nome=None, modelo=None)
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def num(o, chave, tipo=float):
    v = o.get(chave)
    return None if v is None or v == '' else tipo(v)


def gerar_qwen(o, pedido, texto):
    modo = o.get('modo', 'pronta')  # pronta | descrita | clonar
    tam = '0.6B' if o.get('tamanho') == '0.6B' and modo != 'descrita' else '1.7B'  # a voz descrita só existe no 1.7B
    nome = {'pronta': f'Qwen/Qwen3-TTS-12Hz-{tam}-CustomVoice', 'descrita': 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'clonar': f'Qwen/Qwen3-TTS-12Hz-{tam}-Base'}[modo]
    m = carregar(nome, pedido)
    extra = {k: v for k, v in {
        'do_sample': o.get('amostrar'), 'temperature': num(o, 'temperatura'), 'top_p': num(o, 'topP'), 'top_k': num(o, 'topK', int),
        'repetition_penalty': num(o, 'penalidadeDeRepeticao'), 'max_new_tokens': num(o, 'maxTokens', int) or None,
        'subtalker_temperature': num(o, 'temperaturaDoDetalhe'), 'subtalker_top_p': num(o, 'topPDoDetalhe'), 'subtalker_top_k': num(o, 'topKDoDetalhe', int),
    }.items() if v is not None}
    idioma = o.get('idioma') or 'auto'
    # 11/11: sem teto, o Qwen às vezes não para (top-p 0,8 gerou 13 min de áudio para 30 s de texto). ~12 tokens por
    # segundo de fala e ~14 letras por segundo: 2 tokens por letra + 200 sobra com folga para a fala mais lenta
    extra.setdefault('max_new_tokens', min(8192, 200 + 2 * len(texto)))
    if modo == 'pronta':
        instr = (o.get('instrucao') or '').strip() or None
        wavs, sr = m.generate_custom_voice(text=texto, language=idioma, speaker=o.get('voz') or 'ryan', instruct=instr if tam == '1.7B' else None, **extra)
    elif modo == 'descrita':
        wavs, sr = m.generate_voice_design(text=texto, language=idioma, instruct=o.get('instrucao') or '', **extra)
    else:
        ref = o.get('referencia') or {}
        so_timbre = bool(o.get('soTimbre')) or not (ref.get('texto') or '').strip()
        wavs, sr = m.generate_voice_clone(text=texto, language=idioma, ref_audio=ref.get('audio'), ref_text=None if so_timbre else ref.get('texto'), x_vector_only_mode=so_timbre, non_streaming_mode=True, **extra)  # o padrão da clonagem (False) simula texto chegando aos pedaços
    return wavs[0], sr


def gerar_omni(o, pedido, texto):
    m = carregar('k2-fsa/OmniVoice', pedido)
    modo = o.get('modo', 'descrita')  # automatica | descrita | clonar
    cfg = {k: v for k, v in {
        'num_step': num(o, 'passos', int), 'guidance_scale': num(o, 'guia'), 't_shift': num(o, 'deslocamento'),
        'position_temperature': num(o, 'temperaturaDePosicao'), 'class_temperature': num(o, 'temperatura'),
        'layer_penalty_factor': num(o, 'penalidadeDeCamada'), 'denoise': o.get('limparRuido'),
        'postprocess_output': o.get('posProcessar'), 'pad_duration': num(o, 'margem'), 'fade_duration': num(o, 'suavizar'),
    }.items() if v is not None}
    args = {'text': texto, 'language': o.get('idioma') or None, 'speed': num(o, 'velocidadeDoModelo'), **cfg}
    if o.get('duracao'):
        args['duration'] = num(o, 'duracao')
    if modo == 'descrita' and (o.get('instrucao') or '').strip():
        args['instruct'] = o['instrucao'].strip()
    if modo == 'clonar':
        ref = o.get('referencia') or {}
        args['ref_audio'] = ref.get('audio')
        if (ref.get('texto') or '').strip():
            args['ref_text'] = ref['texto']
    audio = m.generate(**args)
    a = audio[0]
    return (a.squeeze().float().cpu().numpy() if hasattr(a, 'cpu') else a), getattr(m, 'sampling_rate', 24000)


def gerar(o, pedido):
    partes = [p for p in o.get('partes') or [] if str(p).strip()]
    if not partes:
        raise ValueError('texto vazio')
    if o.get('semente') not in (None, ''):
        torch.manual_seed(int(o['semente']))
    feitos = []
    t0 = time.time()
    for i, texto in enumerate(partes, 1):
        enviar({'id': pedido, 'progresso': f'Gerando a parte {i} de {len(partes)}…', 'parte': i, 'de': len(partes)})
        a, sr = (gerar_qwen if MOTOR == 'qwen' else gerar_omni)(o, pedido, texto)
        arq = f"{o['saida']}-{i:03d}.wav"
        sf.write(arq, a, sr, subtype='PCM_16')  # o AuGPT encurta as pausas lendo este formato
        feitos.append({'arquivo': arq, 'segundos': len(a) / sr})
    return {'partes': feitos, 'taxa': sr, 'tempo': time.time() - t0}


def info():
    r = {'motor': MOTOR, 'cuda': torch.cuda.is_available(), 'placa': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}
    if MOTOR == 'omni':
        from omnivoice.utils.voice_design import _INSTRUCT_VALID_EN
        r['descricao'] = sorted(_INSTRUCT_VALID_EN)
    return r


enviar({'pronto': True, 'motor': MOTOR})
for linha in sys.stdin:
    try:
        o = json.loads(linha)
    except ValueError:
        continue
    pedido = o.get('id')
    try:
        tipo = o.get('tipo')
        if tipo == 'info':
            enviar({'id': pedido, 'ok': True, **info()})
        elif tipo == 'gerar':
            enviar({'id': pedido, 'ok': True, **gerar(o, pedido)})
        elif tipo == 'descarregar':
            descarregar()
            enviar({'id': pedido, 'ok': True})
        else:
            enviar({'id': pedido, 'ok': False, 'erro': f'pedido desconhecido: {tipo}'})
    except Exception as e:  # noqa: BLE001 — o erro volta para a tela, o processo continua
        traceback.print_exc()
        enviar({'id': pedido, 'ok': False, 'erro': str(e)[:400]})
