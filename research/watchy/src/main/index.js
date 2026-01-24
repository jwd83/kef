import { app, shell, BrowserWindow, ipcMain, nativeImage, dialog } from 'electron'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import allDebrid from './services/allDebrid'
import scraper from './services/scraper'
import vlc from './services/vlc'
import library from './services/library'
import mediaCatalog from './services/mediaCatalog'
import posters from './services/posters'

const downloadTargets = new Map()
const downloadMetadata = new Map() // url -> { magnetTitle }

// Download queue manager
class DownloadQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent
    this.activeDownloads = new Set()
    this.queue = []
    this.mainWindow = null
  }

  setMainWindow(window) {
    this.mainWindow = window
  }

  add(url, options, sender) {
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0] || 'unknown')
    const magnetTitle = options.magnetTitle || null
    this.queue.push({ url, options, sender, filename, magnetTitle })

    // Notify renderer about queued download
    if (this.mainWindow) {
      this.mainWindow.webContents.send('download:progress', {
        filename,
        magnetTitle,
        state: 'queued',
        queuePosition: this.queue.length
      })
    }

    this.processQueue()
  }

  processQueue() {
    while (this.activeDownloads.size < this.maxConcurrent && this.queue.length > 0) {
      const { url, options, sender, magnetTitle } = this.queue.shift()
      this.startDownload(url, options, sender, magnetTitle)
    }
  }

  startDownload(url, options, sender, magnetTitle) {
    this.activeDownloads.add(url)
    if (options.directory) {
      downloadTargets.set(url, options.directory)
    }
    if (magnetTitle) {
      downloadMetadata.set(url, { magnetTitle })
    }
    sender.downloadURL(url)
  }

  onDownloadComplete(url) {
    this.activeDownloads.delete(url)
    downloadMetadata.delete(url)
    this.processQueue()
  }
}

const downloadQueue = new DownloadQueue(3)

function createWindow() {
  // Icon path - dev uses build folder, prod uses extraResources.
  // Windows prefers .ico; Linux prefers .png.
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = is.dev
    ? path.join(__dirname, `../../build/${iconFile}`)
    : path.join(process.resourcesPath, iconFile)

  // Create native image from icon
  const appIcon = nativeImage.createFromPath(iconPath)

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.setTitle(`Watchy v${app.getVersion()}`)

    // Force set icon for Windows taskbar
    if (process.platform === 'win32') {
      mainWindow.setIcon(appIcon)
      mainWindow.setAppDetails({
        appId: 'com.watchy.app',
        // appIconPath: iconPath,
        appIconIndex: 0,
        relaunchDisplayName: 'Watchy'
      })
    }
    mainWindow.show()
  })

  // Set the main window reference for download queue
  downloadQueue.setMainWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Track downloads
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const url = item.getURL()
    const metadata = downloadMetadata.get(url) || {}
    const magnetTitle = metadata.magnetTitle || null

    if (downloadTargets.has(url)) {
      const directory = downloadTargets.get(url)
      const filename = item.getFilename()
      item.setSavePath(path.join(directory, filename))
      // cleanup
      downloadTargets.delete(url)
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed')
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused')
        } else {
          // Send progress to renderer
          mainWindow.webContents.send('download:progress', {
            filename: decodeURIComponent(item.getFilename()),
            magnetTitle,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            savePath: item.getSavePath(),
            state: 'progressing'
          })
        }
      }
    })

    item.once('done', (event, state) => {
      const itemUrl = item.getURL()
      const downloadData = {
        filename: decodeURIComponent(item.getFilename()),
        magnetTitle,
        savePath: item.getSavePath(),
        state: state === 'completed' ? 'completed' : 'failed',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      }

      if (state === 'completed') {
        console.log('Download successfully')
      } else {
        console.log(`Download failed: ${state}`)
      }

      // Add to download history (only if magnetTitle is present)
      if (magnetTitle) {
        library.addToDownloadHistory(downloadData)
      }

      mainWindow.webContents.send('download:progress', downloadData)
      // Notify queue that download is complete so next can start
      downloadQueue.onDownloadComplete(itemUrl)
    })
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.watchy.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // API Handlers
  ipcMain.handle('api:search', async (_, query) => {
    const results = await scraper.search(query)

    // Enrich results with catalog metadata for any that have imdb IDs
    const imdbIds = [...new Set(results.map((r) => r.imdb).filter(Boolean))]
    if (imdbIds.length > 0) {
      const catalogMap = mediaCatalog.lookupByImdbIds(imdbIds)
      for (const result of results) {
        if (result.imdb && catalogMap.has(result.imdb)) {
          result.catalogTitle = catalogMap.get(result.imdb).title
        }
      }
    }

    return results
  })

  ipcMain.handle('api:mediaSuggest', (_, query, limit) => {
    return mediaCatalog.suggest(query, limit)
  })

  ipcMain.handle('api:getPosters', (_, imdbIds) => {
    return posters.getPostersByImdbIds(imdbIds)
  })

  ipcMain.handle('api:unlock', async (_, magnet) => {
    return await allDebrid.uploadMagnet(magnet)
  })

  ipcMain.handle('api:getStatus', async (_, id) => {
    return await allDebrid.getStatus(id)
  })

  // v4.1: get magnet status (by id or filter)
  ipcMain.handle('api:getStatusV41', async (_, params) => {
    return await allDebrid.getStatusV41(params)
  })

  // v4: get files for one or more magnet IDs
  ipcMain.handle('api:getMagnetFiles', async (_, ids) => {
    return await allDebrid.getFiles(ids)
  })

  ipcMain.handle('api:getFiles', async (_, link) => {
    // Note: 'unlockLink' in service returns the unlocked link info which contains files for host links
    return await allDebrid.unlockLink(link)
  })

  // Resolve AllDebrid hoster links to a direct URL.
  // If the link is already direct/playable, we fall back to the original.
  ipcMain.handle('api:resolve', async (_, url) => {
    let resolvedUrl = url

    try {
      if (typeof url === 'string' && url.startsWith('http')) {
        const unlock = await allDebrid.unlockLink(url)
        if (unlock?.status === 'success' && unlock?.data?.link) {
          resolvedUrl = unlock.data.link
        }
      }
    } catch {
      // ignore unlock failures; fall back to original url
    }

    return resolvedUrl
  })

  // Resolve AllDebrid hoster links to a direct playable URL before launching VLC.
  // If the link is already playable, we fall back to the original.
  // Optionally accepts a subtitle URL to pass to VLC.
  ipcMain.handle('api:play', async (_, url, subtitleUrl = null) => {
    let playableUrl = url
    let playableSubtitleUrl = subtitleUrl

    try {
      if (typeof url === 'string' && url.startsWith('http')) {
        const unlock = await allDebrid.unlockLink(url)
        if (unlock?.status === 'success' && unlock?.data?.link) {
          playableUrl = unlock.data.link
        }
      }
    } catch {
      // ignore unlock failures; we'll try to play the original url
    }

    // Resolve subtitle URL if provided
    if (subtitleUrl) {
      try {
        if (typeof subtitleUrl === 'string' && subtitleUrl.startsWith('http')) {
          const unlock = await allDebrid.unlockLink(subtitleUrl)
          if (unlock?.status === 'success' && unlock?.data?.link) {
            playableSubtitleUrl = unlock.data.link
          }
        }
      } catch {
        // ignore unlock failures; we'll try to use the original subtitle url
      }
    }

    vlc.play(playableUrl, playableSubtitleUrl)
    return playableUrl
  })

  // Open containing folder in file explorer
  ipcMain.handle('api:openFolder', (_, filePath) => {
    shell.showItemInFolder(filePath)
  })

  // Play local file in VLC
  ipcMain.handle('api:playFile', (_, filePath) => {
    vlc.play(filePath)
  })

  ipcMain.handle('api:download', (event, url, options = {}) => {
    downloadQueue.add(url, options, event.sender)
  })

  ipcMain.handle('api:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('api:saveKey', async (_, key) => {
    await allDebrid.setApiKey(key)
    return true
  })

  ipcMain.handle('api:getKey', () => {
    return allDebrid.apiKey
  })

  // MagnetId map helpers
  ipcMain.handle('api:getMagnetIdByHash', (_, hash) => {
    return library.getMagnetIdByHash(hash)
  })

  ipcMain.handle('api:setMagnetId', (_, hash, id) => {
    return library.setMagnetId(hash, id)
  })

  // Library handlers
  ipcMain.handle('api:getSavedSearches', () => {
    return library.getSavedSearches()
  })

  ipcMain.handle('api:addSavedSearch', (_, query) => {
    return library.addSavedSearch(query)
  })

  ipcMain.handle('api:removeSavedSearch', (_, id) => {
    return library.removeSavedSearch(id)
  })

  ipcMain.handle('api:getSavedMagnets', () => {
    return library.getSavedMagnets()
  })

  ipcMain.handle('api:addSavedMagnet', (_, magnetData) => {
    return library.addSavedMagnet(magnetData)
  })

  ipcMain.handle('api:removeSavedMagnet', (_, id) => {
    return library.removeSavedMagnet(id)
  })

  // History handlers
  ipcMain.handle('api:getHistory', () => {
    return library.getHistory()
  })

  ipcMain.handle('api:recordPlay', (_, magnetHash, magnetTitle, filename, streamUrl) => {
    return library.recordPlay(magnetHash, magnetTitle, filename, streamUrl)
  })

  ipcMain.handle('api:removeHistoryEntry', (_, id) => {
    return library.removeHistoryEntry(id)
  })

  ipcMain.handle('api:removeAllHistory', () => {
    return library.removeAllHistory()
  })

  ipcMain.handle('api:resetFileWatched', (_, historyId, filename) => {
    return library.resetFileWatched(historyId, filename)
  })

  // Download History handlers
  ipcMain.handle('api:getDownloadHistory', () => {
    return library.getDownloadHistory()
  })

  ipcMain.handle('api:removeFromDownloadHistory', (_, id) => {
    return library.removeFromDownloadHistory(id)
  })

  ipcMain.handle('api:clearDownloadHistory', () => {
    return library.clearDownloadHistory()
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
