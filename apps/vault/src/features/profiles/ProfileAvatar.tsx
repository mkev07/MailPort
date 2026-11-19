import { tintChannels, vibrantTint } from "../settings/model/tint";
import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { LoadingLabel } from "../../components/LoadingLabel";

const icons = {
  person:
    "M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2",
  work: "M3 8h18v12H3zM8 8V5h8v3M3 12h18",
  home: "m3 11 9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
  star: "m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.3-.9L12 3Z",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z",
  bolt: "m13 2-8 12h6l-1 8 9-12h-6l1-8Z",
};

const colors = [
  { name: "Blue", value: "#0A84FF" },
  { name: "Purple", value: "#BF5AF2" },
  { name: "Pink", value: "#FF375F" },
  { name: "Red", value: "#FF453A" },
  { name: "Orange", value: "#FF9F0A" },
  { name: "Yellow", value: "#FFD60A" },
  { name: "Green", value: "#30D158" },
  { name: "Graphite", value: "#98989D" },
];
const emojiOptions = ["🏠", "💼", "📬", "⭐", "🌿", "🎨"];

export type Profile = {
  id: string;
  name: string;
  color: string;
  avatar:
    | { kind: "icon"; value: keyof typeof icons }
    | { kind: "emoji"; value: string }
    | { kind: "image"; value: string };
};

export const newProfile = (): Profile => ({
  id: "",
  name: "",
  color: colors[0].value,
  avatar: { kind: "icon", value: "person" },
});

function isLightAvatarColor(color: string) {
  const [red, green, blue] = [1, 3, 5].map((index) => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179;
}

export function ProfileAvatar({
  profile,
  neutral = false,
}: {
  profile: Profile;
  neutral?: boolean;
}) {
  const { avatar, color } = profile;
  const channels = tintChannels(color);
  const tint = channels ? vibrantTint(channels) : color;
  return (
    <span
      className="profile-avatar"
      style={
        neutral
          ? undefined
          : ({
              "--profile-avatar-color": tint,
              color: isLightAvatarColor(tint) ? "#000" : "#fff",
            } as CSSProperties)
      }
      aria-hidden="true"
    >
      {avatar.kind === "image" ? (
        <img src={avatar.value} alt="" />
      ) : avatar.kind === "emoji" ? (
        avatar.value
      ) : (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icons[avatar.value]} />
        </svg>
      )}
    </span>
  );
}

async function avatarImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    throw new Error("Choose a PNG, JPEG, or WebP image up to 8 MB.");
  }
  const image = new Image();
  // Load through a local data URL to use the same CSP as saved avatars.
  image.src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn’t read this image."));
    reader.readAsDataURL(file);
  });
  await image.decode();
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context || !side) throw new Error("Couldn’t open this image.");
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    96,
    96,
  );
  return canvas.toDataURL("image/png");
}

export function ProfileForm({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: Profile;
  busy: boolean;
  error: string;
  onSave: (profile: Profile) => void;
  onCancel: () => void;
}) {
  const [profile, setProfile] = useState(initial);
  const [mode, setMode] = useState(initial.avatar.kind);
  const photoInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const [loadingImage, setLoadingImage] = useState(false);
  const setAvatar = (avatar: Profile["avatar"]) =>
    setProfile((value) => ({ ...value, avatar }));
  const canSave =
    !busy &&
    !loadingImage &&
    profile.name.trim() &&
    mode === profile.avatar.kind &&
    profile.avatar.value.trim();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSave) onSave(profile);
  };

  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset disabled={busy || loadingImage}>
        <div className="profile-preview">
          <ProfileAvatar profile={profile} />
          <label className="field">
            <span>Profile name</span>
            <input
              required
              maxLength={40}
              value={profile.name}
              onChange={(event) =>
                setProfile({ ...profile, name: event.target.value })
              }
            />
          </label>
        </div>
        <div className="avatar-picker">
          <div className="avatar-modes" role="group" aria-label="Avatar type">
            {(
              [
                ["icon", "Icon"],
                ["emoji", "Emoji"],
                ["image", "Photo"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={mode === kind}
                onClick={() => {
                  setMode(kind);
                  setImageError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="avatar-mode-content">
            {mode === "icon" && (
              <div className="avatar-options" role="group" aria-label="Icons">
                {(Object.keys(icons) as (keyof typeof icons)[]).map((icon) => (
                  <button
                    type="button"
                    key={icon}
                    aria-label={icon}
                    title={icon}
                    aria-pressed={
                      profile.avatar.kind === "icon" &&
                      profile.avatar.value === icon
                    }
                    onClick={() => setAvatar({ kind: "icon", value: icon })}
                  >
                    <ProfileAvatar
                      profile={{
                        ...profile,
                        avatar: { kind: "icon", value: icon },
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
            {mode === "emoji" && (
              <div
                className="avatar-options"
                role="group"
                aria-label="Emoji choices"
              >
                {emojiOptions.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    aria-pressed={
                      profile.avatar.kind === "emoji" &&
                      profile.avatar.value === emoji
                    }
                    onClick={() => setAvatar({ kind: "emoji", value: emoji })}
                  >
                    {emoji}
                  </button>
                ))}
                <input
                  className="custom-emoji"
                  aria-label="Custom emoji"
                  placeholder="Custom emoji"
                  maxLength={24}
                  value={
                    profile.avatar.kind === "emoji" ? profile.avatar.value : ""
                  }
                  onChange={(event) =>
                    setAvatar({ kind: "emoji", value: event.target.value })
                  }
                />
              </div>
            )}
            {mode === "image" && (
              <div className="profile-photo">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => photoInput.current?.click()}
                >
                  {profile.avatar.kind === "image"
                    ? "Replace photo"
                    : "Choose photo"}
                </button>
                <small>PNG, JPEG or WebP · Up to 8 MB</small>
                <input
                  ref={photoInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    event.target.value = "";
                    setImageError("");
                    setLoadingImage(true);
                    try {
                      setAvatar({
                        kind: "image",
                        value: await avatarImage(file),
                      });
                    } catch (failure) {
                      setImageError(
                        failure instanceof Error
                          ? failure.message
                          : "Couldn’t open this image.",
                      );
                    } finally {
                      setLoadingImage(false);
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <fieldset className="avatar-options avatar-colors">
          <legend>Background color</legend>
          {colors.map(({ name, value: color }) => (
            <button
              type="button"
              className="avatar-swatch"
              key={color}
              aria-label={name}
              title={name}
              aria-pressed={profile.color.toLowerCase() === color.toLowerCase()}
              onClick={() => setProfile({ ...profile, color })}
            >
              <span aria-hidden="true" style={{ backgroundColor: color }} />
            </button>
          ))}
          <input
            aria-label="Custom background color"
            type="color"
            value={profile.color}
            onChange={(event) =>
              setProfile({ ...profile, color: event.target.value })
            }
          />
        </fieldset>
      </fieldset>
      {(error || imageError) && (
        <p className="error-banner" role="alert">
          {error || imageError}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!canSave}>
          {busy ? <LoadingLabel>Saving…</LoadingLabel> : "Save profile"}
        </button>
      </div>
    </form>
  );
}
