// Shared constants and small helpers. Loaded by the content script, the service worker (importScripts),
// the side panel and the offscreen page. No chrome.* calls here, so it also runs in Node for the tests.
(function (root) {
  const NS = (root.MCC = root.MCC || {});

  NS.DEFAULT_SETTINGS = {
    myName: '',                   // shown instead of "You" in transcripts
    autoCaptions: true,           // turn Meet's captions on when a call starts
    autoExport: true,             // export the moment you leave a call
    exportFormat: 'files',        // 'files': Markdown + images in a folder · 'zip': one ZIP
    includeJson: false,           // add meeting.json with the raw data
    openClaude: false,            // open claude.ai with the transcript after an export
    preface: '',                  // text placed at the top of the transcript, for Claude
    snapshotMode: 'change',       // 'change' | 'timer' | 'both' | 'manual'
    snapshotEverySec: 60,         // timer interval
    snapshotSensitivity: 'normal',// 'low' | 'normal' | 'high'
    snapshotFormat: 'png',        // 'png' | 'jpeg'
    snapshotMaxWidth: 1600,       // longest side of a saved snapshot
    showPill: true,               // the small status pill on the Meet page
    keepDays: 30,                 // delete captured meetings after this many days; 0 keeps them
    debug: false,
  };

  NS.THRESHOLDS = { low: 0.08, normal: 0.035, high: 0.015 };

  const pad2 = (n) => String(n).padStart(2, '0');
  NS.pad2 = pad2;
  NS.normalize = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  NS.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 14:05:09 (local time) */
  NS.fmtTime = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
  /** 14:05 */
  NS.fmtClock = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  /** 2026-10-21 */
  NS.fmtDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  /** Tue 21 Oct 2026 */
  NS.fmtLongDate = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  /** 1h 05m · 23m · 40s */
  NS.fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${pad2(m)}m`;
    if (m) return `${m}m`;
    return `${s}s`;
  };
  /** mm:ss or h:mm:ss since a start time */
  NS.fmtElapsed = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? `${h}:${pad2(m)}` : String(m)) + ':' + pad2(s % 60);
  };
  NS.utcOffset = (ts) => {
    const o = -new Date(ts).getTimezoneOffset(), sign = o < 0 ? '-' : '+', a = Math.abs(o);
    return `UTC${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
  };

  // A name that is safe as a file or folder name on Windows, macOS and Linux.
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  NS.fileSafe = (name, max = 60) => {
    let s = NS.normalize(name).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
    if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/g, '');
    if (!s || RESERVED.test(s)) s = '_' + s;
    return s;
  };

  /** "Meet captures/2026-10-21 14.05 Weekly design sync" (a folder under Downloads) */
  NS.folderName = (meeting) => {
    const d = new Date(meeting.startedAt);
    const stamp = `${NS.fmtDate(meeting.startedAt)} ${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
    const title = NS.fileSafe(meeting.title || meeting.code || 'meeting', 50);
    return `Meet captures/${stamp} ${title}`;
  };

  NS.snapshotFile = (n, format) => `snapshot-${pad2(n)}.${format === 'jpeg' ? 'jpg' : 'png'}`;

  // Meet labels the local user "You" in captions, in the page's language.
  NS.SELF_WORDS = /^(you|vous|du|tú|tu|você|あなた|你|您|당신|sie|ty|вы|jij|je|tú\.|sen)$/i;
  NS.speakerAlias = (speaker, myName) => (myName && NS.SELF_WORDS.test(NS.normalize(speaker)) ? myName : speaker);

  NS.settingsWithDefaults = (s) => {
    const out = { ...NS.DEFAULT_SETTINGS };
    if (s && typeof s === 'object') for (const k of Object.keys(out)) if (s[k] != null && typeof s[k] === typeof out[k]) out[k] = s[k];
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
