'use strict';

// A janela de recorte da tela (25/10): só pede a foto e devolve a área escolhida.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorte', {
  imagem: () => ipcRenderer.invoke('recorte:imagem'),
  escolher: (area) => ipcRenderer.send('recorte:escolha', area),
});
