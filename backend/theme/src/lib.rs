//! Local R2-D2 theme document reader. Brook never uses the network for this.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::Watcher;
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_BYTES: u64 = 32 * 1024;
const MONOCHROME_REVISION: &str = "monochrome";
const DARK_SURFACES: [&str; 3] = ["#0A0A0A", "#121212", "#1A1A1A"];
const LIGHT_SURFACES: [&str; 3] = ["#FFFFFF", "#FAFAFA", "#F4F4F4"];
const INK_DARK: &str = "#0A0A0A";
const INK_LIGHT: &str = "#FAFAFA";
const PALETTE_KEYS: [&str; 9] = [
    "background",
    "foreground",
    "inactive",
    "dim_foreground",
    "fallback_accent",
    "critical",
    "critical_dark",
    "warning",
    "magenta",
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccentRoles {
    pub source: String,
    pub text: String,
    pub border: String,
    pub control: String,
    pub on_control: String,
    pub rgb: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedTheme {
    pub available: bool,
    pub revision: String,
    pub accent: AccentRoles,
}

struct Derived {
    source: String,
    text: String,
    text_mix: i64,
    text_contrast: i64,
    border: String,
    border_mix: i64,
    border_contrast: i64,
    control: String,
    control_mix: i64,
    on_control: String,
    control_contrast: i64,
    rgb: String,
}

pub fn theme_file_path() -> PathBuf {
    state_dir().join("theme.json")
}

pub fn state_dir() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/state")))
        .unwrap_or_else(|| PathBuf::from(".local/state"));
    base.join("r2-d2")
}

pub fn monochrome_theme() -> SharedTheme {
    let derived = derive("#FFFFFF", true);
    SharedTheme {
        available: false,
        revision: MONOCHROME_REVISION.to_string(),
        accent: roles_of(&derived),
    }
}

pub fn load_theme_file(path: &Path) -> SharedTheme {
    if let Some(theme) = read_valid(path) {
        return theme;
    }
    thread::sleep(Duration::from_millis(20));
    read_valid(path).unwrap_or_else(monochrome_theme)
}

pub struct ThemeWatch {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ThemeWatch {
    pub fn spawn(path: PathBuf, on_change: impl Fn(SharedTheme) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let thread = thread::spawn(move || watch_loop(path, stop_flag, on_change));
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for ThemeWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn watch_loop(path: PathBuf, stop: Arc<AtomicBool>, on_change: impl Fn(SharedTheme)) {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |_| {
        let _ = tx.send(());
    })
    .ok();
    let mut watched: Option<PathBuf> = None;
    let mut last = String::new();

    while !stop.load(Ordering::SeqCst) {
        let target = existing_watch_dir(&path);
        if watched.as_ref() != Some(&target) {
            if let Some(watcher) = watcher.as_mut() {
                if let Some(previous) = watched.take() {
                    let _ = watcher.unwatch(&previous);
                }
                if watcher
                    .watch(&target, notify::RecursiveMode::NonRecursive)
                    .is_ok()
                {
                    watched = Some(target);
                }
            }
        }
        emit_if_changed(&path, &mut last, &on_change);
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(()) => while rx.try_recv().is_ok() {},
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn existing_watch_dir(theme_file: &Path) -> PathBuf {
    let mut cursor = theme_file
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    while !cursor.as_os_str().is_empty() && !cursor.exists() {
        if !cursor.pop() {
            break;
        }
    }
    if cursor.exists() {
        cursor
    } else {
        std::env::temp_dir()
    }
}

fn emit_if_changed(path: &Path, last: &mut String, on_change: &impl Fn(SharedTheme)) {
    let snapshot = load_theme_file(path);
    if snapshot.revision == *last {
        return;
    }
    *last = snapshot.revision.clone();
    on_change(snapshot);
}

fn read_valid(path: &Path) -> Option<SharedTheme> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    validate_theme_bytes(&bytes).ok()
}

fn validate_theme_bytes(bytes: &[u8]) -> Result<SharedTheme, String> {
    if bytes.len() > MAX_BYTES as usize {
        return Err("Theme document exceeds 32 KiB".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "Theme document is not JSON".to_string())?;
    let root = value
        .as_object()
        .ok_or_else(|| "Theme document is not an object".to_string())?;
    ensure_keys(
        root,
        &[
            "accent",
            "contract",
            "contract_version",
            "palette",
            "revision",
            "version",
        ],
    )?;
    if root.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Err("Unsupported theme version".into());
    }
    if root.get("contract").and_then(|v| v.as_str()) != Some("skyguy-visual") {
        return Err("Unexpected theme contract".into());
    }
    if root.get("contract_version").and_then(|v| v.as_u64()) != Some(1) {
        return Err("Unsupported theme contract version".into());
    }
    let revision = root
        .get("revision")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing theme revision".to_string())?;
    if revision.len() != 64 || !revision.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid theme revision".into());
    }
    let palette = parse_palette(root.get("palette").ok_or("Missing palette")?)?;
    let accent = root
        .get("accent")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "Missing accent".to_string())?;
    ensure_keys(accent, &["dark", "light", "source"])?;
    let source = parse_hex(
        accent
            .get("source")
            .and_then(|v| v.as_str())
            .ok_or("Missing accent source")?,
    )?;
    let dark = derive(&source, true);
    let light = derive(&source, false);
    expect_role(accent.get("dark").ok_or("Missing dark roles")?, &dark)?;
    expect_role(accent.get("light").ok_or("Missing light roles")?, &light)?;
    let expected = sha256_hex(&body_json(&source, &palette, &dark, &light));
    if !revision.eq_ignore_ascii_case(&expected) {
        return Err("Theme revision does not match derived roles".into());
    }
    Ok(SharedTheme {
        available: true,
        revision: expected,
        accent: roles_of(&dark),
    })
}

fn parse_palette(value: &serde_json::Value) -> Result<BTreeMap<String, String>, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Palette is not an object".to_string())?;
    ensure_keys(object, &PALETTE_KEYS)?;
    let mut palette = BTreeMap::new();
    for key in PALETTE_KEYS {
        let color = parse_hex(object.get(key).and_then(|v| v.as_str()).unwrap_or(""))?;
        palette.insert(key.to_string(), color);
    }
    Ok(palette)
}

fn expect_role(value: &serde_json::Value, derived: &Derived) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Accent role is not an object".to_string())?;
    ensure_keys(
        object,
        &[
            "border",
            "border_contrast_min",
            "border_mix",
            "control",
            "control_contrast",
            "control_mix",
            "on_control",
            "rgb",
            "source",
            "text",
            "text_contrast_min",
            "text_mix",
        ],
    )?;
    expect_hex(object, "source", &derived.source)?;
    expect_hex(object, "text", &derived.text)?;
    expect_hex(object, "border", &derived.border)?;
    expect_hex(object, "control", &derived.control)?;
    expect_hex(object, "on_control", &derived.on_control)?;
    expect_string(object, "rgb", &derived.rgb)?;
    expect_hundredths(object, "text_mix", derived.text_mix)?;
    expect_hundredths(object, "text_contrast_min", derived.text_contrast)?;
    expect_hundredths(object, "border_mix", derived.border_mix)?;
    expect_hundredths(object, "border_contrast_min", derived.border_contrast)?;
    expect_hundredths(object, "control_mix", derived.control_mix)?;
    expect_hundredths(object, "control_contrast", derived.control_contrast)?;
    Ok(())
}

fn expect_hex(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    expected: &str,
) -> Result<(), String> {
    let actual = parse_hex(object.get(key).and_then(|v| v.as_str()).unwrap_or(""))?;
    if actual != expected {
        return Err(format!("Accent {key} does not match the shared derivation"));
    }
    Ok(())
}

fn expect_string(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    expected: &str,
) -> Result<(), String> {
    let actual = object.get(key).and_then(|v| v.as_str()).unwrap_or("");
    if actual != expected {
        return Err(format!("Accent {key} does not match the shared derivation"));
    }
    Ok(())
}

fn expect_hundredths(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    expected: i64,
) -> Result<(), String> {
    let actual = object
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("Accent {key} is not a number"))?;
    if round_half_even_hundredths(actual) != expected {
        return Err(format!("Accent {key} does not match the shared derivation"));
    }
    Ok(())
}

fn ensure_keys(
    object: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
) -> Result<(), String> {
    if object.len() != allowed.len() || allowed.iter().any(|key| !object.contains_key(*key)) {
        return Err("Unexpected theme fields".into());
    }
    Ok(())
}

fn roles_of(derived: &Derived) -> AccentRoles {
    AccentRoles {
        source: derived.source.clone(),
        text: derived.text.clone(),
        border: derived.border.clone(),
        control: derived.control.clone(),
        on_control: derived.on_control.clone(),
        rgb: derived.rgb.clone(),
    }
}

fn derive(source: &str, dark: bool) -> Derived {
    let source = parse_hex(source).unwrap_or_else(|_| "#FFFFFF".to_string());
    let channels = rgb(&source).unwrap_or((255, 255, 255));
    let surfaces: &[&str] = if dark {
        &DARK_SURFACES
    } else {
        &LIGHT_SURFACES
    };
    let target = if dark { 255 } else { 0 };
    let (text, text_mix, text_contrast) = readable(&source, surfaces, target, 4.5);
    let (border, border_mix, border_contrast) = readable(&source, surfaces, target, 3.0);
    let dark_ink = contrast(&source, INK_DARK);
    let light_ink = contrast(&source, INK_LIGHT);
    let mut ink = if light_ink > dark_ink {
        INK_LIGHT
    } else {
        INK_DARK
    };
    let mut fill = source.clone();
    let mut control_mix = 0;
    if contrast(&fill, ink) < 4.5 {
        let (dark_fill, dark_mix, _) = readable(&source, &[INK_DARK], 255, 4.5);
        let (light_fill, light_mix, _) = readable(&source, &[INK_LIGHT], 0, 4.5);
        if light_mix < dark_mix {
            control_mix = light_mix;
            fill = light_fill;
            ink = INK_LIGHT;
        } else {
            control_mix = dark_mix;
            fill = dark_fill;
            ink = INK_DARK;
        }
    }
    Derived {
        rgb: format!("{}, {}, {}", channels.0, channels.1, channels.2),
        source,
        text,
        text_mix,
        text_contrast,
        border,
        border_mix,
        border_contrast,
        control: fill.clone(),
        control_mix,
        on_control: ink.to_string(),
        control_contrast: round_half_even_hundredths(contrast(&fill, ink)),
    }
}

fn readable(source: &str, surfaces: &[&str], target: i32, threshold: f64) -> (String, i64, i64) {
    for step in 0..=100 {
        let color = mix(source, target, step);
        let ratio = surfaces
            .iter()
            .map(|surface| contrast(&color, surface))
            .fold(f64::INFINITY, f64::min);
        if ratio >= threshold {
            return (color, step, round_half_even_hundredths(ratio));
        }
    }
    (
        if target == 255 {
            "#FFFFFF".to_string()
        } else {
            "#000000".to_string()
        },
        100,
        0,
    )
}

fn mix(source: &str, target: i32, step: i64) -> String {
    let (r, g, b) = rgb(source).unwrap_or((255, 255, 255));
    let channels = [r, g, b].map(|channel| {
        let mixed = channel as f64 + (target as f64 - channel as f64) * (step as f64 / 100.0) + 0.5;
        mixed.floor().clamp(0.0, 255.0) as u8
    });
    format!("#{:02X}{:02X}{:02X}", channels[0], channels[1], channels[2])
}

fn contrast(first: &str, second: &str) -> f64 {
    let (high, low) = {
        let a = luminance(first);
        let b = luminance(second);
        if a > b {
            (a, b)
        } else {
            (b, a)
        }
    };
    (high + 0.05) / (low + 0.05)
}

fn luminance(color: &str) -> f64 {
    let (r, g, b) = rgb(color).unwrap_or((0, 0, 0));
    let linear = [r, g, b].map(|channel| {
        let c = channel as f64 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    });
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

fn rgb(color: &str) -> Result<(u8, u8, u8), String> {
    let hex = parse_hex(color)?;
    Ok((
        u8::from_str_radix(&hex[1..3], 16).unwrap_or(0),
        u8::from_str_radix(&hex[3..5], 16).unwrap_or(0),
        u8::from_str_radix(&hex[5..7], 16).unwrap_or(0),
    ))
}

fn parse_hex(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    if bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit()) {
        return Ok(value.to_ascii_uppercase());
    }
    Err("Expected a full #RRGGBB color".into())
}

fn round_half_even_hundredths(value: f64) -> i64 {
    let scaled = value * 100.0;
    let floor = scaled.floor();
    let diff = scaled - floor;
    let mut whole = floor as i64;
    if diff > 0.5 + 1e-8 {
        whole += 1;
    } else if (diff - 0.5).abs() <= 1e-8 && whole % 2 != 0 {
        whole += 1;
    }
    whole
}

fn body_json(
    source: &str,
    palette: &BTreeMap<String, String>,
    dark: &Derived,
    light: &Derived,
) -> String {
    format!(
        "{{\"accent\":{{\"dark\":{dark},\"light\":{light},\"source\":{source}}},\"contract\":\"skyguy-visual\",\"contract_version\":1,\"palette\":{palette},\"version\":1}}",
        dark = role_json(dark),
        light = role_json(light),
        source = json_string(source),
        palette = palette_json(palette),
    )
}

fn role_json(role: &Derived) -> String {
    format!(
        "{{\"border\":{border},\"border_contrast_min\":{border_contrast},\"border_mix\":{border_mix},\"control\":{control},\"control_contrast\":{control_contrast},\"control_mix\":{control_mix},\"on_control\":{on_control},\"rgb\":{rgb},\"source\":{source},\"text\":{text},\"text_contrast_min\":{text_contrast},\"text_mix\":{text_mix}}}",
        border = json_string(&role.border),
        border_contrast = format_hundredths(role.border_contrast),
        border_mix = format_hundredths(role.border_mix),
        control = json_string(&role.control),
        control_contrast = format_hundredths(role.control_contrast),
        control_mix = format_hundredths(role.control_mix),
        on_control = json_string(&role.on_control),
        rgb = json_string(&role.rgb),
        source = json_string(&role.source),
        text = json_string(&role.text),
        text_contrast = format_hundredths(role.text_contrast),
        text_mix = format_hundredths(role.text_mix),
    )
}

fn palette_json(palette: &BTreeMap<String, String>) -> String {
    let parts: Vec<String> = palette
        .iter()
        .map(|(key, value)| format!("{}:{}", json_string(key), json_string(value)))
        .collect();
    format!("{{{}}}", parts.join(","))
}

fn format_hundredths(hundredths: i64) -> String {
    let sign = if hundredths < 0 { "-" } else { "" };
    let abs = hundredths.abs();
    let whole = abs / 100;
    let frac = abs % 100;
    if frac == 0 {
        format!("{sign}{whole}.0")
    } else if frac % 10 == 0 {
        format!("{sign}{whole}.{}", frac / 10)
    } else {
        format!("{sign}{whole}.{frac:02}")
    }
}

fn json_string(value: &str) -> String {
    format!("\"{value}\"")
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn standard_palette() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("background".into(), "#121212".into()),
        ("foreground".into(), "#D4D4D4".into()),
        ("inactive".into(), "#606060".into()),
        ("dim_foreground".into(), "#8A8A8D".into()),
        ("fallback_accent".into(), "#EAEAEA".into()),
        ("critical".into(), "#C73838".into()),
        ("critical_dark".into(), "#862020".into()),
        ("warning".into(), "#E07924".into()),
        ("magenta".into(), "#932A37".into()),
    ])
}

pub fn build_theme_document(
    source: &str,
    palette: &BTreeMap<String, String>,
) -> Result<Vec<u8>, String> {
    let source = parse_hex(source)?;
    if palette.len() != PALETTE_KEYS.len()
        || PALETTE_KEYS.iter().any(|key| !palette.contains_key(*key))
    {
        return Err("Unexpected palette fields".into());
    }
    for value in palette.values() {
        parse_hex(value)?;
    }
    let dark = derive(&source, true);
    let light = derive(&source, false);
    let body = body_json(&source, palette, &dark, &light);
    let revision = sha256_hex(&body);
    let document = format!(
        "{{\"accent\":{{\"dark\":{dark},\"light\":{light},\"source\":{source}}},\"contract\":\"skyguy-visual\",\"contract_version\":1,\"palette\":{palette},\"revision\":\"{revision}\",\"version\":1}}\n",
        dark = role_json(&dark),
        light = role_json(&light),
        source = json_string(&source),
        palette = palette_json(palette),
    );
    Ok(document.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};
    use std::time::Instant;

    fn fixture_matches(mode: &str) {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/fixtures/contrast-v1.json");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(path).expect("fixture")).expect("fixture json");
        let samples = value["samples"].as_object().expect("samples");
        for sample in samples.values() {
            let expected = &sample[mode];
            let source = expected["source"].as_str().unwrap();
            let derived = derive(source, mode == "dark");
            assert_eq!(
                derived.text,
                expected["text"].as_str().unwrap(),
                "{source} {mode} text"
            );
            assert_eq!(derived.border, expected["border"].as_str().unwrap());
            assert_eq!(derived.control, expected["control"].as_str().unwrap());
            assert_eq!(derived.on_control, expected["on_control"].as_str().unwrap());
            assert_eq!(derived.rgb, expected["rgb"].as_str().unwrap());
            assert_eq!(
                derived.text_mix,
                round_half_even_hundredths(expected["text_mix"].as_f64().unwrap())
            );
            assert_eq!(
                derived.text_contrast,
                round_half_even_hundredths(expected["text_contrast_min"].as_f64().unwrap())
            );
            assert_eq!(
                derived.control_contrast,
                round_half_even_hundredths(expected["control_contrast"].as_f64().unwrap())
            );
        }
    }

    #[test]
    fn derivation_matches_dark_and_light_fixtures() {
        fixture_matches("dark");
        fixture_matches("light");
    }

    #[test]
    fn document_revision_matches_r2_d2_builder() {
        let bytes = build_theme_document("#1d4ed8", &standard_palette()).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            value["revision"].as_str().unwrap(),
            "db157342068409be08c9601f8dc85843b8f75130935a7453a558b1faae640968"
        );
        let loaded = validate_theme_bytes(&bytes).unwrap();
        assert!(loaded.available);
        assert_eq!(loaded.accent.text, "#5A7EE3");
        assert_eq!(loaded.accent.rgb, "29, 78, 216");
    }

    #[test]
    fn malformed_missing_and_tampered_documents_are_rejected() {
        let dir = tempfile_dir("missing");
        assert_eq!(load_theme_file(&dir.join("theme.json")), monochrome_theme());

        let malformed = dir.join("bad.json");
        fs::write(&malformed, b"{").unwrap();
        assert_eq!(load_theme_file(&malformed).revision, MONOCHROME_REVISION);

        let mut value: serde_json::Value =
            serde_json::from_slice(&build_theme_document("#FFFFFF", &standard_palette()).unwrap())
                .unwrap();
        value["accent"]["dark"]["text"] = serde_json::Value::String("#FF00FF".into());
        let tampered = serde_json::to_vec(&value).unwrap();
        assert!(validate_theme_bytes(&tampered).is_err());

        let mut oversized = vec![b' '; (MAX_BYTES as usize) + 1];
        oversized[0] = b'{';
        assert!(validate_theme_bytes(&oversized).is_err());
    }

    #[test]
    fn watcher_tracks_atomic_replacement_and_absence() {
        let _guard = watch_lock();
        let dir = tempfile_dir("watch");
        let file = dir.join("r2-d2").join("theme.json");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let blue = build_theme_document("#1D4ED8", &standard_palette()).unwrap();
        let neutral = build_theme_document("#EAEAEA", &standard_palette()).unwrap();
        fs::write(&file, &blue).unwrap();

        let (tx, rx) = mpsc::channel();
        let watch = ThemeWatch::spawn(file.clone(), move |theme| {
            let _ = tx.send(theme);
        });

        let first = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("initial theme");
        assert_eq!(first.accent.text, "#5A7EE3");
        assert!(first.available);

        atomic_write(&file, &neutral);
        let latest = wait_revision(&rx, &neutral_revision(), Duration::from_secs(3));
        assert_eq!(latest.accent.source, "#EAEAEA");

        fs::remove_file(&file).unwrap();
        let missing = wait_revision(&rx, MONOCHROME_REVISION, Duration::from_secs(3));
        assert!(!missing.available);
        assert_eq!(missing.accent.source, "#FFFFFF");

        atomic_write(&file, &blue);
        let restored = wait_revision(
            &rx,
            "db157342068409be08c9601f8dc85843b8f75130935a7453a558b1faae640968",
            Duration::from_secs(3),
        );
        assert_eq!(restored.accent.rgb, "29, 78, 216");
        drop(watch);
    }

    #[test]
    fn rapid_replacements_settle_on_the_latest_revision() {
        let _guard = watch_lock();
        let dir = tempfile_dir("rapid");
        let file = dir.join("theme.json");
        let colors = ["#1D4ED8", "#E11D48", "#F5E642", "#EAEAEA"];
        let docs: Vec<Vec<u8>> = colors
            .iter()
            .map(|color| build_theme_document(color, &standard_palette()).unwrap())
            .collect();
        fs::write(&file, &docs[0]).unwrap();
        let (tx, rx) = mpsc::channel();
        let watch = ThemeWatch::spawn(file.clone(), move |theme| {
            let _ = tx.send(theme.revision);
        });
        let _ = rx.recv_timeout(Duration::from_secs(2));
        for doc in docs.iter().skip(1) {
            atomic_write(&file, doc);
        }
        let final_revision = serde_json::from_slice::<serde_json::Value>(docs.last().unwrap())
            .unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_string();
        let settled = wait_string(&rx, &final_revision, Duration::from_secs(3));
        thread::sleep(Duration::from_millis(500));
        let mut last = settled;
        while let Ok(revision) = rx.try_recv() {
            last = revision;
        }
        assert_eq!(last, final_revision);
        drop(watch);
    }

    fn neutral_revision() -> String {
        let bytes = build_theme_document("#EAEAEA", &standard_palette()).unwrap();
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn wait_revision(
        rx: &mpsc::Receiver<SharedTheme>,
        revision: &str,
        timeout: Duration,
    ) -> SharedTheme {
        let deadline = Instant::now() + timeout;
        let mut latest = None;
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(theme) => {
                    let matched = theme.revision == revision;
                    latest = Some(theme);
                    if matched {
                        return latest.unwrap();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        latest.expect("theme update")
    }

    fn wait_string(rx: &mpsc::Receiver<String>, expected: &str, timeout: Duration) -> String {
        let deadline = Instant::now() + timeout;
        let mut latest = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(revision) => {
                    let matched = revision == expected;
                    latest = revision;
                    if matched {
                        return latest;
                    }
                }
                Err(_) => {}
            }
        }
        latest
    }

    fn atomic_write(path: &Path, bytes: &[u8]) {
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, bytes).unwrap();
        fs::rename(&tmp, path).unwrap();
    }

    fn tempfile_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("brook-theme-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn watch_lock() -> MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|err| err.into_inner())
    }
}
