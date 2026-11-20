import { useEffect, useState } from "react";

const shifts = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
  15, 21,
];

const constants = new Uint32Array(64);
for (let index = 0; index < 64; index += 1) {
  constants[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32);
}

function md5(bytes: Uint8Array) {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = length * 8;
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let mix: number;
      let slot: number;
      if (index < 16) {
        mix = (b & c) | (~b & d);
        slot = index;
      } else if (index < 32) {
        mix = (d & b) | (~d & c);
        slot = (5 * index + 1) % 16;
      } else if (index < 48) {
        mix = b ^ c ^ d;
        slot = (3 * index + 5) % 16;
      } else {
        mix = c ^ (b | ~d);
        slot = (7 * index) % 16;
      }
      const sum =
        (a + mix + constants[index] + view.getUint32(offset + slot * 4, true)) |
        0;
      const rotated =
        (sum << shifts[index]) | (sum >>> (32 - shifts[index]));
      const previous = d;
      d = c;
      c = b;
      b = (b + rotated) | 0;
      a = previous;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function EmailAvatar({
  email,
  lookup,
  className = "email-editor-avatar",
}: {
  email: string;
  lookup: boolean;
  className?: string;
}) {
  const [image, setImage] = useState<string>();
  useEffect(() => {
    if (!lookup || !email) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const normalized = new TextEncoder().encode(email.trim().toLowerCase());
      const hash = md5(normalized);
      if (!current) return;
      setImage(`https://www.gravatar.com/avatar/${hash}?s=128&d=404`);
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [email, lookup]);

  return (
    <span className={className} aria-hidden="true">
      {image ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImage(undefined)}
        />
      ) : (
        Array.from(email.trim())[0]?.toLocaleUpperCase() || "@"
      )}
    </span>
  );
}
