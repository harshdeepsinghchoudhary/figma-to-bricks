// A local cache entry is only a hint: users can delete attachments in WordPress.
export async function verifyCachedMedia(entry, { site, auth, fetchImpl = fetch }) {
  if (!Number.isInteger(entry?.id) || entry.id < 1) return null;
  const res = await fetchImpl(`${site}/wp-json/wp/v2/media/${entry.id}?context=edit`, {
    headers: { Authorization: auth }, signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`Cannot verify cached attachment ${entry.id}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'trash') return null;
  if (data.id !== entry.id || !/^https?:\/\//i.test(data.source_url || '')) throw new Error(`Invalid media response for attachment ${entry.id}`);
  return { ...entry, url: data.source_url };
}
