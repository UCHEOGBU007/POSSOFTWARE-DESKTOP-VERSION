/* eslint-disable @typescript-eslint/no-explicit-any */
import { contextBridge, ipcRenderer } from "electron";

// Create a safe API object to expose to the renderer process
const electronAPI = {
  printing: {
    getPrinters: () => ipcRenderer.invoke("printing:get-printers"),
    print: (printerName?: string) =>
      ipcRenderer.invoke("printing:print-page", printerName),
    sendNetworkReceipt: (host: string, port: number, data: Uint8Array) =>
      ipcRenderer.invoke("printing:send-network-receipt", host, port, data),
  },
};

contextBridge.exposeInMainWorld("electron", electronAPI);
