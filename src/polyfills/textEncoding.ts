/**
 * Some Figma plugin runtimes do not expose TextEncoder/TextDecoder on globalThis.
 * Provide minimal UTF-8 polyfills for dependencies that read them directly.
 */

function encodeUtf8Fallback(text: string): Uint8Array {
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    const ch = encoded[i];
    if (ch === "%") {
      const hex = encoded.slice(i + 1, i + 3);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return new Uint8Array(bytes);
}

type EncoderLike = {
  encode(input?: string): Uint8Array;
};

type DecoderLike = {
  decode(input?: BufferSource): string;
};

const g = globalThis as typeof globalThis & {
  TextEncoder?: new () => EncoderLike;
  TextDecoder?: new () => DecoderLike;
};

if (typeof g.TextEncoder !== "function") {
  class TextEncoderPolyfill {
    encode(input = ""): Uint8Array {
      return encodeUtf8Fallback(String(input));
    }
  }
  g.TextEncoder = TextEncoderPolyfill;
}

function decodeUtf8Fallback(input?: BufferSource): string {
  if (!input) return "";
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let escaped = "";
  for (let i = 0; i < bytes.length; i += 1) {
    escaped += `%${bytes[i]!.toString(16).padStart(2, "0")}`;
  }
  try {
    return decodeURIComponent(escaped);
  } catch {
    // Last-resort lossy decode for malformed byte streams.
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
    return out;
  }
}

if (typeof g.TextDecoder !== "function") {
  class TextDecoderPolyfill {
    decode(input?: BufferSource): string {
      return decodeUtf8Fallback(input);
    }
  }
  g.TextDecoder = TextDecoderPolyfill;
}

