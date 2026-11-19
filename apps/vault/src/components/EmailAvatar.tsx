import { useEffect, useState } from "react";

export function EmailAvatar({ email, lookup }: { email: string; lookup: boolean }) {
  const [image, setImage] = useState<string>();
  useEffect(() => {
    if (!lookup || !email) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const normalized = new TextEncoder().encode(email.trim().toLowerCase());
      void crypto.subtle?.digest("SHA-256", normalized).then((digest) => {
        if (!current) return;
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        setImage(`https://www.gravatar.com/avatar/${hash}?s=128&d=404`);
      }).catch(() => {});
    }, 400);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [email, lookup]);

  return (
    <span className="email-editor-avatar" aria-hidden="true">
      {image ? (
        <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setImage(undefined)} />
      ) : (
        Array.from(email.trim())[0]?.toLocaleUpperCase() || "@"
      )}
    </span>
  );
}
