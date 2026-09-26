use crate::auth::AuthManager;
use serde_json::Value;
use std::time::Duration;
use tauri::State;

async fn core_request(
    auth: &AuthManager,
    method: reqwest::Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<Value, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let url = format!("{}{}", config.api_url.trim_end_matches('/'), path);
    let mut req = reqwest::Client::new()
        .request(method, &url)
        .header("authorization", format!("Bearer {}", session.vox_token))
        .timeout(Duration::from_millis(8000))
        .query(query);
    if let Some(body) = body {
        req = req.json(&body);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("{path} failed: {status}"));
    }
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_spans(
    from: Option<String>,
    to: Option<String>,
    collection_id: Option<String>,
    status: Option<String>,
    unscheduled: Option<bool>,
    auth: State<'_, AuthManager>,
) -> Result<Value, String> {
    let query: Vec<(&str, String)> = [
        ("from", from),
        ("to", to),
        ("collection_id", collection_id),
        ("status", status),
        ("unscheduled", unscheduled.map(|u| u.to_string())),
    ]
    .into_iter()
    .filter_map(|(k, v)| v.filter(|v| !v.is_empty()).map(|v| (k, v)))
    .collect();
    core_request(&auth, reqwest::Method::GET, "/v1/spans", &query, None).await
}

#[tauri::command]
pub async fn create_span(payload: Value, auth: State<'_, AuthManager>) -> Result<Value, String> {
    core_request(&auth, reqwest::Method::POST, "/v1/spans", &[], Some(payload)).await
}

#[tauri::command]
pub async fn update_span(
    id: String,
    patch: Value,
    auth: State<'_, AuthManager>,
) -> Result<Value, String> {
    let path = format!("/v1/spans/{id}");
    core_request(&auth, reqwest::Method::PATCH, &path, &[], Some(patch)).await
}

#[tauri::command]
pub async fn delete_span(id: String, auth: State<'_, AuthManager>) -> Result<(), String> {
    let path = format!("/v1/spans/{id}");
    core_request(&auth, reqwest::Method::DELETE, &path, &[], None)
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn get_collections(auth: State<'_, AuthManager>) -> Result<Value, String> {
    core_request(&auth, reqwest::Method::GET, "/v1/collections", &[], None).await
}

#[tauri::command]
pub async fn create_collection(
    payload: Value,
    auth: State<'_, AuthManager>,
) -> Result<Value, String> {
    core_request(&auth, reqwest::Method::POST, "/v1/collections", &[], Some(payload)).await
}

#[tauri::command]
pub async fn update_collection(
    id: String,
    patch: Value,
    auth: State<'_, AuthManager>,
) -> Result<Value, String> {
    let path = format!("/v1/collections/{id}");
    core_request(&auth, reqwest::Method::PATCH, &path, &[], Some(patch)).await
}

#[tauri::command]
pub async fn archive_collection(id: String, auth: State<'_, AuthManager>) -> Result<(), String> {
    let path = format!("/v1/collections/{id}");
    core_request(&auth, reqwest::Method::DELETE, &path, &[], None)
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn set_span_collection(
    collection_id: String,
    span_id: String,
    member: bool,
    auth: State<'_, AuthManager>,
) -> Result<(), String> {
    let path = format!("/v1/collections/{collection_id}/spans/{span_id}");
    let method = if member {
        reqwest::Method::PUT
    } else {
        reqwest::Method::DELETE
    };
    core_request(&auth, method, &path, &[], None).await.map(|_| ())
}
