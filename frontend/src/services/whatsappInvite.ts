/** Format validation only; never fetch private invitations or infer joining. */
export type WhatsAppInviteType = "group" | "channel";
export type ParsedInvite = { url: string; type: WhatsAppInviteType; error?: never } | { error: string; url?: never; type?: never };
export function parseWhatsAppInvite(input: string, expected?: WhatsAppInviteType): ParsedInvite {
  let value = input.trim();
  for (const [open, close] of [["\"", "\""], ["'", "'"], ["<", ">"], ["`", "`"], ["“", "”"]])
    if (value.startsWith(open) && value.endsWith(close)) value = value.slice(open.length, -close.length).trim();
  if (!value) return { error: "Paste the complete WhatsApp group or channel invitation." };
  if (value.length > 500 || /[\s\\]/.test(value)) return { error: "Paste one complete link, or confirm a detected link from the share text." };
  try {
    const url = new URL(value);
    const authority = value.match(/^https:\/\/([^/]+)\//i)?.[1];
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || authority?.toLowerCase() !== url.hostname)
      return { error: "Use an HTTPS invitation without credentials, ports or fragments." };
    if (["wa.me", "api.whatsapp.com"].includes(url.hostname)) return { error: "This is a chat contact link. Copy a group invitation or channel share link from WhatsApp." };
    const type = url.hostname === "chat.whatsapp.com" ? "group" : ["whatsapp.com", "www.whatsapp.com"].includes(url.hostname) ? "channel" : null;
    if (!type) return { error: "Only chat.whatsapp.com and whatsapp.com/channel invitations are supported." };
    const path = value.slice(value.indexOf("/", 8)).split(/[?#]/)[0];
    if (path !== url.pathname || !(type === "group" ? /^\/[A-Za-z0-9_-]+\/?$/ : /^\/channel\/[A-Za-z0-9_-]+\/?$/).test(path))
      return { error: "The invitation is incomplete or has an unsupported path. Copy the full link from WhatsApp." };
    if (expected && type !== expected) return { error: `This is a ${type} link. Select ${type === "group" ? "Group" : "Channel"} first.` };
    if ([...url.searchParams].some(([key, val]) => !["mode", "app_absent", "src", "source", "utm_source", "utm_medium", "utm_campaign"].includes(key) || !/^[A-Za-z0-9_-]{1,100}$/.test(val)))
      return { error: "Unsupported share parameters. Copy the original invitation without redirect parameters." };
    return { type, url: `https://${type === "group" ? "chat.whatsapp.com" : "whatsapp.com"}${path.replace(/\/$/, "")}` };
  } catch { return { error: "Enter a complete HTTPS WhatsApp invitation." }; }
}
export function validWhatsAppInvite(value: string, type: WhatsAppInviteType) { return !parseWhatsAppInvite(value, type).error; }
export function detectedWhatsAppLinks(text: string) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"'`]+/gi) || []).map(value => value.replace(/[).,;!]+$/, "")))];
}
