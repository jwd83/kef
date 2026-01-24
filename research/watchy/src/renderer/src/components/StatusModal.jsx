import { useState, useEffect } from 'react'

const StatusModal = ({ status, onClose }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!status) {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 300)
      return () => clearTimeout(timer)
    }

    setShouldRender(true)
    requestAnimationFrame(() => setIsVisible(true))

    // Auto-dismiss for completion statuses
    if (status.type === 'success') {
      const timer = setTimeout(() => {
        setIsVisible(false)
        setTimeout(() => onClose(), 300)
      }, 2500)
      return () => clearTimeout(timer)
    }

    // Auto-dismiss error messages after 6 seconds
    if (status.type === 'error') {
      const timer = setTimeout(() => {
        setIsVisible(false)
        setTimeout(() => onClose(), 300)
      }, 6000)
      return () => clearTimeout(timer)
    }
  }, [status, onClose])

  if (!shouldRender || !status) return null

  const isLoading = status.type === 'loading'
  const isSuccess = status.type === 'success'
  const isError = status.type === 'error'

  return (
    <div
      className={`fixed bottom-4 left-4 w-80 bg-surface border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 transition-all duration-300 ease-in-out transform ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div
        className={`px-4 py-3 flex items-center gap-3 ${
          isSuccess ? 'bg-green-900/30' : isError ? 'bg-red-900/30' : 'bg-gray-800'
        }`}
      >
        {isLoading && (
          <svg
            className="animate-spin h-5 w-5 text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {isSuccess && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-green-500"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {isError && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-red-500"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <span className="text-sm font-medium text-white">{status.message}</span>
      </div>
    </div>
  )
}

export default StatusModal
