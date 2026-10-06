use std::path::{Path, PathBuf};

use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, PictureType};
use lofty::probe::Probe;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumArtPayload {
    pub data: Vec<u8>,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumArtBatchItem {
    pub id: String,
    pub art: Option<AlbumArtPayload>,
}

/// Long edge of a list thumbnail, in pixels. Lists render covers at ~40px, so
/// 96px keeps them sharp on hidpi without shipping the full image per row.
pub const THUMB_SIZE: u32 = 96;

pub fn get_cover(
    covers_dir: &Path,
    audio_path: &Path,
    track_id: &str,
) -> Result<Option<AlbumArtPayload>, String> {
    std::fs::create_dir_all(covers_dir).map_err(|e| e.to_string())?;

    if let Some(cached) = read_cached_cover(covers_dir, track_id)? {
        return Ok(Some(cached));
    }

    let Some((data, mime_type)) = extract_cover(audio_path)? else {
        return Ok(None);
    };

    let ext = ext_for_mime(&mime_type);
    let cache_path = cache_path_for(covers_dir, track_id, ext);
    std::fs::write(&cache_path, &data).map_err(|e| e.to_string())?;

    Ok(Some(AlbumArtPayload { data, mime_type }))
}

/// A small (96px) JPEG thumbnail for list rows. Generated from the full
/// cover on first request and cached as `<key>.thumb.jpg` beside it. The
/// player still uses [`get_cover`] for the full-resolution image.
pub fn get_cover_thumb(
    covers_dir: &Path,
    audio_path: &Path,
    track_id: &str,
) -> Result<Option<AlbumArtPayload>, String> {
    std::fs::create_dir_all(covers_dir).map_err(|e| e.to_string())?;

    let thumb_path = thumb_path_for(covers_dir, track_id);
    if let Ok(data) = std::fs::read(&thumb_path) {
        if !data.is_empty() {
            return Ok(Some(AlbumArtPayload {
                data,
                mime_type: "image/jpeg".to_string(),
            }));
        }
    }

    let Some((full, _mime)) = full_cover_bytes(covers_dir, audio_path, track_id)? else {
        return Ok(None);
    };

    let thumb = resize_to_thumb(&full)?;
    std::fs::write(&thumb_path, &thumb).map_err(|e| e.to_string())?;

    Ok(Some(AlbumArtPayload {
        data: thumb,
        mime_type: "image/jpeg".to_string(),
    }))
}

/// Returns the full cover bytes, reading the on-disk cache if present, or
/// extracting from `audio_path` and writing the cache if not.
fn full_cover_bytes(
    covers_dir: &Path,
    audio_path: &Path,
    track_id: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    if let Some(cached) = read_cached_cover(covers_dir, track_id)? {
        return Ok(Some((cached.data, cached.mime_type)));
    }
    let Some((data, mime_type)) = extract_cover(audio_path)? else {
        return Ok(None);
    };
    let ext = ext_for_mime(&mime_type);
    let cache_path = cache_path_for(covers_dir, track_id, ext);
    std::fs::write(&cache_path, &data).map_err(|e| e.to_string())?;
    Ok(Some((data, mime_type)))
}

fn resize_to_thumb(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode cover for thumb: {e}"))?;
    // `thumbnail` preserves aspect ratio and is faster than a full Lanczos
    // resize; 96px is small enough that the quality difference is invisible.
    let thumb = img.thumbnail(THUMB_SIZE, THUMB_SIZE);
    let mut out = std::io::Cursor::new(Vec::with_capacity(8 * 1024));
    thumb
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumb: {e}"))?;
    Ok(out.into_inner())
}

fn read_cached_cover(
    covers_dir: &Path,
    track_id: &str,
) -> Result<Option<AlbumArtPayload>, String> {
    for ext in ["jpg", "jpeg", "png", "webp"] {
        let path = cache_path_for(covers_dir, track_id, ext);
        if path.is_file() {
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            return Ok(Some(AlbumArtPayload {
                data,
                mime_type: mime_for_ext(ext),
            }));
        }
    }
    Ok(None)
}

fn cache_path_for(covers_dir: &Path, track_id: &str, ext: &str) -> PathBuf {
    covers_dir.join(format!("{}.{}", cache_key(track_id), ext))
}

fn thumb_path_for(covers_dir: &Path, track_id: &str) -> PathBuf {
    covers_dir.join(format!("{}.thumb.jpg", cache_key(track_id)))
}

fn cache_key(track_id: &str) -> String {
    track_id.replace('/', "__")
}

fn extract_cover(path: &Path) -> Result<Option<(Vec<u8>, String)>, String> {
    let tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?
        .read()
        .map_err(|e| format!("Failed to read tags from {}: {e}", path.display()))?;

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let Some(tag) = tag else {
        return Ok(None);
    };

    let picture = tag
        .get_picture_type(PictureType::CoverFront)
        .or_else(|| tag.pictures().first());

    let Some(picture) = picture else {
        return Ok(None);
    };

    let data = picture.data().to_vec();
    if data.is_empty() {
        return Ok(None);
    }

    let mime_type = picture
        .mime_type()
        .map(mime_type_string)
        .unwrap_or_else(|| "image/jpeg".to_string());
    Ok(Some((data, mime_type)))
}

fn mime_type_string(mime: &MimeType) -> String {
    match mime {
        MimeType::Jpeg => "image/jpeg".to_string(),
        MimeType::Png => "image/png".to_string(),
        MimeType::Gif => "image/gif".to_string(),
        MimeType::Tiff => "image/tiff".to_string(),
        MimeType::Bmp => "image/bmp".to_string(),
        MimeType::Unknown(s) if !s.is_empty() => s.clone(),
        _ => "image/jpeg".to_string(),
    }
}

fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "jpg",
    }
}

fn mime_for_ext(ext: &str) -> String {
    match ext {
        "png" => "image/png".to_string(),
        "gif" => "image/gif".to_string(),
        "webp" => "image/webp".to_string(),
        _ => "image/jpeg".to_string(),
    }
}
