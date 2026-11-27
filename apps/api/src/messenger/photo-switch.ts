/**
 * rt243 — the owner's switch "AI tự gửi ảnh cho khách" (Trợ lý AI › Ảnh gửi khách).
 * The brain kept `channels.chat.sendPhotos` (default on) but nothing read it,
 * so the AI could not be told to stop sending pictures. Off = the send_photos
 * tool is not offered to the AI at all (it can still describe in words).
 * Pure: no database.
 */
export function withPhotoSwitch<T>(tools: T[], sendPhotos: boolean | undefined | null): T[] {
  if (sendPhotos !== false) return tools;
  return tools.filter((t) => (t as { name?: string })?.name !== 'send_photos');
}
