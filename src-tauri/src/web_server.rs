use std::sync::atomic::{AtomicBool, Ordering};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_tray_base::TrayBaseState;

use crate::commands;
use crate::state::AppState;
use crate::store;

pub struct WebServerState {
    pub running: AtomicBool,
    pub shutdown: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl WebServerState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            shutdown: Mutex::new(None),
        }
    }
}

#[derive(Clone)]
struct ApiState {
    app: AppHandle,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: String,
}

fn authorized(headers: &HeaderMap, query: &TokenQuery, app: &AppHandle) -> bool {
    let tray = app.state::<TrayBaseState>();
    let settings = tray.settings.lock();
    let expected = settings
        .extra
        .get("lanWebToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if expected.is_empty() {
        return false;
    }
    if query.token == expected {
        return true;
    }
    headers
        .get("x-cmddeck-token")
        .and_then(|v| v.to_str().ok())
        .map(|t| t == expected)
        .unwrap_or(false)
}

async fn api_state_handler(
    State(api): State<ApiState>,
    Query(query): Query<TokenQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !authorized(&headers, &query, &api.app) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" })));
    }
    let state = api.app.state::<AppState>();
    let snapshot = store::deck_snapshot(&state);
    (StatusCode::OK, Json(snapshot))
}

#[derive(Deserialize)]
struct RunBody {
    token: String,
    id: String,
}

async fn api_run_handler(
    State(api): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<RunBody>,
) -> impl IntoResponse {
    let query = TokenQuery { token: body.token.clone() };
    if !authorized(&headers, &query, &api.app) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" })));
    }
    let app = api.app.clone();
    let id = body.id.clone();
    let result = tokio::task::spawn_blocking(move || commands::run_macro_by_id(&app, &id))
        .await
        .unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string() }));
    (StatusCode::OK, Json(result))
}

#[derive(Deserialize)]
struct StopBody {
    token: String,
    id: String,
}

async fn api_stop_handler(
    State(api): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<StopBody>,
) -> impl IntoResponse {
    let query = TokenQuery { token: body.token.clone() };
    if !authorized(&headers, &query, &api.app) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" })));
    }
    let app = api.app.clone();
    let id = body.id.clone();
    let result = tokio::task::spawn_blocking(move || crate::runner::stop_macro(&app, &id))
        .await
        .unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string() }));
    (StatusCode::OK, Json(result))
}

async fn web_ui_handler(Query(query): Query<TokenQuery>, State(api): State<ApiState>) -> Html<String> {
    let tray = api.app.state::<TrayBaseState>();
    let settings = tray.settings.lock();
    let token = settings
        .extra
        .get("lanWebToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if query.token != token || token.is_empty() {
        return Html("<h1>Unauthorized</h1>".into());
    }
    Html(include_str!("../../renderer/lan-client.html").to_string())
}

pub fn start(app: &AppHandle, port: u16) -> Result<(), String> {
    let server_state = app.state::<WebServerState>();
    if server_state.running.load(Ordering::SeqCst) {
        stop(app);
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *server_state.shutdown.lock() = Some(tx);

    let api = ApiState { app: app.clone() };
    let router = Router::new()
        .route("/", get(web_ui_handler))
        .route("/api/state", get(api_state_handler))
        .route("/api/run", post(api_run_handler))
        .route("/api/stop", post(api_stop_handler))
        .with_state(api);

    let addr = format!("0.0.0.0:{port}");
    server_state.running.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            let listener = tokio::net::TcpListener::bind(&addr)
                .await
                .expect("bind lan web server");
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
                .ok();
        });
    });

    Ok(())
}

pub fn stop(app: &AppHandle) {
    let server_state = app.state::<WebServerState>();
    if let Some(tx) = server_state.shutdown.lock().take() {
        let _ = tx.send(());
    }
    server_state.running.store(false, Ordering::SeqCst);
}

pub fn sync_from_settings(app: &AppHandle) {
    let tray = app.state::<TrayBaseState>();
    let settings = tray.settings.lock();
    let enabled = settings
        .extra
        .get("lanWebEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let port = settings
        .extra
        .get("lanWebPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(8742) as u16;

    if enabled {
        let _ = start(app, port);
    } else {
        stop(app);
    }
}

pub fn ensure_token(app: &AppHandle) -> String {
    let tray = app.state::<TrayBaseState>();
    let existing = tray
        .settings
        .lock()
        .extra
        .get("lanWebToken")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if let Some(token) = existing {
        return token;
    }
    let token = uuid::Uuid::new_v4().to_string();
    let _ = crate::commands::settings_set_extra(
        app,
        json!({ "lanWebToken": token.clone() }),
    );
    token
}
