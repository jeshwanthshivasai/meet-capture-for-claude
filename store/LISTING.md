# Chrome Web Store submission kit (0.3.x)

Everything the dashboard asks for, ready to paste.

**Files in this folder:**
- `screenshot-1.png` to `screenshot-4.png` (1280×800)
- `promo-tile-440x280.png` (small promo tile, required; no text, as the store asks)
- `marquee-1400x560.png` (optional marquee; needed only to be featured)
- `store-icon-128x128.png` (the same art as `icons/icon128.png`)

The icons are built by `node store/make-icons.js`; everything else by `node store/make-assets.js`, from the real extension running on the fake Meet used by the tests.

**The package to upload** is built by `store/build.sh` as `meet-capture-for-claude-<version>.zip`. It contains extension files only.

## Before you submit

1. **Try it in a real call.** The caption reader was verified in a live call (0.2.0); the capture button's place in Meet's bar and the docked panel were built against Meet's layout as documented in October 2026 and checked against a replica of it. Join a Meet with a second account or a colleague: the button should sit next to Chat and the panel should open on the right. Turn on captions, share a screen, leave, and check that the captures page opens. If the panel says "waiting for captions" with captions on, the selectors in `src/captions.js` need updating before anything else; if there is no button, the bar lookup in `src/ui.js` (it looks for Meet's Chat, People, Activities and Meeting details buttons by label) does.
2. **Check Open in Claude.** It opens `https://claude.ai/new?q=<transcript>`. If Claude no longer prefills the message box from `q`, turn the setting off by default or remove the button; the Copy transcript button covers the same need.
3. Read the privacy policy once more against what the code does, since the store reads it too.

## Store listing

**Name** (from the manifest): Meet Capture for Claude

**Summary** (from the manifest, 122 of 132 characters): Unofficial. Saves Google Meet captions and screen snapshots into a Claude-ready transcript, inside Meet, on your computer.

**Category:** Workflow & Planning (or Communication)

**Language:** English

**Screenshots, in order:**
1. Captures your Meet call, inside Meet (the call with the button in Meet's bar and the panel docked on the right).
2. The moment you hang up, the meeting is ready for Claude (the captures page: Open in Claude, Copy, ZIP, Save to folder, snapshots, transcript).
3. Captions become a transcript Claude can read (the transcript as a document).
4. One card when you leave, one click to Claude (Meet's "You left" page with the Meeting captured card).

**Detailed description** (plain text; the store doesn't render Markdown):

```
Keep Claude in the loop on your Google Meet calls, without a bot and without waiting for anyone's notes.

A capture button sits in Meet's own bar. While you're in a call, the live captions become a transcript with who said what and when, and the shared screen is snapshotted each time it changes. The moment you leave, the meeting opens on your captures page, ready to hand to Claude: open it in Claude with the transcript already in the message box, copy it, save one ZIP, or write everything into a folder of your choice. Nothing leaves your browser.

INSIDE MEET
• A panel like Meet's own People and Chat panels: the live transcript with names and times, snapshot cards as they are taken, a Snapshot button, and which video is being snapshotted.
• Captions are switched on by themselves when a call starts, because there's no transcript without them.
• Presenting yourself? One click, and your share is snapshotted as it changes, whatever app or tab you switch to, even while the Meet tab is in the background. Alt+Shift+S takes one from any app.

AFTER THE CALL
• Your captures page opens on the meeting, set like the minutes: who spoke, the meeting as one line with a mark at each snapshot, the transcript with the snapshots in place.
• Open in Claude, Copy transcript, Save ZIP (one file), Save to folder (pick it once, then one click or none).
• A lightbox with Copy image for pasting a snapshot into a chat. Rename, search, delete. Meetings are kept for 30 days.
• A "Meeting captured" card on Meet's "You left" page with the counts and the same two buttons.

THE TRANSCRIPT
• Speaker names and timestamps, stitched from Meet's captions. Your own lines, which Meet labels "You", get your name.
• Snapshots listed at the top and marked between the right lines, so Claude knows which image goes with which words.
• A note you set once at the top of every transcript, such as "Summarise the decisions and list action items with owners".

SNAPSHOTS
• Taken the moment the shared screen changes and again once it settles, so a tab you flick past is still there and the same slide isn't kept twice. Or on a timer, or with Alt+Shift+S.

PRIVACY
Runs entirely in your browser. It reads what Meet already shows on your screen, the captions and the video; it doesn't record audio, doesn't join the call, and uses no Google or Anthropic API. No servers, no analytics, no third-party code. Nothing leaves your browser unless you click Open in Claude, which opens claude.ai with the transcript. Full policy: https://github.com/jeshwanthshivasai/meet-capture-for-claude/blob/main/PRIVACY.md

Tell the people in your call that you're saving the captions, as you would for a recording.

Open source (MIT): https://github.com/jeshwanthshivasai/meet-capture-for-claude

Unofficial. Not made by, endorsed by, or affiliated with Google or Anthropic. It reads Meet's page, which Google changes without notice; if a change breaks the captions or the button, an update follows.
```

**Official URL / homepage:** https://github.com/jeshwanthshivasai/meet-capture-for-claude

**Support URL:** https://github.com/jeshwanthshivasai/meet-capture-for-claude/issues

## Privacy practices tab

**Single purpose description:**
Save the live captions and screen-share snapshots of the Google Meet calls the user is in to files on their computer, as a transcript and images ready to give to Claude.

**Permission justification, host access to meet.google.com (from the content script):**
The content script runs only on meet.google.com. While the user is in a call it reads the captions Meet displays (speaker and text) and the video of the shared screen, to build the transcript and take snapshots. It clicks Meet's captions button when captions are off, because the transcript is built from them, and adds the extension's capture button and panel to the page (in shadow roots, so nothing of Meet's is changed). It makes no requests to any site.

**Permission justification, downloads:**
Writes one ZIP (the transcript and the snapshot images) into Downloads/Meet captures when the user clicks Save ZIP or chose that for the end of a call, and a single snapshot image when asked for one. The extension only creates downloads; it never reads, opens or removes them. Saving into a folder of the user's choice uses the File System Access API and its own picker, which needs no permission.

**Permission justification, storage and unlimitedStorage:**
Captured meetings (captions and snapshot images) are stored in the extension's IndexedDB as they arrive, so a closed tab loses nothing, and kept for the number of days the user sets. Snapshots are images, which is why the default quota isn't enough. Settings are kept in chrome.storage.local.

**Permission justification, offscreen:**
Service workers can't create blob URLs. A hidden offscreen document (reason BLOBS) turns the stored data into the ZIP for the downloads API and closes when the export is done.

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

- **Trademark or impersonation** (the name or listing suggests Google or Anthropic made it): the name avoids leading with either brand, and the summary starts with "Unofficial". If asked, rename to "Meet Capture (unofficial)" in the manifest and listing. The icon is composed from Google's and Anthropic's own marks, which their brand guidelines do not allow third parties to alter or combine; if the review objects to it, replace the icon with a mark of our own (the screen-and-caption icon is in the git history before this change) and resubmit.
- **Permission not justified:** `downloads` and `unlimitedStorage` are the two reviewers ask about; the justifications above explain the files and the images. If `unlimitedStorage` is still questioned, it can be dropped: snapshots would then be limited by Chrome's default quota, and the panel already reports storage errors.
- **Insufficient data disclosure:** check that *Personal communications* and *Website content* are ticked and that the privacy policy URL is present.
- **Recording consent:** if the reviewer asks how participants are informed, point to the README and listing, which tell the user to inform the call, and note that the extension only saves what Meet already displays to the user.
