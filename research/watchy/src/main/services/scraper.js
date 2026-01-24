import axios from 'axios'

const BASE_URL = 'https://apibay.org'

class ScraperService {
  async search(query) {
    // Apibay doesn't handle apostrophes well, replace with space
    const sanitizedQuery = query.replace(/'/g, ' ').replace(/\s+/g, ' ').trim()
    console.log(`[Scraper] Searching Apibay for: ${sanitizedQuery}`)
    try {
      // cat=0 means all categories
      const searchUrl = `${BASE_URL}/q.php?q=${encodeURIComponent(sanitizedQuery)}&cat=0`
      console.log(`[Scraper] URL: ${searchUrl}`)

      const response = await axios.get(searchUrl)
      const results = response.data

      if (results[0] && results[0].name === 'No results returned') {
        return []
      }

      console.log(`[Scraper] Found ${results.length} results`)

      // Transform to our app's format
      return results.map((item) => {
        const magnet = `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(item.name)}`
        return {
          title: item.name,
          seeds: parseInt(item.seeders),
          leeches: parseInt(item.leechers),
          size: this.formatSize(parseInt(item.size)),
          magnet,
          link: magnet,
          imdb: item.imdb || null
        }
      })
    } catch (error) {
      console.error('Scraper search error:', error)
      return []
    }
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}

export default new ScraperService()
