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

    #[error("could not spawn process {0:?}: {1}")]
    ProcessSpawn(String, std::io::Error),

    #[error("path {0} already exists")]
    AlreadyExists(String),

    /// The file changed on disk between the fingerprint capture (open / last
    /// save) and this write attempt (P48). The write is REFUSED — the external
    /// content is preserved, never clobbered. The message begins with the
    /// stable `CONFLICT_PREFIX` sentinel so the webview can tell a conflict
    /// refusal apart from a generic IO error, and carries the discriminating
    /// word "modified" the frontend surfaces as the conflict toast text.
    #[error("{prefix}: {path} was modified externally; refusing to overwrite", prefix = CONFLICT_PREFIX)]
    Conflict { path: String },

    #[error("{0}")]
    InvalidArgument(String),
}

/// Stable sentinel prefix on the serialized `Error::Conflict` message. The
/// frontend matches this exact prefix to distinguish a conflict refusal (keep
/// the buffer dirty, show the conflict toast) from a generic IO failure.
pub const CONFLICT_PREFIX: &str = "EXTERNAL_MODIFICATION_CONFLICT";

impl Error {
    pub fn io(path: &std::path::Path, source: std::io::Error) -> Self {
        Error::Io {
            path: path.display().to_string(),
            source,
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
