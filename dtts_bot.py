import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass
from typing import Optional

import discord
from discord.ext import commands
from dotenv import load_dotenv
from pocket_tts import TTSModel
from scipy.io.wavfile import write as write_wav


VOICE_PROMPT_DEFAULT = "alba"
MAX_QUEUE_SIZE = 100
MAX_MESSAGE_CHARS = 220


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("dtts")


@dataclass
class GuildTTSState:
    queue: asyncio.Queue
    voice_client: Optional[discord.VoiceClient] = None
    worker: Optional[asyncio.Task] = None


class TTSManager:
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._model: Optional[TTSModel] = None
        self._voice_state = None
        self._guilds: dict[int, GuildTTSState] = {}

    async def ensure_model(self) -> None:
        if self._model is not None:
            logger.debug("Pocket TTS model already loaded.")
            return
        logger.info("Loading Pocket TTS model...")
        self._model = TTSModel.load_model()
        voice_prompt = (
            os.getenv("POCKET_TTS_VOICE")
            or os.getenv("POCKET_TTS_VOICE_PROMPT")
            or VOICE_PROMPT_DEFAULT
        )
        logger.info("Using voice prompt: %s", voice_prompt)
        try:
            self._voice_state = self._model.get_state_for_audio_prompt(voice_prompt)
        except ValueError as exc:
            if "voice cloning" in str(exc).lower() and voice_prompt != VOICE_PROMPT_DEFAULT:
                logger.warning(
                    "Voice prompt requires voice cloning; falling back to '%s'.",
                    VOICE_PROMPT_DEFAULT,
                )
                self._voice_state = self._model.get_state_for_audio_prompt(VOICE_PROMPT_DEFAULT)
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

    @bot.event
    async def on_message(message: discord.Message) -> None:
        if message.author.bot or not message.guild:
            return

        if message.content.startswith("!join") or message.content.startswith("!leave"):
            await bot.process_commands(message)
            return

        state = tts_manager.get_guild_state(message.guild.id)
        if not state.voice_client or not state.voice_client.is_connected():
            await bot.process_commands(message)
            return

        content = discord.utils.escape_mentions(message.content.strip())
        if not content:
            await bot.process_commands(message)
            return

        if len(content) > MAX_MESSAGE_CHARS:
            content = content[: MAX_MESSAGE_CHARS - 1] + "…"

        text = f"{message.author.display_name} says: {content}"
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
