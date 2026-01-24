import axios from 'axios'
import Store from 'electron-store'

const store = new Store()
const BASE_URL = 'https://api.alldebrid.com/v4'
const BASE_URL_V41 = 'https://api.alldebrid.com/v4.1'

class AllDebridService {
  constructor() {
    this.agent = 'watchy-app'
  }

  get apiKey() {
    return store.get('alldebrid_api_key')
  }

  async setApiKey(key) {
    store.set('alldebrid_api_key', key)
  }

  // Upload a magnet (URI or hash). Returns { status, data: { magnets: [{ id, hash, name, ready, ... }] } }
  async uploadMagnet(magnet) {
    if (!this.apiKey) throw new Error('API Key not set')
    try {
      // Keep using GET for backward compat — AllDebrid still supports GET with apikey param.
      const response = await axios.get(`${BASE_URL}/magnet/upload`, {
        params: { agent: this.agent, apikey: this.apiKey, magnets: magnet }
      })
      return response.data
    } catch (error) {
      console.error('AllDebrid uploadMagnet error:', error?.response?.data || error)
      throw error
    }
  }

  // v4.1 magnet/status — check one or all magnets. If id is provided, returns that magnet.
  async getStatusV41({ id, status } = {}) {
    if (!this.apiKey) throw new Error('API Key not set')
    try {
      const headers = { Authorization: `Bearer ${this.apiKey}` }
      const form = new URLSearchParams()
      if (id !== undefined && id !== null) form.append('id', String(id))
      if (status) form.append('status', status) // 'active' | 'ready' | ...
      const response = await axios.post(`${BASE_URL_V41}/magnet/status`, form, { headers })
      return response.data
    } catch (error) {
      console.error('AllDebrid getStatusV41 error:', error?.response?.data || error)
      throw error
    }
  }

  // v4.1 magnet/files — fetch files and links for one or more magnet IDs.
  async getFiles(ids) {
    if (!this.apiKey) throw new Error('API Key not set')
    try {
      const headers = { Authorization: `Bearer ${this.apiKey}` }
      const form = new URLSearchParams()
      const list = Array.isArray(ids) ? ids : [ids]
      // API expects id[]=... for multiple values
      for (const id of list) form.append('id[]', String(id))
      const response = await axios.post(`${BASE_URL_V41}/magnet/files`, form, { headers })
      return response.data
    } catch (error) {
      console.error('AllDebrid getFiles error:', error?.response?.data || error)
      throw error
    }
  }

  // Deprecated v4 GET status kept for backwards compatibility where used by renderer.
  async getStatus(id) {
    if (!this.apiKey) throw new Error('API Key not set')
    try {
      const response = await axios.get(`${BASE_URL}/magnet/status`, {
        params: { agent: this.agent, apikey: this.apiKey, id }
      })
      return response.data
    } catch (error) {
      console.error('AllDebrid getStatus error:', error?.response?.data || error)
      throw error
    }
  }

  // v4 link/unlock — used for direct host links (not magnets). Kept as is.
  async unlockLink(link) {
    if (!this.apiKey) throw new Error('API Key not set')
    try {
      const response = await axios.get(`${BASE_URL}/link/unlock`, {
        params: { agent: this.agent, apikey: this.apiKey, link }
      })
      return response.data
    } catch (error) {
      console.error('AllDebrid unlockLink error:', error?.response?.data || error)
      throw error
    }
  }
}

export default new AllDebridService()
