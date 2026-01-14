import crypto from 'crypto';

export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeForKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function safeOneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

export function bytesUtf8(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function chunkTextAround(
  text: string,
  index: number,
  radius: number
): string {
  const start = clamp(index - radius, 0, text.length);
  const end = clamp(index + radius, 0, text.length);
  return text.slice(start, end).trim();
}

export function firstNonEmpty(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return '';
}