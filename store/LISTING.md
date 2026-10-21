# Chrome Web Store submission kit (1.0.x)

Everything the dashboard asks for, ready to paste.

**Files in this folder:**
- `screenshot-1.png` to `screenshot-4.png` (1280×800)
- `promo-tile-440x280.png` (small promo tile, required; no text, as the store asks)
- `marquee-1400x560.png` (optional marquee; needed only to be featured)
- `store-icon-128x128.png` (the same art as `icons/icon128.png`)

The icons are built by `node store/make-icons.js`; everything else by `node store/make-assets.js`, from the real extension running on the fake Meet used by the tests.

**The package to upload** is built by `store/build.sh` as `meet-capture-for-claude-<version>.zip`. It contains extension files only.

## Before you submit

1. **Try it in a real call.** The caption reader and the snapshot picker were built against Meet's layout as documented in October 2026 and checked against a replica of it, not in a live call. Join a Meet with a second account or a colleague, turn on captions, share a screen, leave, and check `Downloads/Meet captures/`. If the pill says "waiting for captions" with captions on, the selectors in `src/captions.js` need updating before anything else.
2. **Check Open in Claude.** It opens `https://claude.ai/new?q=<transcript>`. If Claude no longer prefills the message box from `q`, turn the setting off by default or remove the button; the Copy transcript button covers the same need.
3. Read the privacy policy once more against what the code does, since the store reads it too.

## Store listing

**Name** (from the manifest): Meet Capture for Claude

**Summary** (from the manifest, 122 of 132 characters): Unofficial. Saves Google Meet captions and screen-share snapshots into one Claude-ready file, locally. No bot, no account.

**Category:** Workflow & Planning (or Communication)

**Language:** English

**Screenshots, in order:**
1. Your Meet call, saved for Claude the moment you hang up (the call with the pill, the side panel docked).
2. Captions become a transcript Claude can read (the exported transcript as a document).
3. Snapshots of the shared screen, each time it changes (the snapshot controls and the video picker).
4. Everything stays on your computer (the panel after a call: export again, copy, Open in Claude).

**Detailed description** (plain text; the store doesn't render Markdown):

```
Keep Claude in the loop on your Google Meet calls, without a bot and without waiting for anyone's notes.

While you're in a call, Meet Capture saves the live captions with who said what and when, takes a snapshot of the shared screen each time it changes, and when you leave writes everything into one folder in Downloads: a transcript written for Claude, the snapshots as images, and optionally the raw JSON. Drag the files into a Claude chat and ask away, or click Open in Claude to start a chat with the transcript already in the message box.

WHAT YOU GET
• A transcript with speaker names and timestamps, stitched from Meet's captions. Your own lines, which Meet labels "You", get your name.
• Snapshots of the shared screen, taken when it changes, on a timer, or with Alt+Shift+S. They're listed at the top of the transcript and marked between the right lines, so Claude knows which image goes with which words.
• A note you set once that goes at the top of every transcript, such as "Summarise the decisions and list action items with owners".
• One folder per call in Downloads/Meet captures, or one ZIP. Export mid-call, copy the transcript, or export a past call again; captured meetings stay in the panel for 30 days.

HOW TO USE IT
Join a Google Meet call. The extension switches captions on if they're off and shows a small Capturing pill. Click the extension's icon to open the side panel: the live captions, the snapshot button, which video is being snapshotted. Leave the call, and the files are in Downloads.

If you're the one presenting and Meet shows no preview of your share, the panel can capture your screen share directly.

PRIVACY
Runs entirely in your browser. It reads what Meet already shows on your screen, the captions and the video; it doesn't record audio, doesn't join the call, and uses no Google or Anthropic API. No servers, no analytics, no third-party code. Nothing leaves your browser unless you click Open in Claude, which opens claude.ai with the transcript. Full policy: https://github.com/jeshwanthshivasai/meet-capture-for-claude/blob/main/PRIVACY.md

Tell the people in your call that you're saving the captions, as you would for a recording.

Open source (MIT): https://github.com/jeshwanthshivasai/meet-capture-for-claude

Unofficial. Not made by, endorsed by, or affiliated with Google or Anthropic. It reads Meet's page, which Google changes without notice; if a change breaks the captions, an update follows.
```

**Official URL / homepage:** https://github.com/jeshwanthshivasai/meet-capture-for-claude

**Support URL:** https://github.com/jeshwanthshivasai/meet-capture-for-claude/issues

## Privacy practices tab

**Single purpose description:**
Save the live captions and screen-share snapshots of the Google Meet calls the user is in to files on their computer, as a transcript and images ready to give to Claude.

**Permission justification, host access to meet.google.com (from the content script):**
The content script runs only on meet.google.com. While the user is in a call it reads the captions Meet displays (speaker and text) and the video of the shared screen, to build the transcript and take snapshots. It clicks Meet's captions button when captions are off, because the transcript is built from them, and shows a small status pill. It makes no requests to any site.

**Permission justification, downloads:**
Writes the exported files (the transcript, the snapshot images, optionally a ZIP) into Downloads/Meet captures when the user leaves a call or clicks Export. The extension only creates downloads; it never reads, opens or removes them.

**Permission justification, storage and unlimitedStorage:**
Captured meetings (captions and snapshot images) are stored in the extension's IndexedDB as they arrive, so a closed tab loses nothing, and kept for the number of days the user sets. Snapshots are images, which is why the default quota isn't enough. Settings are kept in chrome.storage.local.

**Permission justification, sidePanel:**
Shows the extension's interface in Chrome's side panel when the user clicks the toolbar icon: the live captions, snapshot controls, past meetings and settings.

**Permission justification, offscreen:**
Service workers can't create blob URLs. A hidden offscreen document (reason BLOBS) turns the stored data into files for the downloads API and closes when the export is done.

**Are you using remote code?** No. All code is in the package.

**Data usage: which user data does the extension handle?**
Tick *Personal communications* and *Website content*.

Reason: it reads the captions of calls the user is in (what the user and others said) and images of shared screens, and writes them to local files. Nothing is transmitted anywhere by the extension. Google's policy asks for this to be declared even when data is processed locally. The optional Open in Claude button sends the transcript to claude.ai only when the user clicks it.

**Certifications:** tick all three.
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/jeshwanthshivasai/meet-capture-for-claude/blob/main/PRIVACY.md

## Distribution tab

Visibility: Public. Regions: all. Price: free.

## If the review rejects it

The likely reasons, and the fix for each:

- **Trademark or impersonation** (the name or listing suggests Google or Anthropic made it): the name avoids leading with either brand, and the summary starts with "Unofficial". If asked, rename to "Meet Capture (unofficial)" in the manifest and listing.
- **Permission not justified:** `downloads` and `unlimitedStorage` are the two reviewers ask about; the justifications above explain the files and the images. If `unlimitedStorage` is still questioned, it can be dropped: snapshots would then be limited by Chrome's default quota, and the panel already reports storage errors.
- **Insufficient data disclosure:** check that *Personal communications* and *Website content* are ticked and that the privacy policy URL is present.
- **Recording consent:** if the reviewer asks how participants are informed, point to the README and listing, which tell the user to inform the call, and note that the extension only saves what Meet already displays to the user.
