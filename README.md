# Meeting Recorder

A small Chromium extension (Brave, Chrome, Edge, Arc) that records browser calls with your mic and the other side on separate tracks, then transcribes them with You / Others labels.

No bot joins the call. No screen-share picker. Nothing leaves your machine until you press Transcribe.

## Why

Most meeting recorders either send a bot into the call or mix everyone into one audio file, which makes "who said what" a guessing game. This one records two tracks from the start:

- **You**: your microphone
- **Others**: the call tab's audio

Because the tracks are separate, speaker labels are exact, and you get stats that are useful for reviewing your own performance: talk share, your longest uninterrupted stretch, filler phrases, and a list of questions others asked.

## Features

- One-click popup: detects Google Meet, Zoom (web), Teams, Webex, Whereby, Discord
- Mic picker, remembered between sessions
- Recording continues with the popup closed; red REC badge on the icon
- Downloads: full mix, you only, others only (`.webm`, Opus)
- Transcription via Groq or OpenAI Whisper using your own API key
- Language picker per recording: auto-detect, English, or Indonesian (Bahasa Indonesia), with Indonesian and English filler words in the stats
- Per-recording word list so names and jargon are spelled right
- Loop guard: Whisper's repeated or low-confidence lines are marked `[inaudible]` instead of passed off as transcript
- Stats: words, talk time, turns, longest stretch, filler counts, questions from others
- Export transcript + stats as `.txt` or copy to clipboard

## Install

1. Download or clone this repo.
2. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder.
4. A tab opens asking for microphone access. Allow it once.
5. Pin the extension to your toolbar.

Keep the folder where it is. The browser loads the extension from that path, and moving it creates a new extension with an empty recordings list.

## Use

1. Join your call in a browser tab.
2. Click the extension icon, check the title and mic, add any names worth spelling right, press **Start recording**.
3. Click the icon again and press **Stop and save**. The recordings page opens.
4. Add an API key under **Transcription settings** (a free [Groq](https://console.groq.com) key works) and press **Transcribe**.

## Good to know

- **Browser calls only.** Desktop apps (Zoom, Teams desktop) aren't capturable. Use their web versions.
- **Headphones recommended.** They stop the other side leaking into your mic track.
- **Output device.** While recording, the call audio is played back through your system default output, not the speaker chosen inside the call app. Make your headphones the system default.
- **Mixed languages.** Auto-detect decides per track, so an Indonesian speaker talking to an English speaker works. If one person switches languages mid-sentence, pick their main language and put English terms and names in the word list. Whisper is weaker in Indonesian than in English, so check names.
- **"Others" is one track.** Everyone who isn't you is grouped together. Great for 1:1s, less so for large group calls.
- **File size.** Whisper APIs accept up to 25 MB per file, which is roughly 2+ hours per track at the bitrate used here.

## Privacy

- Recordings and transcripts are stored locally in the extension's IndexedDB.
- Audio is sent only to the transcription provider you choose, only when you press Transcribe.
- Your API key is stored in `chrome.storage.local` on your machine. It is not encrypted, so don't use this on a shared computer.
- Host permissions are limited to `api.groq.com` and `api.openai.com`.

## Consent

Recording laws differ by country and state, and some require everyone's consent. The other participants get no notification from this extension, so **tell them you're recording**. You're responsible for how you use it.

## How it works

`chrome.tabCapture` produces a stream ID for the active tab, which an offscreen document consumes alongside `getUserMedia` for the mic. Three `MediaRecorder`s write the mix, the mic, and the tab audio. Each track is transcribed separately with Whisper `verbose_json`, then merged by timestamp.

## License

MIT
