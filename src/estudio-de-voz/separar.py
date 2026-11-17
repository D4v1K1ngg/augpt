"""
Separa a voz do fundo (música, ambiente) de um WAV — 17/11, para a dublagem do AuGPT tirar a voz original.

Uso: python separar.py <entrada.wav> <voz.wav> <fundo.wav>
A entrada vem do ffmpeg em 44,1 kHz estéreo (o que o htdemucs espera). Roda na placa (CUDA) quando há.
Lê e grava com o soundfile: o torchaudio 2.9+ trocou o leitor de áudio e o "python -m demucs" quebra nele.
O progresso sai no stderr como "PROGRESSO n" (0 a 100), que o AuGPT lê.
"""
import sys

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def main():
    entrada, saida_voz, saida_fundo = sys.argv[1:4]
    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    modelo = get_model("htdemucs")
    modelo.eval()
    modelo.to(dispositivo)
    audio, taxa = sf.read(entrada, dtype="float32", always_2d=True)  # (amostras, canais)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    x = torch.from_numpy(audio.T.copy()).unsqueeze(0)  # (1, canais, amostras)
    referencia = x.mean(1)
    media, desvio = referencia.mean(), referencia.std() + 1e-8
    x = (x - media) / desvio
    print("PROGRESSO 5", file=sys.stderr, flush=True)
    with torch.no_grad():
        fontes = apply_model(modelo, x.to(dispositivo), split=True, overlap=0.25, progress=True, device=dispositivo)[0]
    fontes = fontes * desvio + media
    voz = fontes[modelo.sources.index("vocals")]
    fundo = fontes.sum(0) - voz
    print("PROGRESSO 95", file=sys.stderr, flush=True)
    sf.write(saida_voz, voz.cpu().numpy().T, taxa, subtype="PCM_16")
    sf.write(saida_fundo, fundo.cpu().numpy().T, taxa, subtype="PCM_16")
    print("PROGRESSO 100", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
