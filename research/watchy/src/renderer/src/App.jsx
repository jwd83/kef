import { useState, useEffect, useCallback, useRef } from 'react'
import SearchBar from './components/SearchBar'
import ResultCard from './components/ResultCard'
import FileUserInterface from './components/FileUserInterface'
import SettingsModal from './components/SettingsModal'
import Library from './components/Library'
import History from './components/History'
import Toast from './components/Toast'
import DownloadManager from './components/DownloadManager'
import StatusModal from './components/StatusModal'
import logo from './assets/logo.png'

function App() {
  const [results, setResults] = useState([])
  const [files, setFiles] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [statusModal, setStatusModal] = useState(null) // { message, type: 'loading' | 'success' | 'error' }
  const [currentQuery, setCurrentQuery] = useState('')
  const [view, setView] = useState('search') // 'search', 'library', 'history', or 'downloads'
  const [savedSearches, setSavedSearches] = useState([])
  const [savedMagnets, setSavedMagnets] = useState([])
  const [history, setHistory] = useState([])
  const [toast, setToast] = useState(null)
  const [currentMagnet, setCurrentMagnet] = useState(null) // { hash, title, magnet, size, seeds, leeches }
  const [isNavStuck, setIsNavStuck] = useState(false)
  const [activeDownloads, setActiveDownloads] = useState([])
  const [isDownloadModalDismissed, setIsDownloadModalDismissed] = useState(false)
  const [downloadHistory, setDownloadHistory] = useState([])
  const [currentMediaCatalogTitle, setCurrentMediaCatalogTitle] = useState(null)

  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    window.api.getKey().then((key) => {
      if (!key) {
        setIsSettingsOpen(true)
      }
    })
    loadLibrary()
    loadHistory()
    loadDownloadHistory()

    const removeListener = window.api.onDownloadProgress((data) => {
      setActiveDownloads((prev) => {
        const index = prev.findIndex((d) => d.filename === data.filename)
        if (index === -1) {
          // New download: re-show overlay unless the Downloads tab is active.
          if (viewRef.current !== 'downloads') {
            setIsDownloadModalDismissed(false)
          }
          return [...prev, data]
        } else {
          // Update existing
          const newDownloads = [...prev]
          newDownloads[index] = { ...newDownloads[index], ...data }
          return newDownloads
        }
      })
    })

    return () => {
      removeListener()
    }
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      setIsNavStuck(window.scrollY > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const loadLibrary = async () => {
    const searches = await window.api.getSavedSearches()
    const magnets = await window.api.getSavedMagnets()
    setSavedSearches(searches)
    setSavedMagnets(magnets)
  }

  const loadHistory = async () => {
    const historyData = await window.api.getHistory()
    setHistory(historyData)
  }

  const loadDownloadHistory = async () => {
    const historyData = await window.api.getDownloadHistory()
    setDownloadHistory(historyData)
  }

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
  }

  const clearStatusModal = useCallback(() => {
    setStatusModal(null)
  }, [])

  const handleSearch = async (query) => {
    const originalQuery = (query || '').trim()
    const imdbMatch = originalQuery.match(/tt\d{7,8}/i)
    const effectiveQuery = imdbMatch ? imdbMatch[0] : originalQuery

    // Resolve canonical media catalog title for this search when an IMDb ID is present.
    if (imdbMatch) {
      try {
        const suggestions = await window.api.mediaSuggest(effectiveQuery, 1)
        const first = Array.isArray(suggestions) && suggestions[0] ? suggestions[0] : null
        setCurrentMediaCatalogTitle(first ? first.title : null)
      } catch {
        setCurrentMediaCatalogTitle(null)
      }
    } else {
      setCurrentMediaCatalogTitle(null)
    }

    setIsLoading(true)
    setResults([])
    setFiles([])
    // Keep the full, user-visible string (e.g. "Title (Year) tt1234567") so saving/search history stays clear.
    setCurrentQuery(originalQuery)
    setView('search')
    setStatusModal({ message: 'Searching P2P networks...', type: 'loading' })
    try {
      const searchResults = await window.api.search(effectiveQuery)
      setResults(searchResults)
      if (searchResults.length === 0) {
        setStatusModal({ message: 'No results found.', type: 'error' })
      } else {
        setStatusModal(null)
      }
    } catch (error) {
      console.error(error)
      setStatusModal({ message: 'Error searching.', type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveSearch = async (query) => {
    const result = await window.api.addSavedSearch(query)
    if (result.success) {
      showToast(result.message)
      await loadLibrary()
    } else {
      showToast(result.message, 'error')
    }
  }

  const handleRemoveSearch = async (id) => {
    const result = await window.api.removeSavedSearch(id)
    showToast(result.message)
    await loadLibrary()
  }

  const handleSaveMagnet = async (result) => {
    // Attempt to associate this magnet with an IMDb ID based on the current search query.
    const imdbMatch = (currentQuery || '').match(/tt\d{7,8}/i)
    const imdbId = imdbMatch ? imdbMatch[0] : null

    const magnetData = {
      title: result.title,
      magnet: result.magnet,
      size: result.size,
      seeds: result.seeds,
      leeches: result.leeches,
      imdbId,
      canonicalTitle: currentMediaCatalogTitle || null
    }

    const response = await window.api.addSavedMagnet(magnetData)
    if (response.success) {
      showToast(response.message)
      await loadLibrary()
    } else {
      showToast(response.message, 'error')
    }
  }

  const handleRemoveMagnet = async (id) => {
    const result = await window.api.removeSavedMagnet(id)
    showToast(result.message)
    await loadLibrary()
  }

  const handleSelectResult = async (result) => {
    setIsLoading(true)
    setView('search') // Switch to search view to show files
    setStatusModal({ message: `Unlocking "${result.title}"...`, type: 'loading' })

    // Store current magnet context for history tracking and favorites
    const hash = extractMagnetHash(result.magnet)
    setCurrentMagnet({
      hash,
      title: result.title,
      magnet: result.magnet,
      size: result.size,
      seeds: result.seeds,
      leeches: result.leeches
    })

    try {
      // 1) Fast path: if we've seen this magnet before, try its saved id.
      const existingId = await window.api.getMagnetIdByHash(hash)
      if (existingId) {
        const st = await window.api.getStatusV41({ id: existingId })
        const m = st?.data?.magnets?.[0]
        if (m && m.statusCode === 4) {
          const filesRes = await window.api.getMagnetFiles([existingId])
          let unlockedFiles = flattenMagnetFilesResponse(filesRes)
          if (unlockedFiles.length === 0) {
            // Fallback: use legacy status links + unlock
            const legacy = await window.api.getStatus(existingId)
            const links = extractLinksFromLegacyStatus(legacy, existingId)
            unlockedFiles = await unlockLinksToFiles(links)
          }
          if (unlockedFiles.length > 0) {
            setFiles(unlockedFiles)
            setStatusModal({ message: 'Ready to play!', type: 'success' })
            setIsLoading(false)
            return
          }
        }
        // If not ready or files missing, fall through to upload path.
      }

      // 2) Upload path: upload magnet (API returns id + ready flag)
      const uploadResponse = await window.api.unlock(result.magnet)
      if (uploadResponse.status === 'success' && uploadResponse?.data?.magnets?.length) {
        const { id: magnetId, ready } = uploadResponse.data.magnets[0]

        // Save mapping for next time
        await window.api.setMagnetId(hash, magnetId)

        if (ready) {
          // Instantly available — fetch files directly
          const filesRes = await window.api.getMagnetFiles([magnetId])
          let unlockedFiles = flattenMagnetFilesResponse(filesRes)
          if (unlockedFiles.length === 0) {
            // Fallback: use legacy status links + unlock
            const legacy = await window.api.getStatus(magnetId)
            const links = extractLinksFromLegacyStatus(legacy, magnetId)
            unlockedFiles = await unlockLinksToFiles(links)
          }
          if (unlockedFiles.length > 0) {
            setFiles(unlockedFiles)
            setStatusModal({ message: 'Ready to play!', type: 'success' })
          } else {
            setStatusModal({ message: 'No files found for this magnet.', type: 'error' })
          }
        } else {
          setStatusModal({ message: 'Caching on AllDebrid. Try again shortly.', type: 'error' })
        }
      } else {
        setStatusModal({ message: 'Failed to upload magnet.', type: 'error' })
      }
    } catch (error) {
      console.error(error)
      setStatusModal({ message: 'Error unlocking torrent. Check API Key.', type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const extractMagnetHash = (magnetLink) => {
    // Extract hash from magnet link (magnet:?xt=urn:btih:HASH&...)
    const match = magnetLink.match(/btih:([a-zA-Z0-9]+)/)
    return match ? match[1].toLowerCase() : magnetLink
  }

  // Flatten AllDebrid magnet/files response into [{ filename, link }]
  const flattenMagnetFilesResponse = (filesRes) => {
    const out = []
    const magnetsMaybeArray = filesRes?.data?.magnets
    const magnets = Array.isArray(magnetsMaybeArray)
      ? magnetsMaybeArray
      : magnetsMaybeArray && typeof magnetsMaybeArray === 'object'
        ? Object.values(magnetsMaybeArray)
        : []

    const walk = (node, prefix = '') => {
      if (!node) return
      const name = node.n ? decodeURIComponent(node.n) : ''
      const full = name ? (prefix ? `${prefix}/${name}` : name) : prefix
      if (node.l) {
        out.push({ filename: full || 'file', link: node.l })
      }
      if (Array.isArray(node.e)) {
        for (const child of node.e) walk(child, full)
      }
    }

    for (const m of magnets) {
      if (Array.isArray(m.files)) {
        for (const root of m.files) walk(root, '')
      }
    }
    return out
  }

  // Extract hoster links from legacy v4 GET status response
  const extractLinksFromLegacyStatus = (statusRes, id) => {
    const magnets = statusRes?.data?.magnets
    const m = Array.isArray(magnets)
      ? magnets.find((x) => String(x.id) === String(id))
      : magnets && typeof magnets === 'object'
        ? magnets[String(id)]
        : null
    const links = m?.links || []
    // Links array may be [{ link, filename }, ...] or strings
    return links.map((l) => (typeof l === 'string' ? l : l.link))
  }

  // Unlock AllDebrid file links to direct URLs
  const unlockLinksToFiles = async (links) => {
    const out = []
    for (const link of links) {
      try {
        const unlock = await window.api.getFiles(link)
        if (unlock?.status === 'success' && unlock?.data?.link) {
          out.push({
            filename: decodeURIComponent(unlock.data.filename || 'file'),
            link: unlock.data.link
          })
        }
      } catch {
        // ignore individual link failures
      }
    }
    return out
  }

  const handlePlay = async (url, filename, subtitleUrl = null) => {
    // main process will attempt to resolve AllDebrid links to a direct playable URL
    const playableUrl = await window.api.play(url, subtitleUrl)

    // Record play in history if we have current magnet context
    if (currentMagnet) {
      await window.api.recordPlay(currentMagnet.hash, currentMagnet.title, filename, playableUrl)
      await loadHistory()
    }
  }

  const handleSaveSettings = async (key) => {
    await window.api.saveKey(key)
    setIsSettingsOpen(false)
  }

  const handleRemoveHistoryEntry = async (id) => {
    const result = await window.api.removeHistoryEntry(id)
    showToast(result.message)
    await loadHistory()
  }

  const handleRemoveAllHistory = async () => {
    const result = await window.api.removeAllHistory()
    showToast(result.message)
    await loadHistory()
  }

  const handleResetFileWatched = async (historyId, filename) => {
    const result = await window.api.resetFileWatched(historyId, filename)
    showToast(result.message)
    await loadHistory()
  }

  const handleRemoveFromDownloadHistory = async (id) => {
    const result = await window.api.removeFromDownloadHistory(id)
    showToast(result.message)
    await loadDownloadHistory()
  }

  const handleClearDownloadHistory = async () => {
    const result = await window.api.clearDownloadHistory()
    showToast(result.message)
    await loadDownloadHistory()
  }

  const handleViewMagnetFromHistory = (magnetHash, magnetTitle) => {
    // Reconstruct magnet link from hash
    const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`
    const result = {
      magnet: magnetLink,
      title: magnetTitle
    }
    handleSelectResult(result)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Full-width sticky top navigation */}
      <div
        className={`sticky top-0 z-20 border-b border-slate-800 ${
          isNavStuck ? 'bg-slate-950 shadow-lg' : 'bg-background'
        }`}
      >
        <div className="max-w-7xl mx-auto px-8 pb-4 pt-2 flex justify-between items-center">
          <div className="flex items-center">
            <button onClick={() => setView('search')}>
              <img src={logo} alt="Watchy logo" className="w-10 h-10 cursor-pointer" />
            </button>
          </div>
          <div className="flex gap-4 items-center">
            <button
              onClick={() => setView('search')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                view === 'search'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-surface'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
              Search
            </button>
            <button
              onClick={() => setView('library')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                view === 'library'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-surface'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
              Library
            </button>
            <button
              onClick={() => setView('history')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                view === 'history'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-surface'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                  clipRule="evenodd"
                />
              </svg>
              History
            </button>
            <button
              onClick={() => setView('downloads')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                view === 'downloads'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white hover:bg-surface'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M3 14a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm7-12a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 10.586V3a1 1 0 011-1z" />
              </svg>
              Downloads
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 pt-8">
        {view === 'history' ? (
          <History
            history={history}
            onRemoveEntry={handleRemoveHistoryEntry}
            onRemoveAll={handleRemoveAllHistory}
            onResetFile={handleResetFileWatched}
            onPlayFile={async (url) => {
              await window.api.play(url)
            }}
            onViewMagnet={handleViewMagnetFromHistory}
          />
        ) : view === 'library' ? (
          <Library
            savedSearches={savedSearches}
            savedMagnets={savedMagnets}
            onSearchSelect={handleSearch}
            onMagnetSelect={handleSelectResult}
            onRemoveSearch={handleRemoveSearch}
            onRemoveMagnet={handleRemoveMagnet}
          />
        ) : view === 'downloads' ? (
          <DownloadManager
            downloads={activeDownloads}
            variant="page"
            downloadHistory={downloadHistory}
            onRemoveFromHistory={handleRemoveFromDownloadHistory}
            onClearHistory={handleClearDownloadHistory}
          />
        ) : (
          <>
            <SearchBar
              onSearch={handleSearch}
              onSaveSearch={handleSaveSearch}
              isLoading={isLoading}
              currentQuery={currentQuery}
            />

            {files.length > 0 ? (
              <div>
                <button
                  onClick={() => {
                    setFiles([])
                    setStatusModal(null)
                  }}
                  className="mb-4 text-sm text-gray-400 hover:text-white flex items-center gap-2"
                >
                  {results.length > 0 ? '← Back to results' : '← Back to search'}
                </button>
                <FileUserInterface
                  files={files}
                  onPlay={handlePlay}
                  watchedFiles={
                    currentMagnet
                      ? history
                          .find((h) => h.magnetHash === currentMagnet.hash)
                          ?.files.map((f) => f.filename) || []
                      : []
                  }
                  onSave={handleSaveMagnet}
                  magnetData={currentMagnet}
                />
              </div>
            ) : (
              <div className="grid gap-4">
                {results.map((result, index) => {
                  const imdbMatch = (currentQuery || '').match(/tt\d{7,8}/i)
                  const imdbId = imdbMatch ? imdbMatch[0] : result.imdb || null
                  return (
                    <ResultCard
                      key={index}
                      result={result}
                      canonicalTitle={currentMediaCatalogTitle || result.catalogTitle}
                      imdbId={imdbId}
                      onSelect={handleSelectResult}
                      onSave={handleSaveMagnet}
                      isSaved={savedMagnets.some((m) => m.magnet === result.magnet)}
                    />
                  )
                })}
              </div>
            )}
          </>
        )}

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />

        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}

        <StatusModal status={statusModal} onClose={clearStatusModal} />
        <DownloadManager
          downloads={activeDownloads}
          downloadHistory={downloadHistory}
          hidden={view === 'downloads' || isDownloadModalDismissed}
          onDismiss={() => setIsDownloadModalDismissed(true)}
        />
      </div>
    </div>
  )
}

export default App
