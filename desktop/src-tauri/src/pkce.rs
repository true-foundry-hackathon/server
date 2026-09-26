use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn oauth_params(callback: &url::Url) -> HashMap<String, String> {
    let mut params: HashMap<String, String> = callback.query_pairs().into_owned().collect();
    if let Some(fragment) = callback.fragment() {
        for pair in fragment.split('&') {
            let mut parts = pair.splitn(2, '=');
            let Some(key) = parts.next() else {
                continue;
            };
            if key.is_empty() {
                continue;
            }
            let value = parts.next().unwrap_or("");
            let decoded_key = urlencoding_decode(key);
            let decoded_value = urlencoding_decode(value);
            params.entry(decoded_key).or_insert(decoded_value);
        }
    }
    params
}

pub fn urlencoding_decode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &value[i + 1..i + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte as char);
                    i += 3;
                } else {
                    out.push('%');
                    i += 1;
                }
            }
            c => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    out
}
