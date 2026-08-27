import { contextBridge } from 'electron'

// A1 阶段空壳：后续 C2 按 IPC 契约补全 window.hub 全部通道
contextBridge.exposeInMainWorld('hub', {})
