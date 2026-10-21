// Builds the export files for one meeting from IndexedDB and returns object URLs for the service worker
// to download. It only answers messages addressed to it and releases the URLs when told to.
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
  const files = MCC.exportFiles({ meeting, lines, snapshots, settings });
  const folder = MCC.folderName(meeting);
  const base = folder.split('/').pop();
  if (settings && settings.exportFormat === 'zip') {
    const chunks = MCC.makeZip(files.map((f) => ({ path: `${base}/${f.name}`, data: f.data })));
    const blob = new Blob(chunks, { type: 'application/zip' });
    return { folder, files: [{ url: URL.createObjectURL(blob), filename: `${folder}.zip`, size: blob.size }] };
  }
  return { folder, files: files.map((f) => { const blob = new Blob([f.data], { type: f.mime }); return { url: URL.createObjectURL(blob), filename: `${folder}/${f.name}`, size: blob.size }; }) };
}
