# Privacy policy: Meet Capture for Claude

Last updated: 21 October 2026 (version 1.0)

Meet Capture for Claude is a browser extension that saves the live captions and screen-share snapshots of the Google Meet calls you are in to files on your computer. This page lists everything it does with your data.

## What it reads

It runs only on Google Meet pages (`meet.google.com`). While you are in a call, it reads from the page:

- **The captions** that Meet displays when captions are switched on: the speaker's name as Meet shows it and the words, with the time they appeared.
- **The video** Meet is showing you of a shared screen or presentation, to take still images of it. It can also take images of your own screen share, but only when you click **Capture your own screen share** in the panel and choose a window or screen in Chrome's picker.
- **The meeting's title and code**, your own display name from your tile, and when you joined and left, to name the files.

It reads nothing else. It does not record audio or video, does not read the chat, does not read the participant list beyond who is speaking in the captions, and reads no other sites, browsing history, cookies, passwords or files on your computer.

## What it does with it

Everything below happens inside your browser.

- **Transcript.** The captions are stitched into a Markdown file with one line per turn of speech, with the speaker's name and the time. Your own lines, which Meet labels "You", get the name you set or the name on your tile.
- **Snapshots.** Images of the shared screen are saved as PNG (or JPEG) files, taken when the shared screen changes, on a timer, or when you ask for one.
- **Storage.** Captions and snapshots are kept in the extension's own storage in this browser while the call is on, and afterwards for the number of days you set (30 by default; 0 keeps them until you delete them). You can delete any meeting, or all of them, in the panel.
- **Export.** When you leave the call, or when you click **Export**, the files are handed to Chrome as downloads into `Downloads/Meet captures/`, as a folder or one ZIP.
- **Open in Claude.** If you click **Open in Claude**, the extension opens `https://claude.ai/new` with the transcript in the page address, so it appears in the message box of a new chat. This is the only time the transcript leaves your browser, and it goes only to claude.ai, only when you click, and only if you are signed in there. Transcripts over 60,000 characters are copied to the clipboard instead.

## What leaves your browser

Nothing, unless you click **Open in Claude** as described above. The extension has no server, makes no network requests of its own, and contains no analytics, crash reporting, advertising or third-party code. It loads no remote fonts, images or scripts.

## What it stores

- Captured meetings (title, code, times, captions, snapshots), in the extension's IndexedDB in this browser, for the retention period you choose.
- Your settings: your name, the export options, the note for Claude, the snapshot options and the retention period, in Chrome's extension storage.
- The exported files, in your Downloads folder, which are yours and are never touched again by the extension.

## Permissions

- **A script on `meet.google.com`**: reads the captions and video, switches captions on when they are off, and shows the small Capturing pill. Chrome describes this as "read and change your data on meet.google.com".
- **`downloads`**: saves the exported files into `Downloads/Meet captures`. Chrome describes this as "manage your downloads". The extension creates files only; it never reads, opens or deletes downloads.
- **`storage`, `unlimitedStorage`**: keep captured meetings and settings in this browser.
- **`sidePanel`**: shows the extension in Chrome's side panel when you click its toolbar icon.
- **`offscreen`**: a hidden extension page that turns the stored data into files for download.

## Other people

The transcript contains what other people in the call said, and the snapshots show what they shared. The extension saves what Meet already shows on your screen, and it does not tell the other participants. You are responsible for letting them know and for any consent the law where you or they are requires, the same as for recording a call.

## Your files

The exported folder stays on your computer. It can contain confidential conversation, other people's names and words, and anything shown on a shared screen. Keep it somewhere private.

## Changes

If this policy changes, the change will be listed in the repository's changelog and the date above will be updated.

## Contact

Open an issue at https://github.com/jeshwanthshivasai/meet-capture-for-claude/issues.

Meet Capture for Claude is an independent, unofficial tool. It is not made by, endorsed by, or affiliated with Google or Anthropic. Google Meet is a trademark of Google LLC; Claude is a trademark of Anthropic, PBC.
