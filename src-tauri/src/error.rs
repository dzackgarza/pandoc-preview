use serde::{Serialize, Serializer};

/// Typed error surface for all IPC commands. Serialized as its display
/// message because the webview only consumes the human-readable text.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("config file not found at {0} — run scripts/first-run.sh to create it")]
    ConfigMissing(String),

    #[error("config file {path} is invalid: {message}")]
    ConfigInvalid { path: String, message: String },

    #[error("io error on {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("pandoc executable {0:?} could not be spawned: {1}")]
    PandocSpawn(String, std::io::Error),

    #[error("path {0} already exists")]
    AlreadyExists(String),

    #[error("{0}")]
    InvalidArgument(String),
}

impl Error {
    pub fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        Error::Io {
            path: path.display().to_string(),
            source,
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
