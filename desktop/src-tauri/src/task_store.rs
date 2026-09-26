use crate::types::{DesktopTask, GetTasksArgs, PaginatedTasks, UpdateTaskPayload};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct TaskManager {
    tasks: Mutex<Vec<DesktopTask>>,
    db_path: PathBuf,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskManager {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let db_dir = PathBuf::from(home).join(".config").join("vox");
        let _ = std::fs::create_dir_all(&db_dir);
        let db_path = db_dir.join("tasks_db.json");

        let mut initial_tasks = Vec::new();
        if db_path.exists() {
            if let Ok(file_content) = std::fs::read_to_string(&db_path) {
                if let Ok(saved) = serde_json::from_str::<Vec<DesktopTask>>(&file_content) {
                    initial_tasks = saved;
                }
            }
        }

        Self {
            tasks: Mutex::new(initial_tasks),
            db_path,
        }
    }

    fn save_to_disk(&self, tasks: &[DesktopTask]) {
        if let Ok(json) = serde_json::to_string_pretty(tasks) {
            let _ = std::fs::write(&self.db_path, json);
        }
    }

    pub fn merge_tasks(&self, remote_tasks: &[DesktopTask]) {
        if let Ok(mut lock) = self.tasks.lock() {
            for remote in remote_tasks {
                if let Some(pos) = lock.iter().position(|t| t.id == remote.id) {
                    lock[pos] = remote.clone();
                } else {
                    lock.push(remote.clone());
                }
            }
            lock.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            self.save_to_disk(&lock);
        }
    }

    pub fn insert_task(&self, task: DesktopTask) {
        if let Ok(mut lock) = self.tasks.lock() {
            lock.retain(|t| t.id != task.id);
            lock.insert(0, task);
            self.save_to_disk(&lock);
        }
    }

    pub fn update_task(&self, payload: &UpdateTaskPayload) -> Result<DesktopTask, String> {
        let mut lock = self.tasks.lock().map_err(|e| e.to_string())?;
        if let Some(task) = lock.iter_mut().find(|t| t.id == payload.task_id) {
            if let Some(ref st) = payload.status {
                if st == "completed" && task.status != "completed" {
                    task.completed_at = Some(chrono::Utc::now().to_rfc3339());
                } else if st != "completed" {
                    task.completed_at = None;
                }
                task.status = st.clone();
            }
            if let Some(ref fr) = payload.feasibility_reasoning {
                task.feasibility_reasoning = Some(fr.clone());
            }
            if let Some(ref er) = payload.execution_result {
                task.execution_result = Some(er.clone());
            }
            let updated = task.clone();
            self.save_to_disk(&lock);
            Ok(updated)
        } else {
            Err(format!("Task {} not found", payload.task_id))
        }
    }

    pub fn filter_and_paginate(
        &self,
        args: &GetTasksArgs,
        page: usize,
        page_size: usize,
    ) -> PaginatedTasks {
        let lock = match self.tasks.lock() {
            Ok(l) => l.clone(),
            Err(_) => Vec::new(),
        };

        let status_filter = args.status.as_deref().unwrap_or("all");
        let search = args
            .search
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();

        let filtered: Vec<DesktopTask> = lock
            .into_iter()
            .filter(|t| {
                let matches_status = match status_filter {
                    "all" => true,
                    "pending" => {
                        t.status == "pending"
                            || t.status == "evaluating"
                            || t.status == "waiting_user"
                    }
                    "executing" => t.status == "executing" || t.status == "running",
                    "completed" => t.status == "completed",
                    _ => t.status == status_filter,
                };
                let matches_search = if search.is_empty() {
                    true
                } else {
                    t.title.to_lowercase().contains(&search)
                        || t.instruction.to_lowercase().contains(&search)
                        || t.project_name
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&search)
                };
                let matches_collection = match args.collection_id.as_deref() {
                    None => true,
                    Some("") => true,
                    Some(cid) => t.collection_id.as_deref() == Some(cid),
                };
                matches_status && matches_search && matches_collection
            })
            .collect();

        let total = filtered.len();
        let total_pages = if total == 0 {
            1
        } else {
            total.div_ceil(page_size)
        };
        let offset = (page - 1) * page_size;
        let items = filtered.into_iter().skip(offset).take(page_size).collect();

        PaginatedTasks {
            items,
            total,
            page,
            page_size,
            total_pages,
        }
    }
}
