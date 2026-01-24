const basename = (p) => {
  if (!p) return ''
  const s = String(p)
  return s.split('/').pop().split('\\').pop()
}

const History = ({
  history,
  onRemoveEntry,
  onRemoveAll,
  onResetFile,
  onPlayFile,
  onViewMagnet
}) => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Watch History</h2>
        {history.length > 0 && (
          <button
            onClick={onRemoveAll}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Clear All History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No watch history yet</p>
      ) : (
        <div className="space-y-4">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="bg-surface p-5 rounded-xl border border-gray-700 hover:border-primary transition-all overflow-hidden"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1 min-w-0">
                  <h3
                    className="text-lg font-semibold text-white mb-2 truncate"
                    title={entry.magnetTitle}
                  >
                    {entry.magnetTitle}
                  </h3>
                  <div className="flex gap-4 text-sm text-gray-400">
                    <span>
                      {entry.files.length} {entry.files.length === 1 ? 'file' : 'files'} watched
                    </span>
                    <span>Last played {new Date(entry.lastPlayedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => onRemoveEntry(entry.id)}
                  className="ml-4 p-2 text-gray-400 hover:text-red-500 transition-colors"
                  title="Remove from history"
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

              <div className="space-y-2 mb-4">
                {entry.files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-background rounded-lg group"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5 text-green-500 flex-shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm" title={file.filename}>
                          {basename(file.filename)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Played {file.playCount} {file.playCount === 1 ? 'time' : 'times'} · Last
                          played {new Date(file.playedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => onPlayFile(file.streamUrl)}
                        className="px-3 py-1.5 bg-accent hover:bg-violet-600 text-white rounded-lg text-sm font-medium transition-colors"
                        title="Play again"
                      >
                        Play
                      </button>
                      <button
                        onClick={() => onResetFile(entry.id, file.filename)}
                        className="px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg text-sm transition-colors"
                        title="Remove from watched"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onViewMagnet(entry.magnetHash, entry.magnetTitle)}
                className="w-full px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
                  <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                View All Files
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default History
