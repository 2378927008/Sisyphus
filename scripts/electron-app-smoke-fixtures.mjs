export const appSmokeFixtureSettings = Object.freeze({
  hotkey: "CommandOrControl+Alt+Space",
  pasteAfterTranscribe: false,
  whisperCliPath: "C:\\smoke\\whisper-cli.exe",
  whisperModelPath: "C:\\smoke\\ggml-base.bin"
});

export function createAppSmokeHistoryFixtures() {
  return [
    {
      createdAt: "2026-07-11T04:00:00.000Z",
      transcript: "Legacy history source",
      status: "complete",
      text: "Legacy history entry"
    },
    {
      id: "history-zh",
      createdAt: "2026-07-11T03:00:00.000Z",
      status: "complete",
      text: "中文历史记录"
    },
    {
      id: "history-en",
      createdAt: "2026-07-11T02:00:00.000Z",
      status: "complete",
      text: "English history entry"
    },
    {
      id: "history-failed",
      createdAt: "2026-07-11T01:00:00.000Z",
      status: "failed",
      text: "",
      processingError: "spawn C:\\private\\history-helper.exe ENOENT"
    },
    {
      id: "history-emoji",
      createdAt: "2026-07-11T00:00:00.000Z",
      status: "complete",
      text: "Emoji history entry 🎤"
    }
  ];
}
