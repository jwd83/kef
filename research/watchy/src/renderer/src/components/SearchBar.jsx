import { useEffect, useRef, useState } from 'react'

const SUGGESTION_LIMIT = 8

const formatRuntime = (runtime) => {
  const n = Number(runtime)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `${Math.round(n)} min`
}

const SearchBar = ({ onSearch, onSaveSearch, isLoading, currentQuery }) => {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [posters, setPosters] = useState({})
  const [hoveredPoster, setHoveredPoster] = useState(null)
  const [posterPreviewPos, setPosterPreviewPos] = useState({ top: 0, left: 0 })

  const requestIdRef = useRef(0)
  const blurTimeoutRef = useRef(null)

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
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }

    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setActiveIndex(-1)
      setPosters({})
      return
    }

    const id = ++requestIdRef.current
    setIsSuggesting(true)

    const timeout = setTimeout(async () => {
      try {
        const res = await window.api.mediaSuggest(q, SUGGESTION_LIMIT)
        if (requestIdRef.current !== id) return

        const suggestionsList = Array.isArray(res) ? res : []
        setSuggestions(suggestionsList)
        setActiveIndex(-1)

        // Fetch posters for IMDb IDs in suggestions
        const imdbIds = suggestionsList.map((s) => s.imdbId).filter(Boolean)
        if (imdbIds.length > 0) {
          const postersMap = await window.api.getPosters(imdbIds)
          if (requestIdRef.current === id) {
            setPosters(postersMap)
          }
        }
      } finally {
        if (requestIdRef.current === id) setIsSuggesting(false)
      }
    }, 150)

    return () => clearTimeout(timeout)
  }, [query])

  const handleSubmit = (e) => {
    e.preventDefault()
    const q = query.trim()
    if (q) {
      setShowSuggestions(false)
      setActiveIndex(-1)
      setHoveredPoster(null)
      onSearch(q)
    }
  }

  const handlePickSuggestion = (s) => {
    setShowSuggestions(false)
    setActiveIndex(-1)
    setHoveredPoster(null)

    // Store a user-friendly search string that still includes the IMDbID.
    // App-level search logic will detect `tt...` and use only that for the actual search.
    const display = [s?.title || '', s?.year ? `(${s.year})` : '', s?.imdbId ? `[${s.imdbId}]` : '']
      .filter(Boolean)
      .join(' ')
      .trim()

    if (display) {
      setQuery(display)
      onSearch(display)
    }
  }

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Tab') {
      // Navigate through suggestions with Tab
      e.preventDefault()
      if (e.shiftKey) {
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
      } else {
        setActiveIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1))
      }
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault()
        handlePickSuggestion(suggestions[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveIndex(-1)
      setHoveredPoster(null)
    }
  }

  const handleBlur = () => {
    // Allow click events on suggestions to fire before closing.
    blurTimeoutRef.current = setTimeout(() => {
      setShowSuggestions(false)
      setActiveIndex(-1)
      setHoveredPoster(null)
    }, 120)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto mb-8">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Search for your favorites!"
          className="w-full px-6 py-4 text-lg bg-surface border border-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent shadow-lg transition-all"
          disabled={isLoading}
          autoComplete="off"
        />

        {showSuggestions && (suggestions.length > 0 || isSuggesting) && (
          <div className="absolute left-0 right-0 mt-2 bg-surface border border-gray-700 rounded-2xl shadow-xl overflow-hidden z-50">
            {isSuggesting && suggestions.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400">Searching catalog…</div>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {suggestions.map((s, idx) => (
                  <li key={`${s.imdbId}-${idx}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handlePickSuggestion(s)}
                      className={`w-full text-left px-4 py-3 flex items-start justify-between gap-4 transition-all duration-150 ${
                        idx === activeIndex
                          ? 'bg-primary/20 border-l-2 border-primary shadow-sm'
                          : 'hover:bg-gray-800/60 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {s.imdbId && posters[s.imdbId] && (
                          <img
                            src={posters[s.imdbId]}
                            alt={s.title}
                            className="w-12 h-16 object-cover rounded flex-shrink-0 cursor-zoom-in"
                            onMouseEnter={(e) => handlePosterMouseEnter(e, s.imdbId)}
                            onMouseLeave={handlePosterMouseLeave}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-gray-100 truncate">
                            {s.title}
                            {s.year ? <span className="text-gray-400"> ({s.year})</span> : null}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {s.type ? s.type : 'unknown'}
                            {s.primaryGenre ? ` • ${s.primaryGenre}` : ''}
                            {s.runtime ? ` • ${formatRuntime(s.runtime)}` : ''}
                            {s.imdbId ? ` • ${s.imdbId}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end text-gray-400 whitespace-nowrap">
                        {typeof s.rating === 'number' && s.rating > 0 && (
                          <>
                            <div className="text-base">
                              <span className="text-yellow-400">★</span> {s.rating}
                            </div>
                            {typeof s.votes === 'number' && s.votes > 0 && (
                              <div className="text-xs text-gray-500">
                                {s.votes.toLocaleString()} votes
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
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

        <div className="absolute right-2 top-2 bottom-2 flex gap-2">
          {currentQuery && (
            <button
              type="button"
              onClick={() => onSaveSearch(currentQuery)}
              className="px-4 bg-surface hover:bg-gray-700 text-gray-300 rounded-full font-medium transition-colors flex items-center gap-2"
              title="Save this search"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 bg-primary hover:bg-blue-600 text-white rounded-full font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>
    </form>
  )
}

export default SearchBar
