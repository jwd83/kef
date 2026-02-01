import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote

import discord
import requests
from discord.ext import commands
from dotenv import load_dotenv
from pocket_tts import TTSModel
from scipy.io.wavfile import write as write_wav


VOICE_PROMPT_DEFAULT = "alba"
BUILTIN_VOICES = [
    "alba",
    "marius",
    "javert",
    "jean",
    "fantine",
    "cosette",
    "eponine",
    "azelma",
]
VOICES_DIR = Path(__file__).resolve().parent / "voices"
MAX_QUEUE_SIZE = 100
MAX_MESSAGE_CHARS = 220
MAGNET_DB_PATH = Path(__file__).resolve().parent / "magnets.json"
APIBAY_URL = "https://apibay.org"
ALLDEBRID_URL = "https://api.alldebrid.com/v4"
ALLDEBRID_URL_V41 = "https://api.alldebrid.com/v4.1"
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg"}

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("dtts")
URL_RE = re.compile(r"(?i)\b(?:https?://|www\.|discord\.gg/|discord\.com/invite/)\S+")


@dataclass
class GuildTTSState:
    queue: asyncio.Queue
    voice_client: Optional[discord.VoiceClient] = None
    worker: Optional[asyncio.Task] = None
    last_speaker_by_channel: dict[int, int] = field(default_factory=dict)


class MagnetDatabase:
    """Simple JSON-based database for tracking magnets with m-numbers."""

    def __init__(self, path: Path = MAGNET_DB_PATH) -> None:
        self.path = path
        self._data: dict = {"next_id": 1, "magnets": {}}
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
                logger.info("Loaded magnet database with %d entries.", len(self._data.get("magnets", {})))
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load magnet database: %s", e)
                self._data = {"next_id": 1, "magnets": {}}

    def _save(self) -> None:
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)
        except OSError as e:
            logger.error("Failed to save magnet database: %s", e)

    def _extract_hash(self, magnet: str) -> Optional[str]:
        """Extract info hash from magnet link."""
        match = re.search(r"btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})", magnet)
        return match.group(1).lower() if match else None

    def get_or_create(self, magnet: str, name: str, seeders: int, leechers: int, size: str) -> int:
        """Get existing m-number for magnet or create a new one."""
        info_hash = self._extract_hash(magnet)
        if not info_hash:
            return -1

        magnets = self._data.get("magnets", {})
        for m_num, entry in magnets.items():
            if entry.get("hash") == info_hash:
                return int(m_num)

        m_num = self._data["next_id"]
        self._data["next_id"] = m_num + 1
        self._data["magnets"][str(m_num)] = {
            "hash": info_hash,
            "name": name,
            "magnet": magnet,
            "seeders": seeders,
            "leechers": leechers,
            "size": size,
            "alldebrid_id": None,
        }
        self._save()
        return m_num

    def get_by_m_number(self, m_num: int) -> Optional[dict]:
        """Get magnet entry by m-number."""
        return self._data.get("magnets", {}).get(str(m_num))

    def update_alldebrid_id(self, m_num: int, ad_id: int) -> None:
        """Store the AllDebrid magnet ID for an m-number."""
        magnets = self._data.get("magnets", {})
        if str(m_num) in magnets:
            magnets[str(m_num)]["alldebrid_id"] = ad_id
            self._save()


class AllDebridService:
    """Service for interacting with AllDebrid API."""

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.agent = "kef-discord-bot"

    async def upload_magnet(self, magnet: str) -> dict:
        """Upload a magnet to AllDebrid."""
        def _request():
            resp = requests.get(
                f"{ALLDEBRID_URL}/magnet/upload",
                params={"agent": self.agent, "apikey": self.api_key, "magnets": magnet},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        return await asyncio.to_thread(_request)

    async def get_status(self, magnet_id: int) -> dict:
        """Get status of a magnet by its AllDebrid ID."""
        def _request():
            headers = {"Authorization": f"Bearer {self.api_key}"}
            form = {"id": str(magnet_id)}
            resp = requests.post(
                f"{ALLDEBRID_URL_V41}/magnet/status",
                data=form,
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        return await asyncio.to_thread(_request)

    async def get_files(self, magnet_id: int) -> dict:
        """Get files for a magnet by its AllDebrid ID."""
        def _request():
            headers = {"Authorization": f"Bearer {self.api_key}"}
            resp = requests.post(
                f"{ALLDEBRID_URL_V41}/magnet/files",
                data={"id[]": str(magnet_id)},
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        return await asyncio.to_thread(_request)

    async def unlock_link(self, link: str) -> dict:
        """Unlock a host link to get a direct playable URL."""
        def _request():
            resp = requests.get(
                f"{ALLDEBRID_URL}/link/unlock",
                params={"agent": self.agent, "apikey": self.api_key, "link": link},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        return await asyncio.to_thread(_request)


class ScraperService:
    """Service for searching API Bay."""

    @staticmethod
    def format_size(size_bytes: int) -> str:
        if size_bytes == 0:
            return "0 B"
        k = 1024
        sizes = ["B", "KB", "MB", "GB", "TB"]
        i = int(size_bytes.bit_length() - 1) // 10
        i = min(i, len(sizes) - 1)
        return f"{size_bytes / (k ** i):.2f} {sizes[i]}"

    async def search(self, query: str) -> list[dict]:
        """Search API Bay for torrents."""
        sanitized = re.sub(r"'", " ", query)
        sanitized = re.sub(r"\s+", " ", sanitized).strip()
        logger.info("Searching API Bay for: %s", sanitized)

        def _request():
            url = f"{APIBAY_URL}/q.php"
            resp = requests.get(url, params={"q": sanitized, "cat": "0"}, timeout=30)
            resp.raise_for_status()
            return resp.json()

        try:
            results = await asyncio.to_thread(_request)
        except requests.RequestException as e:
            logger.error("API Bay search error: %s", e)
            return []

        if not results or (results[0].get("name") == "No results returned"):
            return []

        transformed = []
        for item in results:
            info_hash = item.get("info_hash", "")
            name = item.get("name", "Unknown")
            magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(name)}"
            transformed.append({
                "name": name,
                "magnet": magnet,
                "seeders": int(item.get("seeders", 0)),
                "leechers": int(item.get("leechers", 0)),
                "size": self.format_size(int(item.get("size", 0))),
            })
        return transformed


class TTSManager:
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._model: Optional[TTSModel] = None
        self._voice_state = None
        self._voice_prompt = (
            os.getenv("POCKET_TTS_VOICE")
            or os.getenv("POCKET_TTS_VOICE_PROMPT")
            or VOICE_PROMPT_DEFAULT
        )
        self._guilds: dict[int, GuildTTSState] = {}

    async def ensure_model(self) -> None:
        if self._model is not None:
            logger.debug("Pocket TTS model already loaded.")
            return
        logger.info("Loading Pocket TTS model...")
        self._model = TTSModel.load_model()
        logger.info("Using voice prompt: %s", self._voice_prompt)
        try:
            self._voice_state = self._model.get_state_for_audio_prompt(self._voice_prompt)
        except ValueError as exc:
            if "voice cloning" in str(exc).lower() and self._voice_prompt != VOICE_PROMPT_DEFAULT:
                logger.warning(
                    "Voice prompt requires voice cloning; falling back to '%s'.",
                    VOICE_PROMPT_DEFAULT,
                )
                self._voice_prompt = VOICE_PROMPT_DEFAULT
                self._voice_state = self._model.get_state_for_audio_prompt(self._voice_prompt)
            else:
                raise
        logger.info("Pocket TTS model loaded.")

    def get_guild_state(self, guild_id: int) -> GuildTTSState:
        state = self._guilds.get(guild_id)
        if state is None:
            state = GuildTTSState(queue=asyncio.Queue(maxsize=MAX_QUEUE_SIZE))
            self._guilds[guild_id] = state
        return state

    async def enqueue(self, guild_id: int, text: str) -> None:
        state = self.get_guild_state(guild_id)
        if state.queue.full():
            logger.warning("Queue full for guild %s; dropping message.", guild_id)
            return
        await state.queue.put(text)
        logger.debug("Enqueued message for guild %s (queue size=%s).", guild_id, state.queue.qsize())

    async def synthesize_to_wav(self, text: str) -> str:
        await self.ensure_model()
        assert self._model is not None
        assert self._voice_state is not None
        logger.debug("Synthesizing text (%s chars).", len(text))

        def _run_tts() -> tuple[int, list[float]]:
            audio = self._model.generate_audio(self._voice_state, text)
            audio = audio.cpu()
            return self._model.sample_rate, audio.numpy()

        sample_rate, audio = await asyncio.to_thread(_run_tts)
        logger.debug("Generated audio at %s Hz.", sample_rate)

        fd, path = tempfile.mkstemp(prefix="dtts_", suffix=".wav")
        os.close(fd)
        write_wav(path, sample_rate, audio)
        return path

    async def set_voice_prompt(self, voice_prompt: str) -> None:
        await self.ensure_model()
        assert self._model is not None
        self._voice_prompt = voice_prompt
        self._voice_state = self._model.get_state_for_audio_prompt(self._voice_prompt)
        logger.info("Updated voice prompt to: %s", self._voice_prompt)

    async def play_wav(self, voice_client: discord.VoiceClient, path: str) -> None:
        done = asyncio.Event()
        logger.debug("Playing wav: %s", path)

        def _after_play(err: Optional[Exception]) -> None:
            if err:
                logger.error("Audio playback error: %s", err)
            self.bot.loop.call_soon_threadsafe(done.set)

        source = discord.FFmpegPCMAudio(path)
        voice_client.play(source, after=_after_play)
        await done.wait()
        try:
            os.remove(path)
        except OSError:
            logger.warning("Failed to delete temp wav: %s", path)

    async def start_worker(self, guild_id: int) -> None:
        state = self.get_guild_state(guild_id)
        if state.worker and not state.worker.done():
            logger.debug("Worker already running for guild %s.", guild_id)
            return

        async def _worker() -> None:
            while True:
                text = await state.queue.get()
                try:
                    if not state.voice_client or not state.voice_client.is_connected():
                        continue
                    wav_path = await self.synthesize_to_wav(text)
                    await self.play_wav(state.voice_client, wav_path)
                except Exception as exc:
                    logger.exception("Worker error: %s", exc)
                finally:
                    state.queue.task_done()

        state.worker = asyncio.create_task(_worker())


def build_bot() -> commands.Bot:
    intents = discord.Intents.default()
    intents.message_content = True
    intents.messages = True
    intents.guilds = True
    intents.voice_states = True

    bot = commands.Bot(command_prefix="!", intents=intents)
    tts_manager = TTSManager(bot)

    try:
        discord.opus.load_opus("libopus")
        logger.info("Loaded Opus library (libopus).")
    except Exception as exc:
        logger.warning("Failed to load Opus library via libopus: %s", exc)
        brew_opus = "/opt/homebrew/opt/opus/lib/libopus.dylib"
        if os.path.exists(brew_opus):
            try:
                discord.opus.load_opus(brew_opus)
                logger.info("Loaded Opus library from %s.", brew_opus)
            except Exception as exc2:
                logger.warning("Failed to load Opus library from %s: %s", brew_opus, exc2)
        logger.warning("Install Opus (e.g., `brew install opus` on macOS).")

    @bot.event
    async def on_ready() -> None:
        logger.info("Logged in as %s", bot.user)
        logger.info("Intents: message_content=%s, messages=%s, guilds=%s, voice_states=%s",
                    bot.intents.message_content, bot.intents.messages, bot.intents.guilds, bot.intents.voice_states)

    @bot.command(name="join")
    async def join_voice(ctx: commands.Context) -> None:
        if not ctx.guild or not ctx.author.voice or not ctx.author.voice.channel:
            await ctx.send("Join a voice channel first.")
            return
        channel = ctx.author.voice.channel
        state = tts_manager.get_guild_state(ctx.guild.id)
        if state.voice_client and state.voice_client.is_connected():
            await state.voice_client.move_to(channel)
            logger.info("Moved voice client to %s (guild %s).", channel.name, ctx.guild.id)
        else:
            state.voice_client = await channel.connect()
            logger.info("Connected voice client to %s (guild %s).", channel.name, ctx.guild.id)
        await tts_manager.start_worker(ctx.guild.id)
        await ctx.send(f"Joined {channel.name} and listening.")

    @bot.command(name="leave")
    async def leave_voice(ctx: commands.Context) -> None:
        if not ctx.guild:
            return
        state = tts_manager.get_guild_state(ctx.guild.id)
        if state.voice_client:
            await state.voice_client.disconnect()
            state.voice_client = None
            logger.info("Disconnected voice client (guild %s).", ctx.guild.id)
            await ctx.send("Left the voice channel.")

    def _sanitize_tts_text(message: discord.Message) -> str:
        content = message.clean_content.strip()
        if not content:
            return ""
        content = URL_RE.sub("link", content)
        return discord.utils.escape_mentions(content)

    def _available_voices() -> list[str]:
        if not VOICES_DIR.exists():
            return []
        return sorted(path.stem for path in VOICES_DIR.glob("*.wav"))

    def _resolve_voice_prompt(name: str) -> tuple[str, str]:
        if name == "default":
            return VOICE_PROMPT_DEFAULT, "default"
        if not VOICES_DIR.exists():
            return name, "builtin"
        for path in VOICES_DIR.glob("*.wav"):
            if path.stem.lower() == name:
                return str(path), "local"
        return name, "builtin"

    @bot.command(name="voice")
    async def set_voice(ctx: commands.Context, *, voice_name: Optional[str] = None) -> None:
        if voice_name is None or voice_name.strip().lower() == "list":
            voices = _available_voices()
            builtins = ", ".join(BUILTIN_VOICES)
            local = ", ".join(voices) if voices else "none"
            await ctx.send(
                "Built-in voices: "
                + builtins
                + ". Local voices: "
                + local
                + ". Use `!voice <name>` or `!voice default`."
            )
            return

        voice_key = voice_name.strip().lower()
        prompt, source = _resolve_voice_prompt(voice_key)

        try:
            await tts_manager.set_voice_prompt(prompt)
        except ValueError as exc:
            if source == "local" and "voice cloning" in str(exc).lower():
                await ctx.send("That voice requires cloning access. Try `!voice default`.")
                return
            if source == "builtin":
                await ctx.send(
                    "Unknown built-in voice or not available. "
                    "Use `!voice` to list local voices or `!voice default`."
                )
                return
            raise

        if prompt == VOICE_PROMPT_DEFAULT:
            await ctx.send("Voice reset to default.")
        elif source == "builtin":
            await ctx.send(f"Voice set to built-in '{voice_key}'.")
        else:
            await ctx.send(f"Voice set to '{voice_key}'.")

    # Initialize services for search/open/play commands
    magnet_db = MagnetDatabase()
    scraper = ScraperService()
    alldebrid_api_key = os.getenv("ALLDEBRID_API_KEY")
    alldebrid = AllDebridService(alldebrid_api_key) if alldebrid_api_key else None

    # Store last opened magnet files per guild for !play command
    last_opened_files: dict[int, dict] = {}

    def _parse_m_number(arg: str) -> Optional[int]:
        """Parse an m-number from a string like 'm5' or '5'."""
        arg = arg.strip().lower()
        if arg.startswith("m"):
            arg = arg[1:]
        try:
            return int(arg)
        except ValueError:
            return None

    def _is_magnet(arg: str) -> bool:
        """Check if argument is a magnet link."""
        return arg.strip().lower().startswith("magnet:")

    def _extract_video_files(files_data: list, path: str = "") -> list[dict]:
        """Recursively extract video files from AllDebrid files structure."""
        videos = []
        for item in files_data:
            if "e" in item:  # It's a folder with sub-entries
                folder_name = item.get("n", "")
                sub_path = f"{path}/{folder_name}" if path else folder_name
                videos.extend(_extract_video_files(item["e"], sub_path))
            elif "l" in item:  # It's a file with a link
                filename = item.get("n", "")
                ext = Path(filename).suffix.lower()
                if ext in VIDEO_EXTENSIONS:
                    videos.append({
                        "name": filename,
                        "link": item["l"],
                        "size": item.get("s", 0),
                        "path": f"{path}/{filename}" if path else filename,
                    })
        return videos

    @bot.command(name="search")
    async def search_torrents(ctx: commands.Context, *, query: str) -> None:
        """Search API Bay for torrents. Usage: !search <query>"""
        await ctx.send(f"Searching for: {query}...")

        results = await scraper.search(query)
        if not results:
            await ctx.send("No results found.")
            return

        # Limit to 10 results
        results = results[:10]

        lines = ["**Search Results:**"]
        for r in results:
            m_num = magnet_db.get_or_create(
                magnet=r["magnet"],
                name=r["name"],
                seeders=r["seeders"],
                leechers=r["leechers"],
                size=r["size"],
            )
            # Truncate long names for display
            name = r["name"][:60] + "..." if len(r["name"]) > 60 else r["name"]
            lines.append(f"**m{m_num}** | {name} | {r['size']} | S:{r['seeders']} L:{r['leechers']}")

        # Discord has a 2000 char limit, split if needed
        message = "\n".join(lines)
        if len(message) > 1900:
            for i in range(0, len(lines), 5):
                chunk = "\n".join(lines[i:i+5])
                await ctx.send(chunk)
        else:
            await ctx.send(message)

    @bot.command(name="open")
    async def open_magnet(ctx: commands.Context, *, arg: str) -> None:
        """Open a magnet via AllDebrid. Usage: !open <m-number> or !open <magnet link>"""
        if not alldebrid:
            await ctx.send("AllDebrid API key not configured.")
            return

        # Determine if arg is an m-number or a magnet link
        magnet = None
        m_num = None

        if _is_magnet(arg):
            magnet = arg.strip()
        else:
            m_num = _parse_m_number(arg)
            if m_num is None:
                await ctx.send("Invalid argument. Use an m-number (e.g., m5) or a magnet link.")
                return
            entry = magnet_db.get_by_m_number(m_num)
            if not entry:
                await ctx.send(f"m{m_num} not found. Use !search first.")
                return
            magnet = entry["magnet"]

        await ctx.send("Unlocking magnet via AllDebrid...")

        try:
            # Upload magnet to AllDebrid
            upload_result = await alldebrid.upload_magnet(magnet)
            if upload_result.get("status") != "success":
                error = upload_result.get("error", {}).get("message", "Unknown error")
                await ctx.send(f"Failed to upload magnet: {error}")
                return

            magnets_data = upload_result.get("data", {}).get("magnets", [])
            if not magnets_data:
                await ctx.send("No magnet data returned from AllDebrid.")
                return

            ad_magnet = magnets_data[0]
            ad_id = ad_magnet.get("id")
            ready = ad_magnet.get("ready", False)

            # Update database with AllDebrid ID if we have an m-number
            if m_num is not None:
                magnet_db.update_alldebrid_id(m_num, ad_id)

            if not ready:
                await ctx.send(f"Magnet uploaded (ID: {ad_id}). Status: Processing... Check back later.")
                return

            # Get files
            files_result = await alldebrid.get_files(ad_id)
            if files_result.get("status") != "success":
                error = files_result.get("error", {}).get("message", "Unknown error")
                await ctx.send(f"Failed to get files: {error}")
                return

            magnets_files = files_result.get("data", {}).get("magnets", [])
            if not magnets_files:
                await ctx.send("No files found in magnet.")
                return

            files_data = magnets_files[0].get("files", [])
            videos = _extract_video_files(files_data)

            if not videos:
                await ctx.send("No video files found in this magnet.")
                return

            # Store for !play command
            guild_id = ctx.guild.id if ctx.guild else 0
            last_opened_files[guild_id] = {
                "ad_id": ad_id,
                "videos": videos,
                "m_num": m_num,
            }

            lines = [f"**Videos in magnet** (ID: {ad_id}):"]
            for i, v in enumerate(videos, 1):
                size_str = ScraperService.format_size(v["size"]) if v["size"] else "?"
                name = v["name"][:50] + "..." if len(v["name"]) > 50 else v["name"]
                lines.append(f"**{i}.** {name} ({size_str})")

            message = "\n".join(lines)
            if len(message) > 1900:
                for i in range(0, len(lines), 10):
                    chunk = "\n".join(lines[i:i+10])
                    await ctx.send(chunk)
            else:
                await ctx.send(message)

        except requests.RequestException as e:
            logger.error("AllDebrid API error: %s", e)
            await ctx.send(f"AllDebrid API error: {e}")

    @bot.command(name="play")
    async def play_video(ctx: commands.Context, arg: str, file_num: Optional[int] = None) -> None:
        """Play a video from an opened magnet. Usage: !play <m-number> [file_number]"""
        if not alldebrid:
            await ctx.send("AllDebrid API key not configured.")
            return

        guild_id = ctx.guild.id if ctx.guild else 0

        # Check if arg is an m-number or magnet
        videos = None
        ad_id = None

        if _is_magnet(arg):
            # Need to open the magnet first
            await ctx.send("Opening magnet first...")
            try:
                upload_result = await alldebrid.upload_magnet(arg)
                if upload_result.get("status") != "success":
                    await ctx.send("Failed to upload magnet.")
                    return

                magnets_data = upload_result.get("data", {}).get("magnets", [])
                if not magnets_data or not magnets_data[0].get("ready"):
                    await ctx.send("Magnet not ready yet. Try again later.")
                    return

                ad_id = magnets_data[0]["id"]
                files_result = await alldebrid.get_files(ad_id)
                if files_result.get("status") != "success":
                    await ctx.send("Failed to get files.")
                    return

                magnets_files = files_result.get("data", {}).get("magnets", [])
                if magnets_files:
                    files_data = magnets_files[0].get("files", [])
                    videos = _extract_video_files(files_data)
            except requests.RequestException as e:
                await ctx.send(f"API error: {e}")
                return
        else:
            m_num = _parse_m_number(arg)
            if m_num is None:
                await ctx.send("Invalid argument. Use an m-number or magnet link.")
                return

            # Check if this is the last opened magnet
            last = last_opened_files.get(guild_id)
            if last and last.get("m_num") == m_num:
                videos = last["videos"]
                ad_id = last["ad_id"]
            else:
                # Need to open it first
                entry = magnet_db.get_by_m_number(m_num)
                if not entry:
                    await ctx.send(f"m{m_num} not found. Use !search first.")
                    return

                ad_id = entry.get("alldebrid_id")
                if not ad_id:
                    await ctx.send(f"m{m_num} hasn't been opened yet. Use !open m{m_num} first.")
                    return

                try:
                    files_result = await alldebrid.get_files(ad_id)
                    if files_result.get("status") != "success":
                        await ctx.send("Failed to get files from AllDebrid.")
                        return

                    magnets_files = files_result.get("data", {}).get("magnets", [])
                    if magnets_files:
                        files_data = magnets_files[0].get("files", [])
                        videos = _extract_video_files(files_data)
                except requests.RequestException as e:
                    await ctx.send(f"API error: {e}")
                    return

        if not videos:
            await ctx.send("No video files available.")
            return

        # Default to first file
        file_idx = (file_num or 1) - 1
        if file_idx < 0 or file_idx >= len(videos):
            await ctx.send(f"Invalid file number. Choose 1-{len(videos)}.")
            return

        video = videos[file_idx]
        await ctx.send(f"Unlocking: {video['name']}...")

        try:
            unlock_result = await alldebrid.unlock_link(video["link"])
            if unlock_result.get("status") != "success":
                error = unlock_result.get("error", {}).get("message", "Unknown error")
                await ctx.send(f"Failed to unlock link: {error}")
                return

            stream_url = unlock_result.get("data", {}).get("link")
            if not stream_url:
                await ctx.send("No stream URL returned.")
                return

            # Launch VLC
            await ctx.send(f"Launching VLC for: {video['name']}")
            vlc_path = r"C:\Program Files\VideoLAN\VLC\vlc.exe"
            if not Path(vlc_path).exists():
                vlc_path = "vlc"  # Try PATH

            subprocess.Popen(
                [vlc_path, "--fullscreen", "--no-video-title-show", stream_url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        except requests.RequestException as e:
            await ctx.send(f"API error: {e}")
        except FileNotFoundError:
            await ctx.send("VLC not found. Make sure VLC is installed.")

    def _find_user_voice_guild(user: discord.User) -> Optional[int]:
        """Find the guild ID where the user is in a voice channel with the bot."""
        for guild_id, state in tts_manager._guilds.items():
            if not state.voice_client or not state.voice_client.is_connected():
                continue
            voice_channel = state.voice_client.channel
            if voice_channel and user.id in [m.id for m in voice_channel.members]:
                return guild_id
        return None

    @bot.event
    async def on_message(message: discord.Message) -> None:
        if message.author.bot:
            return

        # Handle DMs: read them in the voice channel the user is in
        if not message.guild:
            guild_id = _find_user_voice_guild(message.author)
            if guild_id is None:
                return
            state = tts_manager.get_guild_state(guild_id)
            if not state.voice_client or not state.voice_client.is_connected():
                return
            content = _sanitize_tts_text(message)
            if not content:
                return
            if len(content) > MAX_MESSAGE_CHARS:
                content = content[: MAX_MESSAGE_CHARS - 1] + "…"
            # Always include user name for DMs to prevent spoofing
            text = f"{message.author.name} says: {content}"
            logger.debug("Queueing DM from %s in guild %s.", message.author.name, guild_id)
            await tts_manager.enqueue(guild_id, text)
            return

        if message.content.startswith("!join") or message.content.startswith("!leave"):
            await bot.process_commands(message)
            return

        state = tts_manager.get_guild_state(message.guild.id)
        if not state.voice_client or not state.voice_client.is_connected():
            await bot.process_commands(message)
            return

        content = _sanitize_tts_text(message)
        if not content:
            await bot.process_commands(message)
            return

        if len(content) > MAX_MESSAGE_CHARS:
            content = content[: MAX_MESSAGE_CHARS - 1] + "…"

        last_speaker = state.last_speaker_by_channel.get(message.channel.id)
        if last_speaker == message.author.id:
            text = content
        else:
            text = f"{message.author.display_name} says: {content}"
            state.last_speaker_by_channel[message.channel.id] = message.author.id
        logger.debug("Queueing message from %s in guild %s.", message.author.display_name, message.guild.id)
        await tts_manager.enqueue(message.guild.id, text)
        await bot.process_commands(message)

    return bot


def main() -> None:
    load_dotenv()
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit("DISCORD_TOKEN is not set.")
    logger.info("Starting dtts bot.")
    bot = build_bot()
    bot.run(token)


if __name__ == "__main__":
    main()
