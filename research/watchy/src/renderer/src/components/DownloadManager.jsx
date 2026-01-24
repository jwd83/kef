import { useEffect, useMemo, useState } from 'react'

const DownloadManager = ({
  downloads,
  variant = 'overlay',
  hidden = false,
  onDismiss,
  downloadHistory = [],
  onRemoveFromHistory,
  onClearHistory
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState({})

  const isOverlay = variant === 'overlay'

  const activeCount = useMemo(() => {
    return downloads.filter((d) => d.state === 'progressing').length
  }, [downloads])

  const queuedCount = useMemo(() => {
    return downloads.filter((d) => d.state === 'queued').length
  }, [downloads])

  // Group download history by magnetTitle
  const groupedHistory = useMemo(() => {
    const groups = {}
    for (const item of downloadHistory) {
      const key = item.magnetTitle || 'Unknown'
      if (!groups[key]) {
        groups[key] = []
      }
      groups[key].push(item)
    }
    // Sort groups by most recent download
    return Object.entries(groups).sort((a, b) => {
      const aLatest = Math.max(...a[1].map((d) => new Date(d.completedAt).getTime()))
      const bLatest = Math.max(...b[1].map((d) => new Date(d.completedAt).getTime()))
      return bLatest - aLatest
    })
  }, [downloadHistory])

  const toggleGroup = (groupName) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName]
    }))
  }

  useEffect(() => {
    // For the page view, render as a normal section; no overlay transitions needed.
    if (!isOverlay) return

    if (hidden || downloads.length === 0) {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 300) // Wait for fade out
      return () => clearTimeout(timer)
    }

    setShouldRender(true)
    // Small timeout to ensure render happens before active class for transition
    requestAnimationFrame(() => setIsVisible(true))

    const allComplete = downloads.every((d) => d.state === 'completed' || d.state === 'failed')

    if (allComplete && downloads.length > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 4000) // 4 seconds delay
      return () => clearTimeout(timer)
    } else {
      setIsVisible(true)
    }
  }, [downloads, hidden, isOverlay])

  if (isOverlay && !shouldRender && !isVisible) return null

  if (!isOverlay) {
    return (
      <div className="space-y-6">
        {/* Active Downloads Section */}
        <div className="bg-surface rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Active Downloads</h2>
            <span className="text-sm text-gray-400">
              {downloads.length === 0
                ? 'No active downloads'
                : `${activeCount} active${queuedCount > 0 ? ` • ${queuedCount} queued` : ''} • ${downloads.length} total`}
            </span>
          </div>

          {downloads.length === 0 ? (
            <div className="text-gray-400 text-sm">Start a download to see progress here.</div>
          ) : (
            <div className="space-y-2">
              {downloads.map((download) => (
                <div
                  key={download.filename}
                  className="p-3 bg-background rounded-lg border border-gray-700/60"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-gray-200 truncate pr-2" title={download.filename}>
                      {download.filename}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {download.state === 'completed'
                        ? 'Done'
                        : download.state === 'failed'
                          ? 'Failed'
                          : download.state === 'queued'
                            ? 'Queued'
                            : `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`}
                    </span>
                  </div>

                  {download.state === 'progressing' && (
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-accent h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${(download.receivedBytes / download.totalBytes) * 100}%`
                        }}
                      />
                    </div>
                  )}
                  {download.state === 'queued' && (
                    <div className="text-xs text-yellow-500 mt-1">
                      Waiting for slot (max 3 concurrent)
                    </div>
                  )}
                  {download.state === 'completed' && (
                    <div className="text-xs text-green-500 mt-1">Download complete</div>
                  )}
                  {download.state === 'completed' && download.savePath && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => window.api.openFolder(download.savePath)}
                        className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                      >
                        📁 Open Folder
                      </button>
                      <button
                        type="button"
                        onClick={() => window.api.playFile(download.savePath)}
                        className="text-xs px-2 py-1 bg-accent hover:bg-accent/80 rounded transition-colors"
                      >
                        ▶️ Play in VLC
                      </button>
                    </div>
                  )}
                  {download.state === 'failed' && (
                    <div className="text-xs text-red-500 mt-1">Download failed</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Completed Downloads (History) Section */}
        <div className="bg-surface rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Download History</h2>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400">
                {downloadHistory.length === 0
                  ? 'No downloads'
                  : `${downloadHistory.length} file${downloadHistory.length === 1 ? '' : 's'} in ${groupedHistory.length} group${groupedHistory.length === 1 ? '' : 's'}`}
              </span>
              {downloadHistory.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-xs px-3 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {downloadHistory.length === 0 ? (
            <div className="text-gray-400 text-sm">Completed downloads will appear here.</div>
          ) : (
            <div className="space-y-3">
              {groupedHistory.map(([magnetTitle, items]) => {
                const isCollapsed = collapsedGroups[magnetTitle]
                const completedCount = items.filter((i) => i.state === 'completed').length
                const failedCount = items.filter((i) => i.state === 'failed').length
                const latestDate = new Date(
                  Math.max(...items.map((i) => new Date(i.completedAt).getTime()))
                )

                return (
                  <div
                    key={magnetTitle}
                    className="bg-background rounded-lg border border-gray-700/60 overflow-hidden"
                  >
                    {/* Group Header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(magnetTitle)}
                      className="w-full p-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-4 w-4 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span
                          className="text-sm font-medium text-gray-200 truncate"
                          title={magnetTitle}
                        >
                          {magnetTitle}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-gray-500">
                          {latestDate.toLocaleDateString()}
                        </span>
                        <span className="text-xs text-gray-400">
                          {completedCount} file{completedCount === 1 ? '' : 's'}
                          {failedCount > 0 && (
                            <span className="text-red-400 ml-1">({failedCount} failed)</span>
                          )}
                        </span>
                      </div>
                    </button>

                    {/* Group Files */}
                    {!isCollapsed && (
                      <div className="border-t border-gray-700/60">
                        {items.map((historyItem) => (
                          <div
                            key={historyItem.id}
                            className="p-3 pl-10 border-b border-gray-700/30 last:border-b-0 hover:bg-gray-800/30"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span
                                className="text-sm text-gray-300 truncate pr-2"
                                title={historyItem.filename}
                              >
                                {historyItem.filename}
                              </span>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs whitespace-nowrap ${historyItem.state === 'completed' ? 'text-green-500' : 'text-red-400'}`}
                                >
                                  {historyItem.state === 'completed' ? 'Completed' : 'Failed'}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRemoveFromHistory(historyItem.id)
                                  }}
                                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                                  title="Remove from history"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>

                            <div className="text-xs text-gray-500">
                              {new Date(historyItem.completedAt).toLocaleString()}
                            </div>

                            {historyItem.state === 'completed' && historyItem.savePath && (
                              <div className="flex items-center gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    window.api.openFolder(historyItem.savePath)
                                  }}
                                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                                >
                                  Open Folder
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    window.api.playFile(historyItem.savePath)
                                  }}
                                  className="text-xs px-2 py-1 bg-accent hover:bg-accent/80 rounded transition-colors"
                                >
                                  Play in VLC
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Overlay variant
  return (
    <div
      className={`fixed bottom-4 right-4 w-80 bg-surface border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 transition-all duration-300 ease-in-out transform ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-white">Downloads</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {activeCount} active{queuedCount > 0 ? ` • ${queuedCount} queued` : ''}
          </span>
          <button
            type="button"
            onClick={() => onDismiss?.()}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Hide downloads"
            title="Hide"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm2.707-10.707a1 1 0 00-1.414-1.414L10 7.172 8.707 5.879a1 1 0 10-1.414 1.414L8.586 8.586l-1.293 1.293a1 1 0 101.414 1.414L10 10l1.293 1.293a1 1 0 001.414-1.414L11.414 8.586l1.293-1.293z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {downloads.map((download) => (
          <div
            key={download.filename}
            className="p-3 border-b border-gray-700 last:border-0 hover:bg-gray-800 transition-colors"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm text-gray-200 truncate pr-2" title={download.filename}>
                {download.filename}
              </span>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {download.state === 'completed'
                  ? 'Done'
                  : download.state === 'failed'
                    ? 'Failed'
                    : download.state === 'queued'
                      ? 'Queued'
                      : `${Math.round((download.receivedBytes / download.totalBytes) * 100)}%`}
              </span>
            </div>
            {download.state === 'progressing' && (
              <div className="w-full bg-gray-700 rounded-full h-1.5 mt-1">
                <div
                  className="bg-accent h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(download.receivedBytes / download.totalBytes) * 100}%` }}
                />
              </div>
            )}
            {download.state === 'queued' && (
              <div className="text-xs text-yellow-500 mt-1">
                Waiting for slot (max 3 concurrent)
              </div>
            )}
            {download.state === 'completed' && (
              <div className="text-xs text-green-500 mt-1">Download complete</div>
            )}
            {download.state === 'completed' && download.savePath && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => window.api.openFolder(download.savePath)}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  📁 Open Folder
                </button>
                <button
                  type="button"
                  onClick={() => window.api.playFile(download.savePath)}
                  className="text-xs px-2 py-1 bg-accent hover:bg-accent/80 rounded transition-colors"
                >
                  ▶️ Play in VLC
                </button>
              </div>
            )}
            {download.state === 'failed' && (
              <div className="text-xs text-red-500 mt-1">Download failed</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default DownloadManager
