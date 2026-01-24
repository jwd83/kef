import { useMemo, useState, useEffect } from 'react'

const Library = ({
  savedSearches,
  savedMagnets,
  onSearchSelect,
  onMagnetSelect,
  onRemoveSearch,
  onRemoveMagnet
}) => {
  const [filter, setFilter] = useState('')
  const [activeTab, setActiveTab] = useState('library') // 'library' | 'searches'
  const [posters, setPosters] = useState({})
  const [hoveredPoster, setHoveredPoster] = useState(null)
  const [posterPreviewPos, setPosterPreviewPos] = useState({ top: 0, left: 0 })

  const normalizedFilter = filter.trim().toLowerCase()

  const handlePosterMouseEnter = (e, imdbId) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPosterPreviewPos({
      top: rect.top,
      left: rect.right + 12
    })
    setHoveredPoster(imdbId)
  }

  const handlePosterMouseLeave = () => {
    setHoveredPoster(null)
  }

  useEffect(() => {
    const imdbIds = savedMagnets.map((item) => item.imdbId).filter(Boolean)
    if (imdbIds.length > 0) {
      window.api.getPosters(imdbIds).then(setPosters)
    }
  }, [savedMagnets])

  const sortedSavedSearches = useMemo(
    () =>
      [...savedSearches].sort((a, b) =>
        a.query.localeCompare(b.query, undefined, { sensitivity: 'base' })
      ),
    [savedSearches]
  )

  const sortedSavedMagnets = useMemo(
    () =>
      [...savedMagnets].sort((a, b) => {
        const aTitle = a.canonicalTitle || a.title || ''
        const bTitle = b.canonicalTitle || b.title || ''
        return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' })
      }),
    [savedMagnets]
  )

  const filteredSearches = normalizedFilter
    ? sortedSavedSearches.filter((s) => s.query.toLowerCase().includes(normalizedFilter))
    : sortedSavedSearches

  const filteredMagnets = normalizedFilter
    ? sortedSavedMagnets.filter((item) => {
        const haystack = `${item.canonicalTitle || ''} ${item.title || ''}`.toLowerCase()
        return haystack.includes(normalizedFilter)
      })
    : sortedSavedMagnets

  return (
    <div className="space-y-8">
      {/* Tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="inline-flex bg-surface border border-gray-700 rounded-full p-1">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
              activeTab === 'library' ? 'bg-primary text-black' : 'text-gray-300 hover:text-white'
            }`}
          >
            My Library
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('searches')}
            className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
              activeTab === 'searches' ? 'bg-primary text-black' : 'text-gray-300 hover:text-white'
            }`}
          >
            Saved Searches
          </button>
        </div>

        {/* Library filter */}
        <div className="flex-1 flex justify-end ml-4">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={activeTab === 'library' ? 'Filter library...' : 'Filter saved searches...'}
            className="w-full max-w-sm px-4 py-2 bg-surface border border-gray-700 rounded-full text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {activeTab === 'library' && (
        <div>
          <h2 className="text-2xl font-bold mb-4 text-white">My Library</h2>
          {savedMagnets.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No saved items yet</p>
          ) : filteredMagnets.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No items match your filter</p>
          ) : (
            <div className="grid gap-3">
              {filteredMagnets.map((item) => {
                const primaryTitle = item.canonicalTitle || item.title
                const subtitle = item.canonicalTitle ? item.title : null

                return (
                  <div
                    key={item.id}
                    className="bg-surface p-4 rounded-xl border border-gray-700 hover:border-primary transition-all group overflow-hidden"
                  >
                    <div className="flex items-start gap-4">
                      {item.imdbId && posters[item.imdbId] && (
                        <img
                          src={posters[item.imdbId]}
                          alt={primaryTitle}
                          className="w-12 h-16 object-cover rounded flex-shrink-0 cursor-zoom-in"
                          onMouseEnter={(e) => handlePosterMouseEnter(e, item.imdbId)}
                          onMouseLeave={handlePosterMouseLeave}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <button
                            onClick={() => onMagnetSelect(item)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <h3
                              className="text-lg font-semibold mb-1 group-hover:text-primary transition-colors truncate"
                              title={primaryTitle}
                            >
                              {primaryTitle}
                            </h3>
                            {subtitle && (
                              <div className="text-xs text-gray-400 mb-1 truncate" title={subtitle}>
                                {subtitle}
                              </div>
                            )}
                            <div className="flex justify-between text-sm text-gray-400">
                              <div className="flex gap-4">
                                <span className="text-green-400">↑ {item.seeds}</span>
                                <span className="text-red-400">↓ {item.leeches}</span>
                              </div>
                              <span>{item.size}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-2 flex items-center gap-2">
                              {item.imdbId && (
                                <span className="text-[0.65rem] text-gray-400">{item.imdbId}</span>
                              )}
                              <span>Added {new Date(item.savedAt).toLocaleDateString()}</span>
                            </div>
                          </button>
                          <button
                            onClick={() => onRemoveMagnet(item.id)}
                            className="ml-4 p-2 text-gray-400 hover:text-red-500 transition-colors"
                            title="Remove from library"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'searches' && (
        <div>
          <h2 className="text-2xl font-bold mb-4 text-white">Saved Searches</h2>
          {savedSearches.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No saved searches yet</p>
          ) : filteredSearches.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No searches match your filter</p>
          ) : (
            <div className="grid gap-3">
              {filteredSearches.map((search) => (
                <div
                  key={search.id}
                  className="bg-surface p-4 rounded-xl border border-gray-700 hover:border-primary transition-all group flex justify-between items-center overflow-hidden"
                >
                  <button
                    onClick={() => onSearchSelect(search.query)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-lg group-hover:text-primary transition-colors truncate">
                      {search.query}
                    </div>
                    <div className="text-sm text-gray-500">
                      Saved {new Date(search.savedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => onRemoveSearch(search.id)}
                    className="ml-4 p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hoveredPoster && posters[hoveredPoster] && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{
            top: posterPreviewPos.top,
            left: posterPreviewPos.left
          }}
        >
          <img
            src={posters[hoveredPoster]}
            alt="Poster preview"
            className="w-48 h-72 object-cover rounded-lg shadow-2xl border border-gray-600"
          />
        </div>
      )}
    </div>
  )
}

export default Library
