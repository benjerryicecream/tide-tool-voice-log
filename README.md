# Tide & Tool — Voice Log

A voice work log for a one-man handyman business in Hawaii. Big buttons, dark screen, no account, no server. Everything stays on the phone.

Built for the AutoClaw Round 3 contest, SMB track.

- **Record a voice note** on the job site — one big button, live transcript while you talk.
- **Import a call recording** from the phone (Samsung Phone app, manual record during a call). It is transcribed **on the device** with Whisper (`whisper-tiny.en`) via transformers.js. The audio never uploads.
- **Caller ID from the file name.** A small phone book of clients (name + number). Samsung names call files `Call_YYYYMMDD_HHMMSS_<number or name>.m4a`; on import the number is matched against the phone book and the client fills itself in. Unknown caller? One tap adds them, number pre-filled. Matching ignores spaces, dashes, brackets and a leading `+1`, so `8085551234` finds `+1 (808) 555-1234`.
- **Line tag.** The file never says which of the two lines took the call, so every imported call starts on `2nd line (Verizon business)`, changeable on import and afterwards. It shows in the log list and in the text export.
- **Work log** grouped by client/job, searchable across job names, transcripts and notes.
- **Action items** per recording, checkable.
- **Export** one job as a plain text file; back up the whole log as JSON (optionally with audio).
- **Optional AI summary** — off by default; add your own OpenAI-compatible endpoint, key and model in Settings.

---

## Run it

### On GitHub Pages (the demo link)

```bash
cd tide-tool-voice-log
git init
git add .
git commit -m "Tide & Tool voice log"
git branch -M main
git remote add origin https://github.com/<you>/tide-tool-voice-log.git
git push -u origin main
```

Then: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
The app appears at `https://<you>.github.io/tide-tool-voice-log/`. `.nojekyll` is already there so nothing gets swallowed by Jekyll.

Everything is relative-path, so it also works from any subfolder of any static host (Netlify, S3, a NAS).

### On this machine, while building

```powershell
cd D:\Users\chase\tide-tool-voice-log
python -m http.server 8765
# open http://127.0.0.1:8765/
```

or double-click `serve.cmd`.

### Straight from the file system

Double-clicking `index.html` works: recording, saving, search, playback, export, backup and AI summary all run from `file://`. **On-device transcription does not** — Chrome will not load the speech engine (an ES module plus WebAssembly) from a `file://` page, and no amount of local code changes that. The app says so plainly in the import sheet and still saves the audio. Use the GitHub Pages URL or a local server when you want transcription.

---

## What is on the device, and what leaves it

| Thing | Where it lives |
|---|---|
| Audio (webm/opus from the mic, the imported file as-is) | IndexedDB (`tide-tool-voicelog` → `audio`), keyed by recording id |
| Jobs, transcripts, notes, action items, summaries, settings, phone book | `localStorage`, key `tt.voicelog.v1` |
| Whisper model + WASM | Browser cache, ~44 MB, downloaded once on first import |
| App shell | Service worker cache, so the log opens with no signal |
| Speech engine (`transformers.min.js`) | Service worker cache, so transcription still runs with no signal after the first import |

Two network calls exist, both visible in the UI:

1. **First import** downloads the speech model from Hugging Face (~44 MB, progress bar shown). Transcription itself runs in the tab.
2. **Summarize** sends *one transcript* to the endpoint you configured, with your key. It only happens when you tap the button.

No analytics, no fonts. The speech engine is a version-pinned module from jsDelivr; the service worker keeps a copy of it and of the ONNX runtime WASM, so after the first transcription run it is served from the device. The model weights come from Hugging Face once and are cached by transformers.js.

The API key is stored in `localStorage` in clear text — it is a phone app, and anyone holding the unlocked phone can read it. Export never includes the key.

---

## Files

```
index.html              one page, four sheets (recorder, save, detail, settings)
assets/styles.css       dark mobile-first stylesheet, no external assets
assets/icon-*.png       home-screen icons
js/core.js              helpers, IndexedDB audio store (+localStorage fallback), state
js/recorder.js          getUserMedia + MediaRecorder + level meter + Web Speech API
js/whisper.js           transformers.js loader, 16 kHz decode, transcription
js/ai.js                OpenAI-compatible /chat/completions call
js/ui.js                rendering, sheets, transcription queue
js/main.js              boot
sw.js                   app-shell + speech-engine cache (network-first, cache fallback)
tests/                  fixtures + the mock endpoint used for verification
```

No build step. Edit a file, reload.

---

## Verification report

Tested on 2026-11-16 in **desktop Chrome on Windows**, 440 × 771 viewport (phone-sized; the pane cannot be widened), plus one 1100 px-wide render of the same page to check the desktop layout. Everything below was done in the real UI unless noted.

### Passed

| # | Check | Result |
|---|---|---|
| 1 | Record a voice note | 22 s recorded from the machine's default mic. 346 KB `audio/webm;codecs=opus` written to IndexedDB, row appeared in the log under the typed job name, playback works from the detail sheet. |
| 2 | Import a call file | Two speech WAVs imported. Model downloaded once (43.5 MB, progress bar), then `whisper-tiny.en` transcribed 28 s of audio in about 10 s. Text came back accurate: *"…the subfloor under the tub is soft about 2 feet out… I'm at 2800 dollars, and I can start Monday the 23rd."* Job name, date (from `lastModified`), transcript and notes all saved. |
| 3 | Failure path | An earlier build passed an unsupported option to the model; the app showed the error, **kept the audio**, marked the row "needs summary" and left the transcript empty. No invented text at any point. |
| 4 | Two jobs + search | Jobs "Kalani — bathroom re-tile" and "Mānoa — water heater". Searching `subfloor` returns 1 match, the Kalani call only; the other job is filtered out. |
| 5 | Action items | Two items added, first checked. Reloaded the page: still checked, still there. |
| 6 | Export one job as text | File written with the job, both entries, transcript, notes and `[x]`/`[ ]` items. Opened it and read it — clean, UTF-8 with BOM so Notepad shows the em dashes correctly. |
| 7 | Whole-log JSON | Export with audio → wipe storage → import: 2 jobs, 3 recordings, all 3 audio blobs restored byte-for-byte. |
| 8 | AI summary | Pointed Settings at a local OpenAI-compatible mock (`tests/mock-openai.py`, **not** a real provider). Request went to `/v1/chat/completions` with `Authorization: Bearer …`, model name, and only the transcript text. Summary saved on the recording and rendered. |
| 9 | Offline | Killed the local server, reloaded: the app opened from the service worker cache, log and audio intact. |
| 10 | Plain file open | Opened from disk (in this pane through the browser's file-scheme proxy, which blocks module and `fetch` exactly like a double-clicked page). App boots, IndexedDB and localStorage both work, recording and saving work. Whisper refuses with a readable message instead of failing silently. |
| 11 | Broken audio | Deleting a recording removes its blob from IndexedDB, not just the row. |

### Caller ID, phone book and line tag

Fixtures: the three `tests/Call_2026…` files are real MP4/AAC containers, made by playing the TTS speech through `MediaRecorder` in this browser and naming them the way Samsung does. They are not files from a Samsung phone.

| # | Check | Result |
|---|---|---|
| 12 | Phone book | Added `Ray Kalani` / `(808) 555-1234` in Settings → Phone book. Row renders, count goes to 1, survives reload. |
| 13 | Known number | Imported `Call_20261116_183022_8085551234.m4a` (bare digits) while the book held `(808) 555-1234`. Save sheet pre-filled `Ray Kalani`, showed "Phone book: Ray Kalani · (808) 555-1234", and took the date from the file name (6:30 PM), not `lastModified`. |
| 14 | Unknown number | Imported `Call_20261116_090512_8085559999.m4a`: no pre-fill, amber "(808) 555-9999 is not in the phone book" with **Add as client**. Tapping it opened the phone book with the number pre-filled as `(808) 555-9999`; saving returned to the save sheet with the new client filled in. |
| 15 | Name in the file name | Imported `Call_20261115_141000_Ray Kalani.m4a`: matched by contact name, pre-filled. |
| 16 | Line tag default | First import defaulted to `2nd line (Verizon business)`; listed as "· 2nd line" in the log. |
| 17 | Line tag changed on import | Second import switched to `1st line` before saving; stored, listed as "· 1st line", printed as `Line: 1st line` in the job export. |
| 18 | Line tag changed later | Changed a saved call to `Unknown` from the detail sheet: select, subtitle, list row ("· line unknown") and export all follow. |
| 19 | Export | Downloaded the job text: every call carries `Line:` and `Client phone:`; the voice note carries neither a line nor a bogus value. |
| 20 | Backup | JSON round-trip now also carries the phone book: 2 clients, 4 recordings, 4 audio blobs restored. |
| 21 | Regressions | Re-ran the older checks after the change: voice note record/save, import + on-device transcription of the `.m4a` files, search (`subfloor` → Ray Kalani only, `water heater` → Manoa only), action item staying checked across a reload, offline reload from the service worker. All still pass. |

Two bugs were found and fixed while testing this: the save sheet used to pre-fill the *previous* client for a call from an unknown number, and the phone-book sheet opened underneath the Settings sheet. Both were re-tested after the fix.

### Could not test — say it plainly

- **A real phone microphone and a real Android session.** The mic here is a desktop input device. Levels, echo and pocket-noise behaviour on an actual job site are unverified.
- **Real live transcription.** Chrome's Web Speech API exists in this browser and starts, but the speech service could not be reached from this machine (`network` error), so **no real live transcript was ever produced here**. The app handles it (message, audio still saved, "Transcribe on this device" stays available). The accumulation of final segments, the grey interim words and the prefill of the save sheet were verified with a stubbed `SpeechRecognition` — that proves the wiring, not the recogniser.
- **A real Samsung call recording.** The imports used speech WAVs generated with Windows TTS. The Samsung Phone app writes `.m4a` (AMR/AAC) that Chrome on Android decodes fine, but an actual file from One UI 7 was never opened.
- **A real AI provider with a real key.** Only the local mock. Provider-side CORS behaviour is the main unknown; the app reports CORS failures with a specific message.
- **Long calls.** Nothing longer than 28 s was transcribed. An hour-long call means ~120 Whisper windows on a phone CPU — expect minutes, and the UI has a Stop button, but it is untested at that size.
- **iPhone / Safari** and low-memory Android devices.

### Known limits

- `whisper-tiny.en` mangles proper nouns (*Manoa* → *Minoa*). That is why every transcript is editable and the summary is only ever a draft.
- File names are parsed with Samsung's `Call_YYYYMMDD_HHMMSS_<who>` pattern. If the phone ever changes that pattern, the date falls back to the file's timestamp and the caller is looked for as any 10-digit number anywhere in the name.
- Long-press/drag reordering of jobs does not exist; jobs are ordered by most recent recording.
- The service worker is network-first for code, so a deploy is picked up on the next load when online, and the cached copy is what you get offline.

---

## Notes for whoever picks this up

- `tests/sample-call-*.wav` are synthetic (Windows TTS), made only so the import path could be exercised. They are not customer audio. `tests/Call_2026…m4a` are the same speech re-encoded to AAC and named like Samsung files, for the caller-ID tests.
- `tests/mock-openai.py` exists to prove the Summarize request. Delete `tests/` before publishing if you want the repo minimal; the app does not reference it.
- Bump `CACHE` in `sw.js` when you change app files and want returning visitors to skip a stale fetch.
- The speech engine is deliberately **not** vendored. `transformers.min.js` contains a random-looking 32-character string (it is a class name next to a minified identifier) that GitHub's push protection reports as a leaked Mistral key, and a vendored copy blocks the push for anyone who forks. The service worker cache gives the same offline behaviour without that problem.
