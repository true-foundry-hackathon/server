#[derive(Clone, Debug)]
pub struct Config {
    pub bind_address: String,
    pub database_url: String,
    pub redis_url: Option<String>,
    pub service_token: String,
    pub gemini_api_key: String,
    pub gemini_model: String,
    pub truefoundry_api_key: Option<String>,
    pub truefoundry_gateway_url: Option<String>,
    pub truefoundry_model: Option<String>,
    pub exa_api_key: String,
    pub google_maps_api_key: Option<String>,
    pub bridge_url: Option<String>,
    pub core_api_url: Option<String>,
    pub jev_api_key: Option<String>,
    pub jev_base_url: String,
    pub jev_enabled: bool,
    pub tts_provider: String,
    pub status_webhook_key: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{0} is missing")]
    Missing(&'static str),
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(|name| std::env::var(name).ok())
    }

    pub fn from_values<F>(get: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let jev_api_key = get("JEV_API_KEY").filter(|value| !value.trim().is_empty());
        let jev_enabled = jev_api_key.is_some();
        let jev_base_url = "https://api.typesafe.ai/v1/systemone".to_string();
        let tts_provider = get("VOX_TTS_PROVIDER")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "elevenlabs".to_string());

        let truefoundry_api_key = get("TRUEFOUNDRY_API_KEY").filter(|value| !value.trim().is_empty());
        let truefoundry_gateway_url = get("TRUEFOUNDRY_GATEWAY_URL").filter(|value| !value.trim().is_empty());
        let truefoundry_model = get("TRUEFOUNDRY_MODEL").filter(|value| !value.trim().is_empty());

        if let Some(ref url) = truefoundry_gateway_url {
            std::env::set_var("GEMINI_API_BASE_URL", url);
        }

        let gemini_api_key = get("GEMINI_API_KEY")
            .or_else(|| truefoundry_api_key.clone())
            .filter(|value| !value.trim().is_empty())
            .ok_or(ConfigError::Missing("GEMINI_API_KEY"))?;

        let gemini_model = truefoundry_model
            .clone()
            .or_else(|| get("GEMINI_MODEL"))
            .unwrap_or_else(|| "gemini-3.5-flash-lite".to_string());

        let bind_address = get("VOX_CORE_BIND_ADDRESS")
            .or_else(|| get("PORT").map(|p| format!("0.0.0.0:{p}")))
            .unwrap_or_else(|| "0.0.0.0:3001".to_string());

        Ok(Self {
            bind_address,
            database_url: non_empty(&get, "DATABASE_URL")?,
            redis_url: get("REDIS_URL").filter(|value| !value.trim().is_empty()),
            service_token: non_empty(&get, "VOX_AUTH_TOKEN")?,
            gemini_api_key,
            gemini_model,
            truefoundry_api_key,
            truefoundry_gateway_url,
            truefoundry_model,
            exa_api_key: non_empty(&get, "EXA_API_KEY")?,
            google_maps_api_key: get("GOOGLE_MAPS_API_KEY")
                .filter(|value| !value.trim().is_empty()),
            bridge_url: get("VOX_BRIDGE_URL").filter(|value| !value.trim().is_empty()),
            core_api_url: get("VOX_CORE_API_URL").filter(|value| !value.trim().is_empty()),
            jev_api_key,
            jev_base_url,
            jev_enabled,
            tts_provider,
            status_webhook_key: get("VOX_STATUS_WEBHOOK_KEY")
                .filter(|value| !value.trim().is_empty()),
        })
    }
}

fn non_empty<F>(get: &F, name: &'static str) -> Result<String, ConfigError>
where
    F: Fn(&str) -> Option<String>,
{
    get(name)
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError::Missing(name))
}
