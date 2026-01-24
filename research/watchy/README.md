<p align="center">
<img src="src/renderer/src/assets/logo.png" alt="Watchy Logo" width="200">
</p>

# Watchy

**Watchy** helps you watch your favorites!

## Features

- **Integrated Search**: Search P2P networks directly from the app.
- **Instant Caching**: Automatically uploads magnet links to AllDebrid for high-speed caching.
- **Direct Streaming**: Unlocks AllDebrid video files and streams them directly to VLC Media Player.
- **Download Support**: Download unlocked files directly to your device.
- **Personal Library**: Build a library of your favorite searches and magnet links.
- **Play History**: Track your watched content with file-level resume functionality.
- **Modern UI**: A sleek, responsive interface designed for a premium user experience.

## Prerequisites

Before running Watchy, ensure you have the following:

1.  **AllDebrid API Key**: You need an active AllDebrid account and API key.
    - Get your key here: [AllDebrid API Keys](https://alldebrid.com/apikeys)
2.  **VLC Media Player**: Watchy relies on VLC for playback.
    - **macOS**: `/Applications/VLC.app`
    - **Windows**: `C:\Program Files\VideoLAN\VLC\vlc.exe`
    - **Linux**: `vlc` must be available on your `PATH` (typically `/usr/bin/vlc`)

## Installation

Visit our releases page and download the app for your platform:

- **Windows**: Download the `.exe` NSIS installer and run it.

- **Linux (recommended)**: Download the `.AppImage`, then:

```bash
chmod +x watchy-*-linux.AppImage
./watchy-*-linux.AppImage
```

Mac users will need to run...

```bash
sudo xattr -cr /Applications/watchy.app
```

...once the app is installed

## Usage

### Development

To start the application in development mode:

```bash
npm run dev
```

### Building for Production

Installers are built on GitHub Actions (not on your local machine). To cut a release:

```bash
uv run builder.py
```

By default, `builder.py` will:

- (Optionally) bump the version and push the commit
- Create and push a git tag like `v0.0.29`

That tag triggers GitHub Actions to build the Windows `.exe`, macOS `.dmg`, and the Linux `.AppImage`, and upload them to the GitHub Release.

If you _do_ want to build installers locally (for testing), answer `y` when prompted.

On Linux, the default local build script produces an AppImage:

```bash
npm run build:linux
```

## Troubleshooting

- **VLC not opening?** Ensure VLC is installed in the default system location.
- **No search results?** The scraper may be blocked by your ISP or the source site might be down.
- **Unlock failed?** Verify your AllDebrid API key and subscription status. If the file is not cached you may just need to try again later. You can view the AllDebrid cache download status in your account page on AllDebrid.
- **macOS Damaged Error?** Try running...

```bash
sudo xattr -cr /Applications/watchy.app
```

...or adjust to wherever you have watchy installed.

### LICENSE

Copyright 2025 Jared De Blander

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
