/**
* Shared SMS-classification taxonomy and result shape, used by both vox-core's
* cloud (Gemini) extractor and vox-desktop's on-device (local Gemma) extractor
* so the category list and prompt schema can't silently drift between them.
*/
use serde::{Deserialize, Serialize};

/// The category prompt clause, ready to splice into either extractor's
/// classification prompt: `"payment"|"delivery"|...`.
pub const SMS_CATEGORIES_PROMPT: &str =
    "\"payment\"|\"delivery\"|\"appointment\"|\"travel\"|\"otp\"|\"other\"";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ExtractedSmsEvent {
    pub relevant: bool,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
}
