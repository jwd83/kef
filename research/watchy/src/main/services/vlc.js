import { spawn } from 'child_process'

class VLCService {
  sanitizeInput(input) {
    let value = input

    if (value && typeof value === 'object') {
      if (typeof value.link === 'string') value = value.link
      else if (typeof value.l === 'string') value = value.l
      else value = String(value)
    }

    if (typeof value !== 'string') value = String(value ?? '')

    value = value.trim()
    value = value.replaceAll('&amp;', '&')

    if (value.includes('%3A') || value.includes('%2F')) {
      try {
        value = decodeURIComponent(value)
      } catch {
        // ignore decode errors
      }
    }

    return value
  }

  play(input, subtitleUrl = null) {
    const url = this.sanitizeInput(input)
    let command = 'vlc'
    const args = ['--fullscreen', '--no-video-title-show', url]

    if (subtitleUrl) {
      args.push(`--input-slave=${this.sanitizeInput(subtitleUrl)}`)
    }

    if (process.platform === 'darwin') {
      command = '/Applications/VLC.app/Contents/MacOS/VLC'
    } else if (process.platform === 'win32') {
      command = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'
    }

    const vlcProcess = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    })

    vlcProcess.on('error', (err) => {
      console.error('Failed to start VLC:', err)
    })

    // Let Electron continue even if VLC is still running.
    vlcProcess.unref()
  }
}

export default new VLCService()
