// Builds the ZIP for one meeting from IndexedDB and returns an object URL for the service worker to
// download. It only answers messages addressed to it and releases the URL when told to.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.target !== 'offscreen') return false;
  if (m.type === 'build') {
    build(m).then(reply, (e) => reply({ error: String((e && e.message) || e) }));
    return true;
  }
  if (m.type === 'release') {
    for (const u of m.urls || []) { try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ } }
    reply({ ok: true });
  }
  return false;
});

async function build({ meetingId, settings }) {
  const S = MCC.store;
  const meeting = await S.getMeeting(meetingId);
  if (!meeting) throw new Error('That meeting is no longer stored.');
  const [lines, snapshots] = await Promise.all([S.getLines(meetingId), S.getSnapshots(meetingId, { withData: true })]);
  const { blob, filename } = MCC.zipExport({ meeting, lines, snapshots, settings });
  return { url: URL.createObjectURL(blob), filename, size: blob.size };
}
