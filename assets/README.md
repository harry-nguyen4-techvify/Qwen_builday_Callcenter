# Assets

## `hold-music.mp3`

Hold music played by the voice agent (via LiveKit `BackgroundAudioPlayer`)
when the `escalate` tool is invoked for the `report_lost_card` scenario.

**The file is NOT checked in.** Drop your chosen MP3 at:

```
assets/hold-music.mp3
```

- Any royalty-free track works (Bensound, FMA, Pixabay, YouTube Audio Library).
- Recommended: 30–120 seconds, loopable, instrumental, no voice.
- `BackgroundAudioPlayer` loops the file via `play(path, loop=True)`.
- Override the path via env var `HOLD_MUSIC_PATH` if you prefer a different location.

If the file does not exist at runtime the agent will log a warning and
escalate silently — the LiveKit room stays active but no music plays.
