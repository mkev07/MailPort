import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GravatarQuickEditorCore } from "@gravatar-com/quick-editor";

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

function avatarHash(email: string) {
  return md5(new TextEncoder().encode(email.trim().toLowerCase()));
}

export function EmailAvatar({
  email,
  lookup,
  fallbackName,
  className = "email-editor-avatar",
}: {
  email: string;
  lookup: boolean;
  fallbackName?: string;
  className?: string;
}) {
  const hash = useMemo(() => email ? avatarHash(email) : "", [email]);
  const subscribe = useCallback((notify: () => void) => {
    avatarUpdates.addEventListener(hash, notify);
    return () => avatarUpdates.removeEventListener(hash, notify);
  }, [hash]);
  const getPhoto = () => lookup ? decodedAvatars.get(hash) : undefined;
  const photo = useSyncExternalStore(subscribe, getPhoto, () => undefined);

  useEffect(() => {
    if (!lookup || !hash || decodedAvatars.has(hash)) return;
    const timer = window.setTimeout(() => loadAvatar(hash), 400);
    return () => window.clearTimeout(timer);
  }, [hash, lookup]);

  return (
    <span className={className} aria-hidden="true">
      {photo ? (
        <img src={photo.src} alt="" referrerPolicy="no-referrer" />
      ) : (
        Array.from(fallbackName?.trim() || email.trim())[0]?.toLocaleUpperCase() || "@"
      )}
    </span>
  );
}

const decodedAvatars = new Map<string, HTMLImageElement | null>();
const pendingAvatars = new Map<string, Promise<void>>();
const avatarUpdates = new EventTarget();

function loadAvatar(hash: string, refresh = false) {
  if (!refresh && (decodedAvatars.has(hash) || pendingAvatars.has(hash))) return;
  const request = invoke<string | null>("vault_avatar", { hash, refresh })
    .then(async (src) => {
      const photo = src ? new Image() : null;
      if (photo && src) {
        photo.src = src;
        await photo.decode();
      }
      if (pendingAvatars.get(hash) !== request) return;
      decodedAvatars.set(hash, photo);
      avatarUpdates.dispatchEvent(new Event(hash));
    })
    .catch(() => {})
    .finally(() => {
      if (pendingAvatars.get(hash) === request) pendingAvatars.delete(hash);
    });
  pendingAvatars.set(hash, request);
}

export function clearCachedEmailAvatars() {
  const hashes = [...decodedAvatars.keys()];
  decodedAvatars.clear();
  pendingAvatars.clear();
  for (const hash of hashes) avatarUpdates.dispatchEvent(new Event(hash));
}

// Only accept avatar updates from the opened Gravatar editor.
class VaultGravatarEditor extends GravatarQuickEditorCore {
  override _onMessage(event: MessageEvent) {
    if (event.origin === "https://gravatar.com" && event.source === this._window &&
      event.data?.type === "avatar_updated") {
      super._onMessage(event);
    }
  }
}

let editor: VaultGravatarEditor | undefined;
let editingHash = "";

export function openGravatarEditor(email: string) {
  if (editor?.isOpen()) return false;
  editor ??= new VaultGravatarEditor({
    scope: ["avatars"],
    onProfileUpdated: () => {
      loadAvatar(editingHash, true);
    },
  });
  editingHash = avatarHash(email);
  return editor.open(email.trim());
}
