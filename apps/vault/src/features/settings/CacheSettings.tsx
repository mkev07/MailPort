import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { clearCachedEmailAvatars } from "../../components/EmailAvatar";

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

function formatSize(bytes: number) {
  if (bytes >= 1_000_000_000) return `${sizeFormat.format(bytes / 1_000_000_000)} GB`;
  if (bytes > 0 && bytes < 1000) return `< ${sizeFormat.format(0.001)} MB`;
  return `${sizeFormat.format(bytes / 1_000_000)} MB`;
}

export function CacheSettings() {
  const [bytes, setBytes] = useState<number>();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void invoke<number>("vault_cache_size").then((size) => {
      if (current) setBytes(size);
    }, () => {
      if (current) setError("Could not read cache size.");
    });
    return () => { current = false; };
  }, []);

  const clear = async () => {
    setClearing(true);
    setError("");
    try {
      await invoke("vault_clear_cache");
      clearCachedEmailAvatars();
      setBytes(0);
    } catch {
      setError("Could not clear the cache.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="detail-section">
      <h3>Cache</h3>
      <p role="status">
        Profile pictures: {bytes === undefined ? (error ? "Unavailable" : "Calculating…") : formatSize(bytes)}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={clearing || (bytes === undefined && !error)}
        onClick={() => void clear()}
      >
        {clearing ? "Clearing…" : "Clear cache"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
