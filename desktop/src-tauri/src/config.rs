use std::env;

pub struct PublicConfig {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub api_url: String,
    pub bridge_url: String,
    pub oauth_redirect_uri: String,
}

fn first_nonempty(values: &[&str]) -> Option<String> {
    values.iter().find_map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

impl PublicConfig {
    pub fn load() -> Result<Self, String> {
        let supabase_url = first_nonempty(&[
            &env::var("VOX_SUPABASE_URL").unwrap_or_default(),
            option_env!("VOX_SUPABASE_URL").unwrap_or(""),
        ])
        .ok_or_else(|| "VOX_SUPABASE_URL is not configured".to_string())?;

        let supabase_anon_key = first_nonempty(&[
            &env::var("VOX_SUPABASE_ANON_KEY").unwrap_or_default(),
            option_env!("VOX_SUPABASE_ANON_KEY").unwrap_or(""),
        ])
        .ok_or_else(|| "VOX_SUPABASE_ANON_KEY is not configured".to_string())?;

        let api_url = first_nonempty(&[
            &env::var("VOX_API_URL").unwrap_or_default(),
            option_env!("VOX_API_URL").unwrap_or(""),
            "https://api.voxagent.in",
        ])
        .unwrap();

        let bridge_url = first_nonempty(&[
            &env::var("VOX_BRIDGE_URL").unwrap_or_default(),
            option_env!("VOX_BRIDGE_URL").unwrap_or(""),
            api_url.as_str(),
        ])
        .unwrap();

        let oauth_redirect_uri = first_nonempty(&[
            &env::var("VOX_OAUTH_REDIRECT_URI").unwrap_or_default(),
            option_env!("VOX_OAUTH_REDIRECT_URI").unwrap_or(""),
            "vox://auth/callback",
        ])
        .unwrap();

        Ok(Self {
            supabase_url: supabase_url.trim_end_matches('/').to_string(),
            supabase_anon_key,
            api_url: api_url.trim_end_matches('/').to_string(),
            bridge_url: bridge_url.trim_end_matches('/').to_string(),
            oauth_redirect_uri,
        })
    }
}
