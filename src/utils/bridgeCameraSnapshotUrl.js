/**
 * Static image URL for bridge cam in alert portraits (YouTube thumb or 511 snapshot).
 * @param {{
 *   youtubeVideoId?: string | null,
 *   imageUrl?: string | null,
 *   videoUrl?: string | null,
 * } | null | undefined} feed
 * @returns {string | null}
 */
export function bridgeCameraSnapshotUrl(feed) {
  if (!feed || typeof feed !== 'object') return null
  const yt =
    typeof feed.youtubeVideoId === 'string' && feed.youtubeVideoId.trim()
      ? feed.youtubeVideoId.trim()
      : ''
  if (yt) return `https://img.youtube.com/vi/${yt}/hqdefault.jpg`
  const img =
    typeof feed.imageUrl === 'string' && feed.imageUrl.trim() ? feed.imageUrl.trim() : ''
  if (img) return img
  return null
}
