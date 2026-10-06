mod player;
pub mod spectrum;
pub mod stream;

#[cfg(target_os = "linux")]
pub mod mpris;

pub use player::Engine;
