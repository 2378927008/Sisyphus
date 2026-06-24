# Language Settings Design

## Goal

Add three separate language controls to the local dictation app:

- Interface language: controls the app UI copy.
- Speech recognition language: controls the Whisper input language.
- Output language: controls the final text shown, saved, and pasted.

## Supported Languages

Interface language supports English, Simplified Chinese, Japanese, Korean, Traditional Chinese, French, Russian, and Spanish.

Speech recognition language supports Auto, English, Chinese, Japanese, Korean, French, Russian, and Spanish. Chinese is not split into simplified/traditional at recognition time.

Output language supports Keep original, English, Simplified Chinese, Japanese, Korean, Traditional Chinese, French, Russian, and Spanish.

## Defaults

- Interface language: Simplified Chinese.
- Speech recognition language: Auto.
- Output language: Keep original.

## Behavior

The dictation pipeline is:

1. Record audio.
2. Transcribe locally with Whisper.
3. Clean up or translate locally.
4. Show, save, and optionally paste the final output text.

When output language is Keep original, the existing local cleanup behavior remains available. When output language is a target language, the app asks local Ollama to produce the final text in that target language. If Ollama is disabled or unavailable, the app returns a clear local-only error instead of silently pretending to translate.

## UI

The settings panel will show three separate controls:

- Interface language
- Speech recognition language
- Output language

Changing interface language should update the visible UI immediately without clearing existing field values.

## Testing

Tests must cover default settings, invalid setting normalization, prompt construction for output translation, and an Electron UI smoke test that confirms Simplified Chinese is the default interface and the Start Recording flow still works.
