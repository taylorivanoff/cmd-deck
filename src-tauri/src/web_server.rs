use std::io;
use std::net::{IpAddr, SocketAddr, TcpListener as StdTcpListener};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};

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
    pub port: AtomicU16,
    pub shutdown: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl WebServerState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            port: AtomicU16::new(0),
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

    let (std_listener, addr) = bind_available(IpAddr::from([0, 0, 0, 0]), port)
        .map_err(|error| format!("bind lan web server: {error}"))?;
    if port != 0 && addr.port() != port {
        crate::logger::add_log(
            app,
            "warn",
            &format!("LAN web port {port} is in use; using port {} instead", addr.port()),
            None,
        );
    }
    server_state.port.store(addr.port(), Ordering::SeqCst);
    server_state.running.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            let listener = tokio::net::TcpListener::from_std(std_listener)
                .expect("configure lan web server listener");
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
    server_state.port.store(0, Ordering::SeqCst);
}

fn bind_available(host: IpAddr, requested_port: u16) -> io::Result<(StdTcpListener, SocketAddr)> {
    for offset in 0..=u16::MAX {
        let port = requested_port.wrapping_add(offset);
        match StdTcpListener::bind(SocketAddr::from((host, port))) {
            Ok(listener) => {
                let addr = listener.local_addr()?;
                listener.set_nonblocking(true)?;
                return Ok((listener, addr));
            }
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => {}
            Err(error) => return Err(error),
        }
    }

    unreachable!("all TCP ports are unavailable")
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
