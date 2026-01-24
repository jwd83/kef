import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  search: (query) => ipcRenderer.invoke('api:search', query),
  mediaSuggest: (query, limit) => ipcRenderer.invoke('api:mediaSuggest', query, limit),
  getPosters: (imdbIds) => ipcRenderer.invoke('api:getPosters', imdbIds),
  unlock: (magnet) => ipcRenderer.invoke('api:unlock', magnet),
  getStatus: (id) => ipcRenderer.invoke('api:getStatus', id),
  // New v4.1 helpers
  getStatusV41: (params) => ipcRenderer.invoke('api:getStatusV41', params),
  getMagnetFiles: (ids) => ipcRenderer.invoke('api:getMagnetFiles', ids),
  getFiles: (link) => ipcRenderer.invoke('api:getFiles', link),
  resolve: (url) => ipcRenderer.invoke('api:resolve', url),
  play: (url, subtitleUrl) => ipcRenderer.invoke('api:play', url, subtitleUrl),
  openFolder: (filePath) => ipcRenderer.invoke('api:openFolder', filePath),
  playFile: (filePath) => ipcRenderer.invoke('api:playFile', filePath),
  download: (url, options) => ipcRenderer.invoke('api:download', url, options),
  selectFolder: () => ipcRenderer.invoke('api:selectFolder'),
  saveKey: (key) => ipcRenderer.invoke('api:saveKey', key),
  getKey: () => ipcRenderer.invoke('api:getKey'),
  // MagnetId map APIs
  getMagnetIdByHash: (hash) => ipcRenderer.invoke('api:getMagnetIdByHash', hash),
  setMagnetId: (hash, id) => ipcRenderer.invoke('api:setMagnetId', hash, id),
  // Library APIs
  getSavedSearches: () => ipcRenderer.invoke('api:getSavedSearches'),
  addSavedSearch: (query) => ipcRenderer.invoke('api:addSavedSearch', query),
  removeSavedSearch: (id) => ipcRenderer.invoke('api:removeSavedSearch', id),
  getSavedMagnets: () => ipcRenderer.invoke('api:getSavedMagnets'),
  addSavedMagnet: (magnetData) => ipcRenderer.invoke('api:addSavedMagnet', magnetData),
  removeSavedMagnet: (id) => ipcRenderer.invoke('api:removeSavedMagnet', id),
  // History APIs
  getHistory: () => ipcRenderer.invoke('api:getHistory'),
  recordPlay: (magnetHash, magnetTitle, filename, streamUrl) =>
    ipcRenderer.invoke('api:recordPlay', magnetHash, magnetTitle, filename, streamUrl),
  removeHistoryEntry: (id) => ipcRenderer.invoke('api:removeHistoryEntry', id),
  removeAllHistory: () => ipcRenderer.invoke('api:removeAllHistory'),
  resetFileWatched: (historyId, filename) =>
    ipcRenderer.invoke('api:resetFileWatched', historyId, filename),
  // Download History APIs
  getDownloadHistory: () => ipcRenderer.invoke('api:getDownloadHistory'),
  removeFromDownloadHistory: (id) => ipcRenderer.invoke('api:removeFromDownloadHistory', id),
  clearDownloadHistory: () => ipcRenderer.invoke('api:clearDownloadHistory'),
  onDownloadProgress: (callback) => {
    const subscription = (event, data) => callback(data)
    ipcRenderer.on('download:progress', subscription)
    return () => ipcRenderer.removeListener('download:progress', subscription)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
