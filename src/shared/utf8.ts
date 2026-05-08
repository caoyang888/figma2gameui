/**
 * Figma plugin runtime may not provide TextEncoder in all environments.
 * Encode UTF-8 using a runtime-safe fallback.
 */
export function encodeUtf8(text: string): Uint8Array {
  const EncoderCtor = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder;
  if (typeof EncoderCtor === 'function') {
    return new EncoderCtor().encode(text);
  }

  // Fallback: encodeURIComponent produces UTF-8 bytes in percent-escaped form.
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    const ch = encoded[i];
    if (ch === '%') {
      const hex = encoded.slice(i + 1, i + 3);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return new Uint8Array(bytes);
}
