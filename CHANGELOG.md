# Changelog

## 1.0.1 (2026-10-21)

Fixes from the first real call.

- **No more "Hi! Hi, how? Hi, how are you?"** Captions are now aligned on words, ignoring punctuation and case, so a short line that recognition keeps rewriting is replaced instead of repeated.
- **Long runs become lines.** Meet keeps one caption block for as long as one person talks, which made a three-minute monologue one line with one timestamp. A block is now cut into lines at pauses of four seconds or more and, for runs past forty seconds, at the next sentence end. Snapshot markers can then sit between the right lines.
- **Your name.** When Meet's own tile doesn't carry your name, it is read from the Google account button (on the lobby page), so "You" gets replaced even without the setting.
- **Presenting yourself.** Meet shows no preview of your own share, so nothing could be snapshotted. The pill and the panel now say so and point to **Capture your own screen share**.
- An unnamed call is titled "Google Meet <code>" in the transcript instead of the bare code.

## 1.0.0 (2026-10-21)

First release.

- **Captions to transcript.** While you're in a Google Meet call, the captions Meet shows are stitched into full lines with the speaker's name and the time each line started. Meet rewrites its rolling caption window as the speech recognition corrects itself; the stitching follows the growth, the corrections, and the scrolling, and a re-rendered block isn't saved twice.
- **Captions on by themselves.** If captions are off when you join, the extension clicks Meet's CC button, because there's no transcript without them. If Meet doesn't comply (three tries), the pill says "captions off" so you can click it yourself.
- **Screen-share snapshots.** The shared screen is found among the page's videos (the presentation when Meet marks one, else the widest video) and a snapshot is saved each time it changes and settles, on a timer, both, or only by hand. Alt+Shift+S, the 📷 button on the pill, or the panel take one now. Pick a different video in the panel. If Meet shows no preview of your own share, the panel can capture it directly through Chrome's screen picker.
- **Export on leaving.** One folder in `Downloads/Meet captures/`, named after the date, time and meeting title: `transcript.md` written for Claude (title, times, who spoke, your standing note, the snapshot list, and snapshot markers between the right lines), the snapshots as PNG, and optionally `meeting.json`. Or one ZIP. Export mid-call with **Export so far**, copy the transcript, or export a past meeting again.
- **Open in Claude.** Opens a new claude.ai chat with the transcript in the message box, for transcripts up to 60,000 characters; longer ones are copied for pasting.
- **Side panel.** The live feed, counts, the snapshot button and source, the snapshot mode, exports and past meetings, and the settings: your name (Meet's "You" gets it, and changing it later renames every line), export format, note for Claude, snapshot options, retention.
- **Survives a reload.** A reload mid-call continues the same meeting; a tab that dies loses at most a few seconds, because lines and snapshots are stored as they arrive.
- **Local only.** No server, no account, no bot in the call, no analytics. The only network request is the optional Open in Claude click.
- **Tests.** 24 unit tests (`node test/run.js`) and an end-to-end run of the real extension in Chromium against a fake Meet with a scripted call (`node test/e2e.js`).
