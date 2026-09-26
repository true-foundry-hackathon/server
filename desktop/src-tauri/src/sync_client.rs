use crate::auth::AuthManager;
use crate::task_store::TaskManager;
use crate::types::{
    Collection, CreateTaskPayload, DesktopTask, GetTasksArgs, PaginatedTasks, TimelineEntry,
    UpdateTaskPayload,
};
use std::time::Duration;
use tauri::State;

/// One outgoing request to either Supabase PostgREST or the Vox Core API.
/// Both backends are hit with the same shape (base URL trimmed of its
/// trailing slash, bearer auth, optional body, a timeout), just with
/// different tokens/headers, so callers fill this in instead of repeating
/// the `reqwest` builder chain at every call site.
struct RequestSpec<'a> {
    base_url: &'a str,
    path: &'a str,
    method: reqwest::Method,
    bearer_token: &'a str,
    apikey: Option<&'a str>,
    prefer: Option<&'a str>,
    body: Option<&'a serde_json::Value>,
    timeout_ms: u64,
}

async fn send(
    client: &reqwest::Client,
    spec: RequestSpec<'_>,
) -> Result<reqwest::Response, reqwest::Error> {
    let url = format!("{}{}", spec.base_url.trim_end_matches('/'), spec.path);
    let mut req = client
        .request(spec.method, &url)
        .header("authorization", format!("Bearer {}", spec.bearer_token))
        .timeout(Duration::from_millis(spec.timeout_ms));
    if let Some(key) = spec.apikey {
        req = req.header("apikey", key);
    }
    if let Some(prefer) = spec.prefer {
        req = req.header("prefer", prefer);
    }
    if let Some(body) = spec.body {
        req = req.json(body);
    }
    req.send().await
}

#[tauri::command]
pub async fn get_timeline(
    from: String,
    to: String,
    auth: State<'_, AuthManager>,
) -> Result<Vec<TimelineEntry>, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let path = format!("/v1/timeline?from={from}&to={to}");
    let resp = send(
        &client,
        RequestSpec {
            base_url: &config.api_url,
            path: &path,
            method: reqwest::Method::GET,
            bearer_token: &session.vox_token,
            apikey: None,
            prefer: None,
            body: None,
            timeout_ms: 5000,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("timeline request failed: {}", resp.status()));
    }
    resp.json::<Vec<TimelineEntry>>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_collections(auth: State<'_, AuthManager>) -> Result<Vec<Collection>, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let resp = send(
        &client,
        RequestSpec {
            base_url: &config.api_url,
            path: "/v1/collections",
            method: reqwest::Method::GET,
            bearer_token: &session.vox_token,
            apikey: None,
            prefer: None,
            body: None,
            timeout_ms: 5000,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("collections request failed: {}", resp.status()));
    }
    resp.json::<Vec<Collection>>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_collection(
    name: String,
    description: Option<String>,
    kind: Option<String>,
    auth: State<'_, AuthManager>,
) -> Result<Collection, String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "name": name,
        "description": description.unwrap_or_default(),
        "kind": kind.unwrap_or_else(|| "project".to_string()),
    });
    let resp = send(
        &client,
        RequestSpec {
            base_url: &config.api_url,
            path: "/v1/collections",
            method: reqwest::Method::POST,
            bearer_token: &session.vox_token,
            apikey: None,
            prefer: None,
            body: Some(&body),
            timeout_ms: 5000,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("create collection failed: {}", resp.status()));
    }
    resp.json::<Collection>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_collection(id: String, auth: State<'_, AuthManager>) -> Result<(), String> {
    let session = auth.current_session().ok_or("Not signed in")?;
    let config = auth.config();
    let client = reqwest::Client::new();
    let path = format!("/v1/collections/{}", id);
    let resp = send(
        &client,
        RequestSpec {
            base_url: &config.api_url,
            path: &path,
            method: reqwest::Method::DELETE,
            bearer_token: &session.vox_token,
            apikey: None,
            prefer: None,
            body: None,
            timeout_ms: 5000,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(format!("archive collection failed: {}", resp.status()))
    }
}

#[tauri::command]
pub async fn get_tasks(
    args: Option<GetTasksArgs>,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<PaginatedTasks, String> {
    let args = args.unwrap_or_default();
    let page = args.page.unwrap_or(1).max(1);
    let page_size = args.page_size.unwrap_or(10).clamp(1, 50);
    let offset = (page - 1) * page_size;
    let limit = page_size;

    let session = auth.current_session();
    let config = auth.config();

    if let Some(session) = &session {
        let client = reqwest::Client::new();

        // 1. Direct Supabase PostgREST query to DB
        let mut sb_path = format!(
            "/rest/v1/tasks?select=*&order=created_at.desc&limit={}&offset={}",
            limit, offset
        );
        if let Some(status) = &args.status {
            if status != "all" && !status.is_empty() {
                sb_path.push_str(&format!("&status=eq.{}", status));
            }
        }
        if let Some(search) = &args.search {
            let q = search.trim();
            if !q.is_empty() {
                sb_path.push_str(&format!("&title=ilike.*{}*", q));
            }
        }
        if let Some(cid) = &args.collection_id {
            if !cid.is_empty() {
                sb_path.push_str(&format!("&collection_id=eq.{}", cid));
            }
        }

        if let Ok(resp) = send(
            &client,
            RequestSpec {
                base_url: &config.supabase_url,
                path: &sb_path,
                method: reqwest::Method::GET,
                bearer_token: &session.access_token,
                apikey: Some(&config.supabase_anon_key),
                prefer: Some("count=exact"),
                body: None,
                timeout_ms: 3000,
            },
        )
        .await
        {
            if resp.status().is_success() {
                let count_header = resp
                    .headers()
                    .get("content-range")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|s| s.split('/').next_back())
                    .and_then(|s| s.parse::<usize>().ok());

                if let Ok(db_tasks) = resp.json::<Vec<DesktopTask>>().await {
                    let total = count_header.unwrap_or(db_tasks.len());
                    let total_pages = if total == 0 {
                        1
                    } else {
                        total.div_ceil(page_size)
                    };
                    tasks.merge_tasks(&db_tasks);

                    return Ok(PaginatedTasks {
                        items: db_tasks,
                        total,
                        page,
                        page_size,
                        total_pages,
                    });
                }
            }
        }

        // 2. Vox Core API query to DB
        let mut core_path = format!("/v1/tasks?limit={}&offset={}", limit, offset);
        if let Some(cid) = &args.collection_id {
            if !cid.is_empty() {
                core_path.push_str(&format!("&collection_id={}", cid));
            }
        }
        if let Ok(resp) = send(
            &client,
            RequestSpec {
                base_url: &config.api_url,
                path: &core_path,
                method: reqwest::Method::GET,
                bearer_token: &session.vox_token,
                apikey: None,
                prefer: None,
                body: None,
                timeout_ms: 2000,
            },
        )
        .await
        {
            if resp.status().is_success() {
                if let Ok(core_tasks) = resp.json::<Vec<DesktopTask>>().await {
                    tasks.merge_tasks(&core_tasks);
                    return Ok(tasks.filter_and_paginate(&args, page, page_size));
                }
            }
        }
    }

    // 3. Fallback to local persistent DB cache with pagination
    Ok(tasks.filter_and_paginate(&args, page, page_size))
}

#[tauri::command]
pub async fn create_task(
    payload: CreateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let config = auth.config();
    let now = chrono::Utc::now().to_rfc3339();

    let new_task = DesktopTask {
        id: uuid::Uuid::new_v4().to_string(),
        title: payload.title.clone(),
        instruction: payload
            .instruction
            .clone()
            .unwrap_or_else(|| payload.title.clone()),
        status: "pending".to_string(),
        execution_type: payload
            .execution_type
            .clone()
            .unwrap_or_else(|| "autonomous".to_string()),
        project_name: payload.project_name.clone(),
        collection_id: payload.collection_id.clone(),
        feasibility_reasoning: None,
        execution_result: None,
        due_at: payload.due_at.clone(),
        created_at: Some(now.clone()),
        completed_at: None,
    };

    if let Some(session) = &session {
        let client = reqwest::Client::new();
        // Insert to Supabase DB
        let mut sb_body = serde_json::json!({
            "title": new_task.title,
            "raw_instruction": new_task.instruction,
            "status": new_task.status,
            "execution_type": new_task.execution_type,
            "user_id": session.user_id,
        });
        if let Some(due) = &new_task.due_at {
            sb_body["due_at"] = serde_json::json!(due);
        }
        if let Some(cid) = &new_task.collection_id {
            if !cid.is_empty() {
                sb_body["collection_id"] = serde_json::json!(cid);
            }
        }
        let _ = send(
            &client,
            RequestSpec {
                base_url: &config.supabase_url,
                path: "/rest/v1/tasks",
                method: reqwest::Method::POST,
                bearer_token: &session.access_token,
                apikey: Some(&config.supabase_anon_key),
                prefer: Some("return=representation"),
                body: Some(&sb_body),
                timeout_ms: 3000,
            },
        )
        .await;

        // Also post to Vox Core API
        let mut body = serde_json::json!({
            "title": new_task.title,
            "instruction": new_task.instruction,
            "priority": 0,
            "due_at": new_task.due_at,
        });
        if let Some(cid) = &new_task.collection_id {
            if !cid.is_empty() {
                if let Ok(parsed) = uuid::Uuid::parse_str(cid) {
                    body["collection_id"] = serde_json::json!(parsed);
                }
            }
        }
        let _ = send(
            &client,
            RequestSpec {
                base_url: &config.api_url,
                path: "/v1/tasks",
                method: reqwest::Method::POST,
                bearer_token: &session.vox_token,
                apikey: None,
                prefer: None,
                body: Some(&body),
                timeout_ms: 2000,
            },
        )
        .await;
    }

    tasks.insert_task(new_task.clone());
    Ok(new_task)
}

#[tauri::command]
pub async fn update_task(
    payload: UpdateTaskPayload,
    auth: State<'_, AuthManager>,
    tasks: State<'_, TaskManager>,
) -> Result<DesktopTask, String> {
    let session = auth.current_session();
    let config = auth.config();

    if let Some(session) = &session {
        let client = reqwest::Client::new();
        let sb_path = format!("/rest/v1/tasks?id=eq.{}", payload.task_id);
        let mut sb_patch = serde_json::json!({});
        if let Some(ref st) = payload.status {
            sb_patch["status"] = serde_json::json!(st);
            if st == "completed" {
                sb_patch["completed_at"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
            }
        }
        if let Some(ref er) = payload.execution_result {
            sb_patch["execution_result"] = er.clone();
        }
        let _ = send(
            &client,
            RequestSpec {
                base_url: &config.supabase_url,
                path: &sb_path,
                method: reqwest::Method::PATCH,
                bearer_token: &session.access_token,
                apikey: Some(&config.supabase_anon_key),
                prefer: None,
                body: Some(&sb_patch),
                timeout_ms: 3000,
            },
        )
        .await;

        let core_path = format!("/v1/tasks/{}", payload.task_id);
        let mut body = serde_json::Map::new();
        if let Some(ref st) = payload.status {
            body.insert("status".to_string(), serde_json::Value::String(st.clone()));
        }
        if let Some(ref fr) = payload.feasibility_reasoning {
            body.insert(
                "feasibility_reasoning".to_string(),
                serde_json::Value::String(fr.clone()),
            );
        }
        if let Some(ref er) = payload.execution_result {
            body.insert("execution_result".to_string(), er.clone());
        }
        let _ = send(
            &client,
            RequestSpec {
                base_url: &config.api_url,
                path: &core_path,
                method: reqwest::Method::PATCH,
                bearer_token: &session.vox_token,
                apikey: None,
                prefer: None,
                body: Some(&serde_json::Value::Object(body)),
                timeout_ms: 2000,
            },
        )
        .await;
    }

    tasks.update_task(&payload)
}
