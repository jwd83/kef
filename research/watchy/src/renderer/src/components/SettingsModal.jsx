import { useState, useEffect } from 'react'

const SettingsModal = ({ isOpen, onClose, onSave }) => {
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (isOpen) {
      window.api.getKey().then((key) => {
        if (key) setApiKey(key)
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-surface p-8 rounded-2xl w-full max-w-md border border-gray-700 shadow-2xl">
        <h2 className="text-2xl font-bold mb-6">Settings</h2>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-400 mb-2">AllDebrid API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-4 py-3 bg-background border border-gray-700 rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
            placeholder="Enter your API key"
          />
          <p className="mt-2 text-xs text-gray-500">Required to cache and stream torrents.</p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(apiKey)}
            className="px-6 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
