# dtts

Discord TTS bot using Pocket TTS (Kyutai). It joins a voice channel with `!join` and then reads all server messages aloud in that channel.

## Requirements
- Python 3.11+
- `ffmpeg` available on your PATH (required by Discord voice playback)
- Discord bot with Message Content intent enabled
- Access to the Pocket TTS model on Hugging Face (you may need to accept the model terms and set `HF_TOKEN`)

## Setup (uv)
```bash
uv sync
```

## Configure
Create or edit `.env` with:
```bash
DISCORD_TOKEN=your_bot_token_here
# Optional: choose a predefined voice (no cloning)
# POCKET_TTS_VOICE=alba
# Optional: override voice prompt (requires voice cloning access)
# POCKET_TTS_VOICE_PROMPT=hf://kyutai/tts-voices/alba-mackenna/casual.wav
# Optional: Hugging Face token if required
# HF_TOKEN=your_hf_token
```

## Run
```bash
uv run dtts
```

## Commands
- `!join` — join the caller’s voice channel and start reading all server messages.
- `!leave` — leave the voice channel.
- `!voice` — list available `.wav` voices in `voices/` and show usage.
- `!voice list` — list built-in voices and local `.wav` voices in `voices/`.
- `!voice <name>` — switch to a built-in voice or `voices/<name>.wav` if present.
- `!voice default` — reset to the default voice prompt.
