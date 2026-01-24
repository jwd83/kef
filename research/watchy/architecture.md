# Watchy Architecture

This document describes the structure and behavior of the Watchy desktop application so that it can be reimplemented from scratch by another team or AI model.

## High-Level Overview

Watchy is a cross-platform Electron desktop app that lets users:

- Search public P2P indexes for torrents.
- Upload magnet links to AllDebrid for caching and link unlocking.
- Stream unlocked video files to VLC.
- Download unlocked files to disk.
- Maintain a personal library of saved searches and magnets.
- Track watch history and download history.

### Technology Stack

- **Runtime:** Electron (main + renderer processes).
- **Frontend:** React (SPA) built with Vite, Tailwind-based styling.
- **Main process tooling:** `@electron-toolkit/utils`, `@electron-toolkit/preload`.
- **IPC:** `ipcMain` / `ipcRenderer` with a custom `window.api` bridge in the preload script.
- **Persistence:** `electron-store` (JSON store on disk).
- **Local DB:** `better-sqlite3` for a read-only `media_catalog.db` used for title suggestions.
- **HTTP client:** `axios`.
- **External services:** AllDebrid HTTP API, Apibay (The Pirate Bay index mirror), local VLC installation.
- **Packaging:** `electron-vite` for build and dev; `electron-builder` for installers.

### Top-Level Directories

- `src/main` – Electron main process entry and backend services.
- `src/preload` – Preload script that exposes a safe `window.api` bridge.
- `src/renderer` – React application (index HTML + React SPA under `src/renderer/src`).
- `build/` – Icons and entitlement files used in packaged builds.
- `media_catalog.db` – SQLite database bundled with the app for media suggestions.
- `posters.db` – SQLite database bundled with the app for poster images.
- `builder.py`, `electron-builder.yml`, `electron.vite.config.mjs` – Packaging and release tooling.

## Process Architecture

### Main Process (Electron)

Entry point: `src/main/index.js` (bundled to `out/main/index.js` in production).

Responsibilities:

- Create and manage the main `BrowserWindow`.
- Configure application icon and Windows app metadata.
- Wire up `ipcMain.handle` routes used by the renderer.
- Implement a download queue and track file downloads.
- Integrate with backend services (AllDebrid, scraper, VLC, library, media catalog).

#### Window Creation (`createWindow`)

- Chooses an icon file based on platform:
  - Windows: `build/icon.ico`.
  - Other platforms: `build/icon.png`.
- In dev, resolves the icon path under the repo; in production, uses `process.resourcesPath`.
- Creates a `BrowserWindow` with:
  - Size ~900×670 px.
  - `autoHideMenuBar: true`.
  - `webPreferences.preload` pointing at `out/preload/index.js`.
  - `sandbox: false` (uses contextIsolation instead).
- On `ready-to-show`, sets the window title to `Watchy v<appVersion>`.
- On Windows, also calls `setAppDetails` to provide a stable `appId` and taskbar icon.
- Dev vs prod loading:
  - Dev: `mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)` (served by Vite).
  - Prod: `mainWindow.loadFile('../renderer/index.html')`.
- Configures external link handling via `setWindowOpenHandler` to open links in the system browser.

#### Download Management

- Maintains a global `Map downloadTargets: url -> directory`.
- Implements a `DownloadQueue` class with:
  - `maxConcurrent` (default 3 concurrent active downloads).
  - `queue` (FIFO list of pending downloads `{ url, options, sender, filename }`).
  - `activeDownloads` (set of URLs currently downloading).
  - `mainWindow` reference for sending progress events.
- Public methods:
  - `setMainWindow(window)` – attach window for IPC updates.
  - `add(url, options, sender)` – enqueue download; if `options.directory` is provided, record in `downloadTargets`. Also emits an initial `download:progress` event with state `queued` and queue position.
  - `processQueue()` – start new downloads until `maxConcurrent` is reached.
  - `startDownload(url, options, sender)` – calls `sender.downloadURL(url)` to trigger Electron's download mechanism.
  - `onDownloadComplete(url)` – remove from `activeDownloads` and reprocess queue.

`BrowserWindow.webContents.session.on('will-download')` is used to:

- Re-map download path based on `downloadTargets` (if a target directory was specified from the renderer).
- Track progress via `item.on('updated')` and send `download:progress` events with:
  - `filename`, `receivedBytes`, `totalBytes`, `savePath`, `state: 'progressing'`.
- On completion (`item.once('done')`), emit a final `download:progress` event with:
  - `filename`, `savePath`, `state: 'completed' | 'failed'`, `receivedBytes`, `totalBytes`.
- Persist a download history entry via `library.addToDownloadHistory`.
- Notify `downloadQueue.onDownloadComplete(itemUrl)`.

The renderer listens for `download:progress` via the preload bridge.

#### App Lifecycle

- On `app.whenReady`:
  - Calls `electronApp.setAppUserModelId('com.watchy.app')`.
  - Hooks `browser-window-created` to `optimizer.watchWindowShortcuts` to manage dev tools keybindings.
  - Registers all IPC handlers (see below).
  - Calls `createWindow()`.
- On `app.on('activate')` (macOS behavior): re-creates a window if none exist.
- On `app.on('window-all-closed')`: quits the app on non-macOS platforms.

### Preload Process

Entry point: `src/preload/index.js`.

Responsibilities:

- Create a safe API surface for the renderer via `contextBridge.exposeInMainWorld`.
- Re-export `electronAPI` from `@electron-toolkit/preload` as `window.electron`.
- Expose `window.api` functions that map to `ipcRenderer.invoke` calls for all app-specific features.

Exposed methods under `window.api`:

- Search and metadata:
  - `search(query)` → `api:search`.
  - `mediaSuggest(query, limit)` → `api:mediaSuggest`.
  - `getPosters(imdbIds)` → `api:getPosters`.
- AllDebrid integration:
  - `unlock(magnet)` → `api:unlock` (upload magnet; v4 API).
  - `getStatus(id)` → `api:getStatus` (legacy v4 status).
  - `getStatusV41(params)` → `api:getStatusV41` (v4.1 magnet status; supports filters like `status` and `id`).
  - `getMagnetFiles(ids)` → `api:getMagnetFiles` (v4.1 magnet/files).
  - `getFiles(link)` → `api:getFiles` (v4 link/unlock).
  - `resolve(url)` → `api:resolve` (main attempts to unlock a hoster URL; falls back to original URL).
- VLC playback and file system:
  - `play(url)` → `api:play` (resolve and open in VLC).
  - `openFolder(filePath)` → `api:openFolder` (show in file explorer).
  - `playFile(filePath)` → `api:playFile` (launch VLC with local path).
- Downloads:
  - `download(url, options)` → `api:download` (`options` may contain `directory`).
  - `selectFolder()` → `api:selectFolder` (open-directory dialog; returns selected path or `null`).
  - `onDownloadProgress(callback)` – subscribes to `download:progress` events, returns an unsubscribe function.
- AllDebrid API key management:
  - `saveKey(key)` → `api:saveKey` (persist key in `electron-store`).
  - `getKey()` → `api:getKey`.
- Magnet ID cache:
  - `getMagnetIdByHash(hash)` → `api:getMagnetIdByHash`.
  - `setMagnetId(hash, id)` → `api:setMagnetId`.
- Library (saved searches and magnets):
  - `getSavedSearches()` → `api:getSavedSearches`.
  - `addSavedSearch(query)` → `api:addSavedSearch`.
  - `removeSavedSearch(id)` → `api:removeSavedSearch`.
  - `getSavedMagnets()` → `api:getSavedMagnets`.
  - `addSavedMagnet(magnetData)` → `api:addSavedMagnet`.
  - `removeSavedMagnet(id)` → `api:removeSavedMagnet`.
- Watch history:
  - `getHistory()` → `api:getHistory`.
  - `recordPlay(magnetHash, magnetTitle, filename, streamUrl)` → `api:recordPlay`.
  - `removeHistoryEntry(id)` → `api:removeHistoryEntry`.
  - `removeAllHistory()` → `api:removeAllHistory`.
  - `resetFileWatched(historyId, filename)` → `api:resetFileWatched`.
- Download history:
  - `getDownloadHistory()` → `api:getDownloadHistory`.
  - `removeFromDownloadHistory(id)` → `api:removeFromDownloadHistory`.
  - `clearDownloadHistory()` → `api:clearDownloadHistory`.

If context isolation is disabled, the same objects are attached directly to `window`.

## Backend Services (Main Process)

All services live under `src/main/services` and are imported by `src/main/index.js`.

### AllDebridService (`allDebrid.js`)

Wrapper around AllDebrid v4 and v4.1 APIs.

Internal details:

- Uses `electron-store` to persist the API key under key `alldebrid_api_key`.
- Uses a fixed `agent` string: `watchy-app`.
- `BASE_URL = 'https://api.alldebrid.com/v4'`.
- `BASE_URL_V41 = 'https://api.alldebrid.com/v4.1'`.

Methods:

- `get apiKey()` – reads the stored API key.
- `async setApiKey(key)` – persists the key.
- `async uploadMagnet(magnet)` – v4 `magnet/upload` (GET, query params: `agent`, `apikey`, `magnets`).
- `async getStatusV41({ id, status })` – v4.1 `magnet/status` (POST with `Authorization: Bearer <apikey>` and a `URLSearchParams` body; optional `id` and `status`). Returns `data.magnets`.
- `async getFiles(ids)` – v4.1 `magnet/files` (POST, `Authorization: Bearer`, with `id[]` params for one or more IDs).
- `async getStatus(id)` – legacy v4 `magnet/status` (GET with `agent`, `apikey`, `id`).
- `async unlockLink(link)` – v4 `link/unlock` (GET with `agent`, `apikey`, `link`); used for hoster and direct file links.

All methods require `apiKey` to be set and throw if missing.

### LibraryService (`library.js`)

Encapsulates user-level persistence using `electron-store`.

Keys and structures:

- **Saved searches** (`savedSearches`):
  - Array of objects: `{ id: string, query: string, savedAt: ISOString }`.
- **Magnet ID map** (`magnetIdMap`):
  - Object map `{ [hash: string]: id: number | string }` for caching AllDebrid magnet IDs by torrent hash.
- **Saved magnets (library)** (`savedMagnets`):
  - Array:
    - `id: string` (timestamp-based).
    - `title: string` – display title.
    - `magnet: string` – magnet URI.
    - `size: string` – human readable size.
    - `seeds: number`.
    - `leeches: number`.
    - `savedAt: ISOString`.
    - `imdbId: string | null`.
    - `canonicalTitle: string | null` – from media catalog suggestions.
- **Watch history** (`history`):
  - Array of entries:
    - `id: string`.
    - `magnetHash: string` – normalized torrent hash.
    - `magnetTitle: string`.
    - `files: Array<{ filename: string, streamUrl: string, playedAt: ISOString, playCount: number }>`.
    - `firstPlayedAt: ISOString`.
    - `lastPlayedAt: ISOString`.
- **Download history** (`downloadHistory`):
  - Array of entries:
    - `id: string`.
    - `filename: string`.
    - `magnetTitle: string` – source magnet title for grouping (required; old entries without this field are auto-removed).
    - `state: 'completed' | 'failed'`.
    - `savePath: string | null`.
    - `receivedBytes: number`.
    - `totalBytes: number`.
    - `completedAt: ISOString`.
    - `originalState: same as state`.

Exposed methods (wired via IPC):

- Saved searches: `getSavedSearches`, `addSavedSearch`, `removeSavedSearch`.
- Saved magnets: `getSavedMagnets`, `addSavedMagnet`, `removeSavedMagnet`.
- Magnet IDs: `getMagnetIdByHash`, `setMagnetId`.
- Watch history: `getHistory`, `recordPlay`, `removeHistoryEntry`, `removeAllHistory`, `resetFileWatched`.
- Download history: `getDownloadHistory`, `addToDownloadHistory`, `removeFromDownloadHistory`, `clearDownloadHistory`.

### MediaCatalogService (`mediaCatalog.js`)

Read-only access to `media_catalog.db` using `better-sqlite3`.

Responsibilities:

- Find and open `media_catalog.db` in dev and prod builds.
- Provide `suggest(query, limit)` for search bar suggestions.

DB location resolution (`getMediaCatalogDbPath`):

- Prod: `path.join(process.resourcesPath, 'media_catalog.db')`.
- Dev candidates (first existing path is used):
  1. `path.join(app.getAppPath(), 'media_catalog.db')`.
  2. `path.join(__dirname, '../../../media_catalog.db')` (accounting for compiled main path).
  3. `path.join(process.cwd(), 'media_catalog.db')`.

Query used by `suggest`:

```sql
SELECT
  Title         AS title,
  Year          AS year,
  IMDbID        AS imdbId,
  Type          AS type,
  primary_genre AS primaryGenre,
  runtime       AS runtime,
  Rating        AS rating,
  Votes         AS votes
FROM media_catalog
WHERE
  Title LIKE ? ESCAPE '\\' COLLATE NOCASE
  OR IMDbID LIKE ? ESCAPE '\\' COLLATE NOCASE
ORDER BY
  (Title LIKE ? ESCAPE '\\' COLLATE NOCASE) DESC,
  Votes DESC
LIMIT ?;
```

`escapeLike` escapes `%`, `_`, and `\` so the query is safe.

Return shape: array of rows with fields `{ title, year, imdbId, type, primaryGenre, runtime, rating, votes }`.

### PostersService (`posters.js`)

Read-only access to `posters.db` using `better-sqlite3`.

Responsibilities:

- Find and open `posters.db` in dev and prod builds.
- Provide `getPostersByImdbIds(ids)` for retrieving poster images.

DB location resolution (`getPostersDbPath`):

- Prod: `path.join(process.resourcesPath, 'posters.db')`.
- Dev candidates (first existing path is used):
  1. `path.join(app.getAppPath(), 'posters.db')`.
  2. `path.join(__dirname, '../../../posters.db')` (accounting for compiled main path).
  3. `path.join(process.cwd(), 'posters.db')`.

Query used by `getPostersByImdbIds`:

```sql
SELECT
  IMDbID AS imdbId,
  webp
FROM posters
WHERE IMDbID IN (?, ?, ...);
```

The service converts the `webp` BLOB to a base64-encoded data URL (`data:image/webp;base64,...`) for direct use in the renderer.

Return shape: `Map<imdbId, dataUrl>` where `dataUrl` is a string like `data:image/webp;base64,<base64String>`.

### ScraperService (`scraper.js`)

Thin wrapper around Apibay.

- `BASE_URL = 'https://apibay.org'`.
- `async search(query)`:
  - Logs query and request URL.
  - Requests `${BASE_URL}/q.php?q=<encoded>&cat=0` (category 0 = all).
  - If the first result has `name === 'No results returned'`, returns `[]`.
  - Otherwise maps results to:
    - `title: item.name`.
    - `seeds: parseInt(item.seeders)`.
    - `leeches: parseInt(item.leechers)`.
    - `size: formatSize(bytes)` → string like `1.23 GB`.
    - `magnet: 'magnet:?xt=urn:btih:<info_hash>&dn=<encoded name>'`.
    - `link: same as magnet`.

### VLCService (`vlc.js`)

Spawns VLC as an external process for playback.

- `sanitizeInput(input)`:
  - Accepts either a string or some object with `link` or `l` properties.
  - Coerces to string, trims, replaces `&amp;` with `&`.
  - If input looks like a URL (`^[scheme]://`), attempts `encodeURI` to avoid breaking querystrings.
- `play(input)`:
  - Resolves the input to a normalized URL via `sanitizeInput`.
  - Picks VLC executable based on `process.platform`:
    - macOS: `/Applications/VLC.app/Contents/MacOS/VLC`.
    - Windows: `C:\\Program Files\\VideoLAN\\VLC\\vlc.exe`.
    - Else: `vlc` on PATH.
  - `spawn(command, ['--fullscreen', '--no-video-title-show', url], { detached: true, stdio: 'ignore' })`.
  - Calls `unref()` so Electron is not blocked.

## Renderer (React SPA)

Entry HTML: `src/renderer/index.html`.

- Sets CSP to restrict scripts/styles to self and inline styles; images to self+data.
- Loads React bundle with `<script type="module" src="/src/main.jsx"></script>`.

React entry: `src/renderer/src/main.jsx`.

- Imports `./assets/main.css` (Tailwind + app styles).
- Renders `<App />` under `#root` with `ReactDOM.createRoot` and `<StrictMode>`.

### App Component (`App.jsx`)

Overall responsibilities:

- Global layout and navigation between views (`search`, `library`, `history`, `downloads`).
- Orchestrate search, unlock, playback, and persistence flows.
- Manage toast notifications, status modal, settings modal, and download UI.

Key pieces of state:

- `results` – list of search results (from `window.api.search`).
- `files` – list of unlocked files for a selected magnet (`[{ filename, link }]`).
- `isLoading` – generic loading flag.
- `isSettingsOpen` – AllDebrid key modal visibility.
- `statusModal` – `{ message: string, type: 'loading' | 'success' | 'error' } | null`.
- `currentQuery` – user-visible search string.
- `view` – `'search' | 'library' | 'history' | 'downloads'`.
- `savedSearches`, `savedMagnets` – library data from `window.api`.
- `history` – watch history from `window.api.getHistory`.
- `toast` – transient toast message.
- `currentMagnet` – context for currently selected magnet (`{ hash, title, magnet, size, seeds, leeches }`).
- `isNavStuck` – sticky nav visual state.
- `activeDownloads` – live snapshot of downloads based on `download:progress` events.
- `isDownloadModalDismissed` – whether the overlay download manager has been manually hidden.
- `downloadHistory` – persisted download history via `window.api.getDownloadHistory`.
- `currentMediaCatalogTitle` – canonical title from media catalog suggestion when search includes an IMDb ID.

Initialization effects:

- On mount:
  - Fetch AllDebrid API key; if missing, open settings modal.
  - Load library, watch history, and download history.
  - Subscribe to `window.api.onDownloadProgress` to update `activeDownloads` and to re-show overlay when a new download begins (unless the user is on the Downloads tab).
- Listen to `window.scrollY` to toggle `isNavStuck`.

#### Search Flow

1. User types into `SearchBar` (see below) and submits.
2. `handleSearch(query)` in `App`:
   - Normalizes `originalQuery = query.trim()`.
   - Extracts an IMDb ID via `/tt\d{7,8}/i`; if present, uses that as `effectiveQuery`, else uses original string.
   - If an IMDb ID is present, calls `window.api.mediaSuggest(effectiveQuery, 1)` and stores `currentMediaCatalogTitle` from the first suggestion (if any).
   - Resets `results`, `files`, sets `currentQuery` to the full original string, sets view to `search`.
   - Shows `statusModal` with a loading message.
   - Calls `window.api.search(effectiveQuery)` (mapped to scraper service); stores `results`.
   - If no results, shows an error-style `statusModal`; otherwise hides it.

`SearchBar` provides autocomplete suggestions from the media catalog via `window.api.mediaSuggest`, manages keyboard navigation among suggestions, and lets users save the current `currentQuery` into saved searches.

#### Unlock and File Discovery Flow

When a user selects a search result (from search results or library):

1. `handleSelectResult(result)` runs.
   - Sets loading and switches view to `search`.
   - Shows a loading `statusModal` (`Unlocking "<title>"...`).
   - Derives a normalized magnet hash from the magnet URI (`btih:` parameter).
   - Sets `currentMagnet` with metadata for use in history and UI.
2. Tries a fast-path using the magnet ID cache:
   - Calls `window.api.getMagnetIdByHash(hash)`.
   - If an ID is found, calls `window.api.getStatusV41({ id })`.
   - If the magnet is ready (`m.statusCode === 4`), calls `window.api.getMagnetFiles([id])`.
   - Parses AllDebrid's nested file-tree structure (`m.files[].e[]`) via `flattenMagnetFilesResponse` into a flat list of `{ filename, link }` and stores in `files`.
   - If no files are returned, falls back to legacy v4 `getStatus` + `getFiles` (per-link unlock) using `extractLinksFromLegacyStatus` and `unlockLinksToFiles`.
3. If fast-path fails or there is no cached ID:
   - Calls `window.api.unlock(result.magnet)` (AllDebrid v4 magnet/upload).
   - On success, extracts `{ id: magnetId, ready }` from `data.magnets[0]`.
   - Persists this magnet ID by calling `window.api.setMagnetId(hash, magnetId)`.
   - If `ready === true`, goes through the same `getMagnetFiles` + flattening + fallback flow.
   - If `ready === false`, sets a `statusModal` message indicating that caching is still in progress.
4. On success with files:
   - Sets `files` and shows a success-type `StatusModal` (`Ready to play!`).
5. On error:
   - Shows an error-type `StatusModal` describing the failure.

#### Playback Flow

- When the user clicks "Play in VLC" for a file (inside `FileUserInterface`):
  - `handlePlay(url, filename)` is called.
  - Calls `window.api.play(url)`:
    - On the main side: tries to unlock the link via AllDebrid; if successful, uses the unlocked `data.link`; otherwise falls back to original URL.
    - Passes the resolved `playableUrl` to `vlc.play`.
  - If `currentMagnet` exists, calls `window.api.recordPlay(currentMagnet.hash, currentMagnet.title, filename, playableUrl)` and reloads history.

The History view can also replay `streamUrl` directly or reconstruct a magnet from `magnetHash` and re-run the unlock flow.

#### Downloads Flow

- Inside `FileUserInterface`:
  - "Download" for a single file:
    - Optionally resolves a hoster link to a direct URL via `window.api.resolve`.
    - Calls `window.api.download(url, { magnetTitle })` to track the source magnet.
  - "Download All":
    - Calls `window.api.selectFolder()` to choose a target folder.
    - Resolves each video file link via `window.api.resolve` and calls `window.api.download(url, { directory: folder, magnetTitle })`.

- Renderer listens to `onDownloadProgress` to maintain `activeDownloads`.
- `DownloadManager` has two modes:
  - Overlay (bottom-right popover) showing current downloads and allowing quick access (open folder, play file, hide overlay).
  - Full page view (`view === 'downloads'`) showing both active downloads and completed download history grouped by `magnetTitle`, with collapsible groups, the ability to clear or remove entries, and open/play files.

#### Library and History Views

- **Library (`Library` component):**
  - Two tabs: "My Library" (saved magnets) and "Saved Searches".
  - Filters items client-side by substring match.
  - Uses `onSearchSelect` to re-run a saved search via `handleSearch`.
  - Uses `onMagnetSelect` to re-run unlock flow on a saved magnet.
  - Each item can be removed from the store via `onRemoveSearch` / `onRemoveMagnet`.

- **History (`History` component):**
  - Lists history entries with summary (title, file count, last played date).
  - Each entry lists watched files with play counts and timestamps.
  - Controls allow:
    - Playing a `streamUrl` again.
    - Resetting a file's watched status (removing the file from the history entry, and removing the whole history entry when all files are removed).
    - Removing an entire entry.
    - Clearing all history.
    - Re-opening the file listing via `onViewMagnet` (reconstructs magnet URI from `magnetHash` and passes to `handleSelectResult`).

#### Settings and Status UI

- **SettingsModal** manages the AllDebrid API key through the preload bridge.
- **StatusModal** shows long-running or transient status messages (searching, unlocking, success, error) with auto-dismiss behaviors.
- **Toast** shows short-lived success/error notifications for library/history/download operations.

### SearchBar Component

Key behaviors:

- Maintains its own `query` string (not directly synced to `currentQuery` from `App`).
- Uses `window.api.mediaSuggest` with a small debounce (150 ms) and a request id to avoid race conditions.
- After receiving suggestions, fetches poster images via `window.api.getPosters(imdbIds)` for suggestions with IMDb IDs.
- Suggestion items include title, year, type, primary genre, runtime, IMDb rating, votes, and a poster image (48x64px) when available.
- Picking a suggestion formats a display string like `"Title (Year) [tt1234567]"` and passes it to `onSearch`.
- Provides a button to save the `currentQuery` (provided by `App`) as a saved search.

### FileUserInterface Component

Key behaviors:

- Filters `files` to video-like file extensions (`mp4`, `mkv`, `avi`, `mov`, `wmv`).
- Sorts results via natural sort on `filename`.
- Shows a list of video files with:
  - Watched indicator based on `watchedFiles` array.
  - Buttons to Play (calls `onPlay` from `App`), Download one, Download all, and Copy all direct links (resolved via `window.api.resolve`) to clipboard.
- Offers an "Add to Library" button that calls `onSave(magnetData)`.

## Build and Packaging

### NPM Scripts (`package.json`)

- `npm run dev` – Start dev environment via `electron-vite dev`.
- `npm run start` – Preview built app via `electron-vite preview`.
- `npm run build` – Build main, preload, and renderer bundles via `electron-vite build`.
- `npm run build:win` / `build:mac` / `build:linux` – Build platform-specific installers via `electron-builder`.
- `postinstall` – Install native dependencies via `electron-builder install-app-deps`.

### Electron Builder

- Configured via `electron-builder.yml` (not detailed here; responsible for bundling `media_catalog.db`, `posters.db`, and icons into `resources`).
- `builder.py` is a release helper that:
  - Optionally bumps version and tags releases.
  - Pushes a git tag of the form `v<version>`.
  - Relies on CI (GitHub Actions) to build installers for Windows, macOS, and Linux.

## External Dependencies & Assumptions

- **AllDebrid**: A valid API key must be provided by the user via the Settings modal. Without it, upload/unlock/resolve operations will fail.
- **VLC**: Must be installed at default locations:
  - macOS: `/Applications/VLC.app`.
  - Windows: `C:\\Program Files\\VideoLAN\\VLC\\vlc.exe`.
  - Linux: `vlc` accessible on PATH.
- **Network access**:
  - To `https://apibay.org` for torrent search.
  - To `https://api.alldebrid.com` for AllDebrid operations.
- **Local databases**:
  - `media_catalog.db` (bundled): SQLite database for media metadata and search suggestions.
  - `posters.db` (bundled): SQLite database for poster images mapped by IMDbID.

## Reimplementation Notes

When rebuilding this app from scratch, preserve these key contracts:

1. **IPC channel names and payloads** between renderer and main (`api:search`, `api:unlock`, `api:getStatusV41`, `api:getMagnetFiles`, `api:play`, `api:download`, etc.).
2. **`window.api` surface** exposed by the preload script, including method names and argument shapes.
3. **Persistent data model** in `electron-store` for saved searches, library entries, magnet ID map, history, and download history.
4. **Download queue semantics** (max 3 concurrent, queued state, progress events, and final history entry creation).
5. **Media catalog query behavior** so that search suggestions and canonical titles work the same way.
6. **Poster lookup behavior** using `posters.db` with IMDbID → webp BLOB mapping, returning base64 data URLs for display in the search suggestions UI.
7. **AllDebrid interactions**: use the same endpoints and response expectations, including v4.1 magnet/files and fallback to v4 link/unlock.
8. **VLC launching behavior** with platform-specific paths and URL sanitation.
9. **Overall UX flow**: search → select result → upload/unlock magnet → choose file → play or download → track history and download history.

As long as these contracts and flows are preserved, the UI components and internal implementation details can be refactored or replaced while maintaining app behavior.
