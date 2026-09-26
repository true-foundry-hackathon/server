use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const MODEL_URL: &str =
    "https://huggingface.co/lmstudio-ai/gemma-2b-it-GGUF/resolve/main/gemma-2b-it-q4_k_m.gguf";
const MODEL_FILENAME: &str = "gemma-2b-it-q4_k_m.gguf";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExtractedSmsEvent {
    pub relevant: bool,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub done: bool,
    pub error: Option<String>,
}

fn models_dir() -> PathBuf {
    let dir = crate::device_link::vox_config_dir().join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn model_path() -> PathBuf {
    models_dir().join(MODEL_FILENAME)
}

pub fn is_model_downloaded() -> bool {
    model_path().exists()
}

pub async fn download_model(app: AppHandle) -> Result<(), String> {
    if is_model_downloaded() {
        return Ok(());
    }

    let tmp_path = models_dir().join(format!("{MODEL_FILENAME}.part"));
    let client = reqwest::Client::new();
    let resp = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("model download failed: {}", resp.status()));
    }
    let total = resp.content_length();

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed().as_millis() > 200 {
            let _ = app.emit(
                "local-llm-download-progress",
                DownloadProgress {
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    done: false,
                    error: None,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&tmp_path, model_path())
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "local-llm-download-progress",
        DownloadProgress {
            downloaded_bytes: downloaded,
            total_bytes: total,
            done: true,
            error: None,
        },
    );
    Ok(())
}

fn classification_prompt(sender: &str, body: &str) -> String {
    format!(
        "<start_of_turn>user\n\
         You classify a single SMS message for a personal activity timeline. \
         Output ONLY a valid JSON object with this schema: \
         {{\"relevant\": true|false, \"category\": \"payment\"|\"delivery\"|\"appointment\"|\"travel\"|\"otp\"|\"other\", \
         \"title\": \"short human-readable title, under 80 characters\"}}. \
         Set relevant to false for personal/social messages, spam, or anything with no concrete \
         real-world activity to log. Set category to \"otp\" for any one-time password or \
         verification code message, and NEVER include the actual code digits anywhere in your \
         response. Do not include any extra text or markdown outside of the JSON.\n\n\
         Sender: {sender}\n\
         Message: {body}<end_of_turn>\n\
         <start_of_turn>model\n"
    )
}

fn extract_json(raw: &str) -> &str {
    let start = raw.find('{').unwrap_or(0);
    let end = raw.rfind('}').map(|i| i + 1).unwrap_or(raw.len());
    &raw[start..end]
}

#[cfg(any(target_os = "macos", windows))]
mod engine {
    use super::{ExtractedSmsEvent, classification_prompt, extract_json, model_path};
    use llama_cpp_2::context::params::LlamaContextParams;
    use llama_cpp_2::llama_backend::LlamaBackend;
    use llama_cpp_2::llama_batch::LlamaBatch;
    use llama_cpp_2::model::params::LlamaModelParams;
    use llama_cpp_2::model::{AddBos, LlamaModel, Special};
    use llama_cpp_2::sampling::LlamaSampler;
    use std::num::NonZeroU32;

    pub struct LocalLlmEngine {
        backend: LlamaBackend,
        model: LlamaModel,
    }

    impl LocalLlmEngine {
        pub fn load() -> Result<Self, String> {
            let backend = LlamaBackend::init().map_err(|e| e.to_string())?;
            let model_params = LlamaModelParams::default();
            let model = LlamaModel::load_from_file(&backend, model_path(), &model_params)
                .map_err(|e| e.to_string())?;
            Ok(Self { backend, model })
        }

        pub fn classify_sms(&self, sender: &str, body: &str) -> Result<ExtractedSmsEvent, String> {
            let prompt = classification_prompt(sender, body);

            let ctx_params =
                LlamaContextParams::default().with_n_ctx(NonZeroU32::new(2048));
            let mut ctx = self
                .model
                .new_context(&self.backend, ctx_params)
                .map_err(|e| e.to_string())?;

            let tokens = self
                .model
                .str_to_token(&prompt, AddBos::Always)
                .map_err(|e| e.to_string())?;

            let mut batch = LlamaBatch::new(512, 1);
            let last_index = tokens.len() as i32 - 1;
            for (i, token) in tokens.into_iter().enumerate() {
                let is_last = i as i32 == last_index;
                batch
                    .add(token, i as i32, &[0], is_last)
                    .map_err(|e| e.to_string())?;
            }
            ctx.decode(&mut batch).map_err(|e| e.to_string())?;

            let mut sampler = LlamaSampler::greedy();
            let mut output = String::new();
            let mut n_cur = batch.n_tokens();

            for _ in 0..220 {
                let token = sampler.sample(&ctx, batch.n_tokens() - 1);
                if self.model.is_eog_token(token) {
                    break;
                }
                let piece = self
                    .model
                    .token_to_str(token, Special::Tokenize)
                    .map_err(|e| e.to_string())?;
                output.push_str(&piece);

                batch.clear();
                batch
                    .add(token, n_cur, &[0], true)
                    .map_err(|e| e.to_string())?;
                n_cur += 1;
                ctx.decode(&mut batch).map_err(|e| e.to_string())?;
            }

            serde_json::from_str(extract_json(&output))
                .map_err(|e| format!("failed to parse model output: {e}"))
        }
    }
}

#[cfg(any(target_os = "macos", windows))]
pub use engine::LocalLlmEngine;

#[cfg(any(target_os = "macos", windows))]
static ENGINE_CACHE: std::sync::Mutex<Option<LocalLlmEngine>> = std::sync::Mutex::new(None);

/// Loads the model once and reuses it — reloading a 1.4GB model per SMS
/// would add seconds of avoidable latency to every classification.
#[cfg(any(target_os = "macos", windows))]
pub fn classify_sms_cached(sender: &str, body: &str) -> Result<ExtractedSmsEvent, String> {
    let mut guard = ENGINE_CACHE
        .lock()
        .map_err(|_| "local model lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(LocalLlmEngine::load()?);
    }
    guard.as_ref().expect("just set above").classify_sms(sender, body)
}

#[tauri::command]
pub fn is_local_llm_downloaded() -> bool {
    is_model_downloaded()
}

#[tauri::command]
pub async fn download_local_llm(
    app: AppHandle,
    state: tauri::State<'_, crate::device_link::LocalModelReady>,
) -> Result<(), String> {
    download_model(app).await?;
    state.0.send_replace(true);
    Ok(())
}

#[cfg(any(target_os = "macos", windows))]
#[tauri::command]
pub fn test_local_llm(sender: String, body: String) -> Result<ExtractedSmsEvent, String> {
    classify_sms_cached(&sender, &body)
}
