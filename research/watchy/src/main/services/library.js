import Store from 'electron-store'

const store = new Store()

class LibraryService {
  // Saved Searches
  getSavedSearches() {
    return store.get('savedSearches', [])
  }

  // Magnet ID cache (hash -> id)
  getMagnetIdByHash(hash) {
    const map = store.get('magnetIdMap', {})
    return map[hash] || null
  }

  setMagnetId(hash, id) {
    const map = store.get('magnetIdMap', {})
    map[hash] = id
    store.set('magnetIdMap', map)
    return { success: true }
  }

  addSavedSearch(searchQuery) {
    const searches = this.getSavedSearches()
    const existing = searches.find((s) => s.query === searchQuery)
    if (existing) {
      return { success: false, message: 'Search already saved' }
    }
    searches.unshift({
      id: Date.now().toString(),
      query: searchQuery,
      savedAt: new Date().toISOString()
    })
    store.set('savedSearches', searches)
    return { success: true, message: 'Search saved' }
  }

  removeSavedSearch(id) {
    const searches = this.getSavedSearches()
    const filtered = searches.filter((s) => s.id !== id)
    store.set('savedSearches', filtered)
    return { success: true, message: 'Search removed' }
  }

  // Saved Magnets (Library Items)
  getSavedMagnets() {
    return store.get('savedMagnets', [])
  }

  addSavedMagnet(magnetData) {
    const magnets = this.getSavedMagnets()
    const existing = magnets.find((m) => m.magnet === magnetData.magnet)
    if (existing) {
      return { success: false, message: 'Already in library' }
    }

    const now = new Date().toISOString()

    magnets.unshift({
      id: Date.now().toString(),
      // Magnet/display name as originally returned from search/API.
      title: magnetData.title,
      magnet: magnetData.magnet,
      size: magnetData.size,
      seeds: magnetData.seeds,
      leeches: magnetData.leeches,
      savedAt: now,
      // Optional media catalog metadata, if provided.
      imdbId: magnetData.imdbId || null,
      canonicalTitle: magnetData.canonicalTitle || null
    })

    store.set('savedMagnets', magnets)
    return { success: true, message: 'Added to library' }
  }

  removeSavedMagnet(id) {
    const magnets = this.getSavedMagnets()
    const filtered = magnets.filter((m) => m.id !== id)
    store.set('savedMagnets', filtered)
    return { success: true, message: 'Removed from library' }
  }

  // History Management
  getHistory() {
    return store.get('history', [])
  }

  recordPlay(magnetHash, magnetTitle, filename, streamUrl) {
    const history = this.getHistory()
    const now = new Date().toISOString()

    // Find existing history entry for this magnet
    let historyEntry = history.find((h) => h.magnetHash === magnetHash)

    if (historyEntry) {
      // Find existing file entry
      const fileEntry = historyEntry.files.find((f) => f.filename === filename)

      if (fileEntry) {
        // Update existing file entry
        fileEntry.playCount += 1
        fileEntry.playedAt = now
      } else {
        // Add new file entry
        historyEntry.files.push({
          filename,
          streamUrl,
          playedAt: now,
          playCount: 1
        })
      }

      historyEntry.lastPlayedAt = now
    } else {
      // Create new history entry
      historyEntry = {
        id: Date.now().toString(),
        magnetHash,
        magnetTitle,
        files: [
          {
            filename,
            streamUrl,
            playedAt: now,
            playCount: 1
          }
        ],
        firstPlayedAt: now,
        lastPlayedAt: now
      }
      history.unshift(historyEntry)
    }

    // Sort history by last played (most recent first)
    history.sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))

    store.set('history', history)
    return { success: true }
  }

  removeHistoryEntry(id) {
    const history = this.getHistory()
    const filtered = history.filter((h) => h.id !== id)
    store.set('history', filtered)
    return { success: true, message: 'History entry removed' }
  }

  removeAllHistory() {
    store.set('history', [])
    return { success: true, message: 'All history cleared' }
  }

  resetFileWatched(historyId, filename) {
    const history = this.getHistory()
    const historyEntry = history.find((h) => h.id === historyId)

    if (historyEntry) {
      historyEntry.files = historyEntry.files.filter((f) => f.filename !== filename)

      // If no files left, remove the entire history entry
      if (historyEntry.files.length === 0) {
        const filtered = history.filter((h) => h.id !== historyId)
        store.set('history', filtered)
        return { success: true, message: 'History entry removed' }
      } else {
        store.set('history', history)
        return { success: true, message: 'File watch status reset' }
      }
    }

    return { success: false, message: 'History entry not found' }
  }

  // Download History Management
  getDownloadHistory() {
    const history = store.get('downloadHistory', [])
    // Filter out old-style entries that don't have magnetTitle
    const filtered = history.filter((h) => h.magnetTitle)
    if (filtered.length !== history.length) {
      store.set('downloadHistory', filtered)
    }
    return filtered
  }

  addToDownloadHistory(downloadData) {
    const history = this.getDownloadHistory()
    const historyEntry = {
      id: Date.now().toString(),
      filename: downloadData.filename,
      magnetTitle: downloadData.magnetTitle || null,
      state: downloadData.state,
      savePath: downloadData.savePath || null,
      receivedBytes: downloadData.receivedBytes || 0,
      totalBytes: downloadData.totalBytes || 0,
      completedAt: new Date().toISOString(),
      originalState: downloadData.state // Store the original state (completed/failed)
    }

    // Skip entries without magnetTitle (old-style)
    if (!historyEntry.magnetTitle) {
      return { success: false, message: 'Missing magnetTitle' }
    }

    history.unshift(historyEntry)
    store.set('downloadHistory', history)
    return { success: true }
  }

  removeFromDownloadHistory(id) {
    const history = this.getDownloadHistory()
    const filtered = history.filter((h) => h.id !== id)
    store.set('downloadHistory', filtered)
    return { success: true, message: 'Download removed from history' }
  }

  clearDownloadHistory() {
    store.set('downloadHistory', [])
    return { success: true, message: 'Download history cleared' }
  }
}

export default new LibraryService()
