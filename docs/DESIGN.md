# The captures page: design notes

Written before the page was drawn, the way a designer would, so the choices can be checked against them.

## The moment

Jesh has just hung up a design sync at 11:31. The next call is at 11:45. The decisions were made out loud and three slides were shown; Jesh wants Claude to write the summary and the action items, with the slides, before the next call starts, and does not want to re-read what was said ten minutes ago. "Done" is: the transcript is in a Claude chat and the snapshots are with it, and nothing was lost. Days later there is a second moment: "what did Priya say about the launch date, and what was on screen?"

## The decisions, and who makes them

| Decision | Who |
|---|---|
| Which meeting? | The system: the page opens on the call that just ended. |
| Did it capture everything? | The system shows it: the meeting as one line, shaded where captions flowed, with a mark at each snapshot; a gap says "6 min without captions" in words. |
| What is this meeting called? | The system, from Meet's title. Rename on request. |
| Who is "You"? | The system, from the Google account. If that failed, one line asks for the name, once. |
| What to do with it? | The person: one strong action, **Open in Claude**. Copy, ZIP and folder are quiet beside it. |
| Which snapshots to keep? | Nobody: all of them are kept, duplicates were never taken. |

Common case: one decision and one click. The obvious version (open the page, scan, copy, open Claude, paste, download the ZIP, unzip, drag the images) was six or more.

## Centre, periphery, on request, nowhere

- **Centre:** the meeting that just ended: its name, the one action, and the record itself: what people said, with the snapshots in place where they were taken.
- **Periphery:** the date, the times, how long; who spoke; the meeting as one line; "Live" while it is live.
- **On request:** the time of each line (shown for the first line of a turn, the rest on hover); why a snapshot was taken and what was being shared (in its caption); the exact size (in the lightbox); the Meet link, rename, delete (in the menu); settings.
- **Nowhere:** initials avatars; per-speaker colours; name chips; counts repeated in three places; a section header that says "Transcript" above the transcript; a permanent list of every meeting beside the one you are reading; three export buttons of the same weight; a confirmation before a delete (there is Undo instead).

What leaves the building stays in view: under the actions, one plain line says that Open in Claude starts a claude.ai chat with the transcript in the message box, and that nothing else is sent anywhere. The risky exception stays in view too: lines Meet labelled "You" are flagged in words, once, with the way to fix it.

## Voice and look

1. **Feeling:** kept, ready, light.
2. **Source:** the minute after a good meeting: the notes are written, the photo of the whiteboard is taken, the laptop closes. The page reads as the minutes of the meeting, not as a dashboard about it. Colour comes from the icon: the terracotta of its Claude starburst, with warm neutrals around it.
3. **Type:** two registers. The words people said are set in Newsreader, a text face made for reading on screens, at 17 px with generous leading; the meeting's name in the same face, large. Everything that is tool rather than record is in Geist: names, times, buttons, captions, settings. Figures are tabular so times line up in the margin.
4. **Colour:** Radix Colors scales for the neutrals and the signals: Sand, warm and quiet in light and dark; Amber only for the one thing that needs you; Red only for delete. The one accent is terracotta, taken from the starburst on the icon (#d97757) and stepped into tints and shades the way the Radix scales are, for one job: the one action and the one line that shows what was captured.
5. **The mark.** The icon is the Google Meet camera, the yellow mark with its one deep corner, the pink light at the lens edge and the viewfinder wing, redrawn as vector from Google's artwork with the white lens dot left out, and the Claude starburst in Claude's terracotta centred on the camera's body: the two marks as their makers draw them, composed as one, and nothing else (no tile, no gradient of our own, no shadow). The camera's shape and colour do the work at small sizes; at 16 px the starburst reads as a terracotta mark in the middle of the camera. The button in Meet's bar carries the starburst alone, in one colour at the weight of Meet's own bar icons, and the captures page takes the starburst's terracotta for its one accent. Both marks are their owners' trademarks (Google LLC; Anthropic, PBC): the icon uses them to say what the tool connects, and the README and the listing say plainly that neither company made it. Marks that came before it and were set aside: a caption bubble with a camera lens, an opening quotation mark set in Newsreader, heavier marks on a gradient tile, a screen with a caption line on an emerald tile, Material glyphs in colourways, and the four-colour Meet camera with the starburst as a corner badge; each read as a generic tool, a chat app or a sticker rather than as this one.
6. **The one element, and the warm moment.** The meeting as a single line: its length, shaded where captions flowed, a mark at each snapshot, "now" moving along it while the call is live. Hover it to see the slide at that moment, click to go there. Each meeting in the index carries a small one, so the list shows length and slides without a number. The warm moment is the first run: one paragraph that says where the button is and that the meeting will be here when you leave, and one link to open Meet.

## Review

Walked as Jesh at 11:32: open page, read the title, press Open in Claude: one decision. Elements on screen not needed in that moment: the index link, the settings button, the three quiet actions, the menu. Bad cases: captions were off for part of the call (the line shows the gap and the record says so in words); nothing was captured (one sentence says why, and the actions are not offered); Chrome wants a click before writing to the folder (one amber line with the button); a delete by mistake (Undo for eight seconds).

Removed after the review: the filmstrip of thumbnails above the record (the line and the figures in the record carry it); the "Double-click to rename" tooltip (Rename is in the menu, the double-click still works); the counts in every index row.

Found in the first real call (23 Oct): Settings could only be left by its one button, which also kept every change. Now Save keeps, and Cancel, the ×, Escape or a click outside drop the edits; a toast says so and offers them back, so a slip costs nothing. The lightbox and the delete confirmation close the same ways. The timer's seconds are greyed out unless a timer is in use, so a field that does nothing does not look like one that does. In Meet, the capture button's badge pulses amber when the panel has an offer you have not seen (Capture my share, when you start presenting), and never for anything else.
