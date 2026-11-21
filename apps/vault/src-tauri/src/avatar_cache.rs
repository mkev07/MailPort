use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header::CONTENT_TYPE, Client, StatusCode};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

const MAX_AVATAR_BYTES: usize = 256 * 1024;
const PHOTO_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MISSING_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const CACHE_ERROR: &str = "Could not access the avatar cache.";

pub struct AvatarCache {
    client: Option<Client>,
    generation: Mutex<u64>,
}

impl Default for AvatarCache {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(8))
                .build()
                .ok(),
            generation: Mutex::default(),
        }
    }
}

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("avatars"))
        .map_err(|_| CACHE_ERROR.into())
}

fn image_mime(kind: &str) -> bool {
    matches!(
        kind,
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif"
    )
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 32 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn data_url(entry: &[u8]) -> Option<String> {
    let (kind, image) = entry.split_at(entry.iter().position(|byte| *byte == b'\n')?);
    let kind = std::str::from_utf8(kind).ok()?;
    let image = &image[1..];
    (image_mime(kind) && !image.is_empty() && image.len() <= MAX_AVATAR_BYTES)
        .then(|| format!("data:{kind};base64,{}", STANDARD.encode(image)))
}

fn read_photo(path: &Path) -> Option<Option<String>> {
    let file = File::open(path).ok()?;
    let info = file.metadata().ok()?;
    let age = info.modified().ok()?.elapsed().ok()?;
    if info.len() == 0 {
        return (age < MISSING_TTL).then_some(None);
    }
    if age >= PHOTO_TTL || info.len() > (MAX_AVATAR_BYTES + 32) as u64 {
        return None;
    }
    let mut entry = Vec::new();
    file.take((MAX_AVATAR_BYTES + 33) as u64)
        .read_to_end(&mut entry)
        .ok()?;
    data_url(&entry).map(Some)
}

fn write_photo(path: &Path, entry: &[u8]) -> io::Result<()> {
    let directory = path.parent().expect("avatar cache entry has a parent");
    fs::create_dir_all(directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    let staging = path.with_extension("tmp");
    fs::write(&staging, entry)?;
    fs::rename(staging, path)
}

async fn fetch_photo(client: &Client, hash: &str, refresh: bool) -> Option<Vec<u8>> {
    let mut url = format!("https://www.gravatar.com/avatar/{hash}?s=128&d=404");
    if refresh {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?;
        url.push_str(&format!("&t={}", now.as_millis()));
    }
    let mut response = client.get(url).send().await.ok()?;
    if response.status() == StatusCode::NOT_FOUND {
        return Some(Vec::new());
    }
    let mut entry = response
        .error_for_status_ref()
        .ok()?
        .headers()
        .get(CONTENT_TYPE)?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_string()
        .into_bytes();
    if !image_mime(std::str::from_utf8(&entry).ok()?) {
        return None;
    }
    entry.push(b'\n');
    let limit = entry.len() + MAX_AVATAR_BYTES;
    while let Some(chunk) = response.chunk().await.ok()? {
        if entry.len() + chunk.len() > limit {
            return None;
        }
        entry.extend_from_slice(&chunk);
    }
    Some(entry)
}

#[tauri::command]
pub async fn vault_avatar(
    app: AppHandle,
    cache: State<'_, AvatarCache>,
    hash: String,
    refresh: Option<bool>,
) -> Result<Option<String>, String> {
    if !valid_hash(&hash) {
        return Err("Invalid avatar identifier.".into());
    }
    let hash = hash.to_ascii_lowercase();
    let refresh = refresh.unwrap_or(false);
    let path = directory(&app)?.join(&hash);
    let generation = {
        let mut generation = cache.generation.lock().map_err(|_| CACHE_ERROR)?;
        if refresh {
            *generation = generation.wrapping_add(1);
        } else if let Some(photo) = read_photo(&path) {
            return Ok(photo);
        }
        *generation
    };
    let Some(client) = &cache.client else {
        return Ok(None);
    };
    let Some(entry) = fetch_photo(client, &hash, refresh).await else {
        if refresh {
            return read_photo(&path).ok_or_else(|| "Could not refresh the Gravatar photo.".into());
        }
        return Ok(None);
    };
    let photo = data_url(&entry);
    let current = cache.generation.lock().map_err(|_| CACHE_ERROR)?;
    if *current == generation && (entry.is_empty() || photo.is_some()) {
        let _ = write_photo(&path, &entry);
    }
    Ok(photo)
}

fn usage(path: &Path) -> io::Result<u64> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    let mut bytes = 0;
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            bytes += entry.metadata()?.len();
        }
    }
    Ok(bytes)
}

#[tauri::command]
pub fn vault_cache_size(app: AppHandle, cache: State<'_, AvatarCache>) -> Result<u64, String> {
    let _generation = cache.generation.lock().map_err(|_| CACHE_ERROR)?;
    usage(&directory(&app)?).map_err(|_| CACHE_ERROR.into())
}

#[tauri::command]
pub fn vault_clear_cache(app: AppHandle, cache: State<'_, AvatarCache>) -> Result<(), String> {
    let mut generation = cache.generation.lock().map_err(|_| CACHE_ERROR)?;
    *generation = generation.wrapping_add(1);
    match fs::remove_dir_all(directory(&app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(CACHE_ERROR.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_photos_and_missing_entries_can_be_reopened_and_measured() {
        let directory =
            std::env::temp_dir().join(format!("mailport-avatar-{}", uuid::Uuid::new_v4()));
        let photo = directory.join("a".repeat(32));
        let missing = directory.join("b".repeat(32));
        let entry = b"image/png\nfixture bytes";
        assert_eq!(usage(&directory).unwrap(), 0);
        write_photo(&photo, entry).unwrap();
        write_photo(&missing, b"").unwrap();
        assert_eq!(read_photo(&photo), Some(data_url(entry)));
        assert_eq!(read_photo(&missing), Some(None));
        assert_eq!(usage(&directory).unwrap(), entry.len() as u64);
        File::options()
            .write(true)
            .open(&missing)
            .unwrap()
            .set_modified(std::time::SystemTime::now() - MISSING_TTL - Duration::from_secs(1))
            .unwrap();
        assert_eq!(read_photo(&missing), None);
        assert!(data_url(b"image/svg+xml\nfixture bytes").is_none());
        fs::remove_dir_all(&directory).unwrap();
        assert_eq!(usage(&directory).unwrap(), 0);
    }
}
