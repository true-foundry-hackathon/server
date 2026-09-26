use serde::{Deserialize, Serialize};

fn default_execution_type() -> String {
    "autonomous".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DesktopTask {
    pub id: String,
    pub title: String,
    #[serde(default, alias = "raw_instruction")]
    pub instruction: String,
    pub status: String,
    #[serde(default = "default_execution_type")]
    pub execution_type: String,
    #[serde(default, alias = "project_id")]
    pub project_name: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub feasibility_reasoning: Option<String>,
    #[serde(default)]
    pub execution_result: Option<serde_json::Value>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_collection_kind")]
    pub kind: String,
    #[serde(default = "default_collection_status")]
    pub status: String,
}

fn default_collection_kind() -> String {
    "project".to_string()
}

fn default_collection_status() -> String {
    "active".to_string()
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateTaskPayload {
    pub title: String,
    pub instruction: Option<String>,
    pub execution_type: Option<String>,
    pub project_name: Option<String>,
    pub collection_id: Option<String>,
    pub due_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpdateTaskPayload {
    pub task_id: String,
    pub status: Option<String>,
    pub feasibility_reasoning: Option<String>,
    pub execution_result: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct GetTasksArgs {
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default)]
    pub page_size: Option<usize>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct PaginatedTasks {
    pub items: Vec<DesktopTask>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TimelineEntry {
    pub id: String,
    pub source: String,
    pub title: String,
    pub status: String,
    pub kind: String,
    pub start_at: String,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct CallStatus {
    pub active: bool,
    pub state: String,
    pub mic_level: f32,
    pub is_speaking: bool,
}

#[cfg(test)]
mod tests {
    use super::DesktopTask;

    /// Regression test for the alias collision that broke the local task
    /// cache: `project_name` used to carry `alias = "collection_id"`, which
    /// collided with the real `collection_id` field's own name. Since
    /// `DesktopTask` always serializes both keys, re-parsing that JSON
    /// failed with "duplicate field `project_name`", silently resetting the
    /// on-disk cache. This asserts the round-trip now succeeds and both
    /// fields keep their values.
    #[test]
    fn desktop_task_round_trips_project_name_and_collection_id() {
        let task = DesktopTask {
            id: "task-1".to_string(),
            title: "Test task".to_string(),
            instruction: "do the thing".to_string(),
            status: "pending".to_string(),
            execution_type: "autonomous".to_string(),
            project_name: Some("Vox Core".to_string()),
            collection_id: Some("abc-123".to_string()),
            feasibility_reasoning: None,
            execution_result: None,
            due_at: None,
            created_at: None,
            completed_at: None,
        };

        let json = serde_json::to_string(&task).expect("serialize DesktopTask");
        let round_tripped: DesktopTask =
            serde_json::from_str(&json).expect("re-parse serialized DesktopTask");

        assert_eq!(round_tripped.project_name, Some("Vox Core".to_string()));
        assert_eq!(round_tripped.collection_id, Some("abc-123".to_string()));
    }
}
