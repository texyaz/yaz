//! Wiring yaz's MCP server to the application.
//!
//! Two kinds of tool end up in the same registry
//! ([ADR-0022](https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md)):
//!
//! - **the application's own**, which run here in Rust and answer immediately;
//! - **a plugin's**, which run in the webview, because that is where plugins
//!   are — so a call has to cross to the frontend and come back.
//!
//! # Why a plugin's tool is bounded by the plugin
//!
//! A contributed tool is not a new privilege. It runs inside the plugin,
//! through the same API, refused by the same broker. That is why contributing
//! is a declaration and not a capability: a second gate in front of the first
//! would narrow nothing.
//!
//! # And why it can time out
//!
//! The webview might be busy, the plugin might never answer, the window might
//! be closing. A call that waited forever would leave an agent hanging with no
//! way to tell a slow tool from a dead one, so it does not wait forever.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock, oneshot};
use yaz_mcp::{Registry, Server, Tool};

use crate::commands::{CommandError, Result};

/// How long a plugin's tool has to answer before the call is abandoned.
///
/// Generous, because a tool may be searching a library or waiting on a
/// compile, and stingy enough that a dead plugin does not hold an agent
/// indefinitely.
const PLUGIN_TIMEOUT: Duration = Duration::from_secs(30);

/// Calls that have crossed to the webview and not yet come back.
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<std::result::Result<Value, String>>>>>;

/// Which project the window has open.
///
/// The frontend owns this fact and tells the Rust side, because the core tools
/// need a root and the alternative is taking one as an argument — which would
/// let an agent point `read_file` at anywhere on the disk.
#[derive(Default)]
pub struct OpenProject {
    root: std::sync::Mutex<Option<String>>,
}

impl OpenProject {
    /// Remember which project is open, or that none is.
    pub fn set(&self, root: Option<String>) {
        if let Ok(mut guard) = self.root.lock() {
            *guard = root;
        }
    }

    /// The root, if one is open.
    pub fn root(&self) -> Option<String> {
        self.root.lock().ok().and_then(|guard| guard.clone())
    }
}

/// The MCP server and everything it needs.
#[derive(Default)]
pub struct McpState {
    /// Whether an agent may call tools that change the document (ADR-0031).
    /// Off at every start; only the user switches it on, from the window.
    write_allowed: Arc<std::sync::atomic::AtomicBool>,
    inner: Arc<Mutex<Option<Server>>>,
    registry: Arc<RwLock<Registry>>,
    pending: Pending,
    counter: Arc<Mutex<u64>>,
}

/// What the frontend is told about the server.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    /// Whether it is listening.
    pub running: bool,
    /// Where, once it is. `127.0.0.1:PORT`.
    pub address: Option<String>,
    /// Whether writing tools are allowed (ADR-0031).
    pub write_allowed: bool,
    /// The token a client must send. Shown so it can be pasted into a config.
    pub token: Option<String>,
    /// How many tools an agent can currently reach.
    pub tools: usize,
}

/// A tool a plugin says it provides, as the frontend reports it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTool {
    /// Which plugin, so the tool can be namespaced and later withdrawn.
    pub plugin_id: String,
    /// Unqualified — `search`, not `zotero.search`.
    pub name: String,
    /// Already resolved against the active locale by the frontend, because
    /// that is where the catalogues are.
    pub description: String,
    /// JSON Schema for the arguments.
    ///
    /// The frontend sends it as `schema`; without the alias it was dropped and
    /// every plugin tool reached the agent with no parameters at all, so the
    /// agent had to guess their names.
    #[serde(default, alias = "schema")]
    pub input_schema: Value,
    /// Whether the tool changes the document. Overwritten from the manifest
    /// before registration; what the webview sends is not trusted.
    #[serde(default)]
    pub writes: bool,
}

impl McpState {
    /// Start listening, or report where it already is.
    pub async fn start(&self, port: u16, version: String) -> Result<McpStatus> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let server = Server::start(port, "yaz".to_owned(), version, Arc::clone(&self.registry))
                .await
                .map_err(|error| CommandError::new("error-mcp-listen", error))?;
            *guard = Some(server);
        }
        Ok(self.describe(&guard).await)
    }

    /// Stop answering.
    ///
    /// The listener is dropped, which closes the port. Tools stay registered:
    /// a plugin does not need to re-announce itself because the user switched
    /// the server off and on again.
    pub async fn stop(&self) -> McpStatus {
        let mut guard = self.inner.lock().await;
        *guard = None;
        self.describe(&guard).await
    }

    /// Where things stand.
    pub async fn status(&self) -> McpStatus {
        let guard = self.inner.lock().await;
        self.describe(&guard).await
    }

    async fn describe(&self, guard: &Option<Server>) -> McpStatus {
        McpStatus {
            running: guard.is_some(),
            address: guard.as_ref().map(|server| server.address.to_string()),
            token: guard.as_ref().map(|server| server.token.clone()),
            tools: self.registry.read().await.len(),
            write_allowed: self.write_allowed(),
        }
    }

    /// Whether writing tools are currently allowed.
    pub fn write_allowed(&self) -> bool {
        self.write_allowed.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Allow or forbid writing tools. Only the window calls this.
    pub fn set_write_allowed(&self, allowed: bool) {
        self.write_allowed
            .store(allowed, std::sync::atomic::Ordering::SeqCst);
    }

    /// The registry, for the application to put its own tools in.
    pub fn registry(&self) -> Arc<RwLock<Registry>> {
        Arc::clone(&self.registry)
    }

    /// Replace everything a plugin provides.
    ///
    /// Replace rather than add, so a reload during development does not leave
    /// the tools from the previous load behind.
    pub async fn set_plugin_tools<F>(&self, plugin_id: &str, tools: Vec<PluginTool>, invoke: F)
    where
        F: Fn(
                String,
                String,
                Value,
            ) -> tokio::sync::oneshot::Receiver<std::result::Result<Value, String>>
            + Send
            + Sync
            + 'static,
    {
        let invoke = Arc::new(invoke);
        let write_allowed = Arc::clone(&self.write_allowed);
        let mut registry = self.registry.write().await;
        registry.remove_provider(plugin_id);

        for tool in tools {
            let invoke = Arc::clone(&invoke);
            let write_allowed = Arc::clone(&write_allowed);
            let writes = tool.writes;
            let owner = tool.plugin_id.clone();
            let short = tool.name.clone();
            let schema = if tool.input_schema.is_null() {
                json!({ "type": "object" })
            } else {
                tool.input_schema.clone()
            };

            registry.insert(
                Tool::new(
                    tool.name.clone(),
                    tool.description.clone(),
                    schema,
                    Arc::new(move |arguments| {
                        let invoke = Arc::clone(&invoke);
                        let owner = owner.clone();
                        let short = short.clone();
                        let allowed = write_allowed.load(std::sync::atomic::Ordering::SeqCst);
                        Box::pin(async move {
                            refuse_for_agents(&arguments, writes, allowed)?;
                            let receiver = invoke(owner, short, arguments);
                            match tokio::time::timeout(PLUGIN_TIMEOUT, receiver).await {
                                Ok(Ok(result)) => result,
                                // The sender was dropped: the webview went
                                // away mid-call, which is a reload or a close.
                                Ok(Err(_)) => Err("the plugin went away mid-call".to_owned()),
                                Err(_) => Err("the plugin did not answer in time".to_owned()),
                            }
                        })
                    }),
                )
                .from_plugin(tool.plugin_id, &tool.name),
            );
        }
    }

    /// Take every tool a plugin provided out of the registry.
    pub async fn drop_plugin_tools(&self, plugin_id: &str) {
        self.registry.write().await.remove_provider(plugin_id);
    }

    /// Register a call about to cross to the webview, and how to hear back.
    pub async fn expect_reply(
        &self,
    ) -> (
        String,
        oneshot::Receiver<std::result::Result<Value, String>>,
    ) {
        let mut counter = self.counter.lock().await;
        *counter += 1;
        let id = format!("mcp-{}", *counter);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);
        (id, receiver)
    }

    /// Give up on a call that never left.
    ///
    /// Otherwise a failed emit would leave an entry waiting for an answer that
    /// can never come, and the map would grow by one every time the window was
    /// missing.
    pub async fn forget(&self, id: &str) {
        self.pending.lock().await.remove(id);
    }

    /// Hand a webview's answer back to whoever is waiting for it.
    ///
    /// An id nobody is waiting for is ignored rather than reported: it means
    /// the call already timed out, and the late answer is simply too late.
    pub async fn deliver(&self, id: &str, result: std::result::Result<Value, String>) {
        if let Some(sender) = self.pending.lock().await.remove(id) {
            let _ = sender.send(result);
        }
    }
}

/// The rules an agent cannot talk its way past, checked here because the
/// webview is not the boundary (ADR-0006, ADR-0031).
///
/// - Nothing an agent sends may contain `\proofed`: only a human marks a
///   sentence as checked (ADR-0030). Checked in every argument of every
///   plugin tool, not just the one meant for inserting text, so a tool added
///   later cannot become the way around it.
/// - A tool that changes the document is refused until the user has allowed
///   writing in the window.
pub(crate) fn refuse_for_agents(
    arguments: &Value,
    writes: bool,
    write_allowed: bool,
) -> std::result::Result<(), String> {
    if mentions_proofed(arguments) {
        return Err(
            "refused: only a human may mark text as \\proofed (ADR-0030). \
                    Insert it as \\ai and let the author check it."
                .to_owned(),
        );
    }
    if writes && !write_allowed {
        return Err(
            "refused: writing is switched off. The author can allow it in yaz \
                    under Connections → AI → Allow AI to write."
                .to_owned(),
        );
    }
    Ok(())
}

fn mentions_proofed(value: &Value) -> bool {
    match value {
        Value::String(text) => text.contains("\\proofed"),
        Value::Array(items) => items.iter().any(mentions_proofed),
        Value::Object(map) => map
            .iter()
            .any(|(key, value)| key.contains("\\proofed") || mentions_proofed(value)),
        _ => false,
    }
}

#[cfg(test)]
mod plugin_tool_wire {
    use super::PluginTool;
    use serde_json::json;

    #[test]
    fn the_schema_the_frontend_sends_reaches_the_agent() {
        let tool: PluginTool = serde_json::from_value(json!({
            "pluginId": "com.yaz.zotero",
            "name": "insert_ai_text",
            "description": "d",
            "schema": { "type": "object", "required": ["text"] },
        }))
        .unwrap();
        assert_eq!(tool.input_schema["required"], json!(["text"]));
    }
}

#[cfg(test)]
mod agent_rules {
    use super::refuse_for_agents;
    use serde_json::json;

    #[test]
    fn proofed_is_refused_anywhere_in_the_arguments() {
        for arguments in [
            json!({ "text": "\\proofed[ABCD1234]{x}" }),
            json!({ "nested": { "list": ["fine", "a \\proofed b"] } }),
            json!({ "\\proofed": 1 }),
        ] {
            assert!(refuse_for_agents(&arguments, false, true).is_err());
        }
    }

    #[test]
    fn writing_needs_the_authors_permission() {
        let text = json!({ "text": "\\ai[ABCD1234]{x}" });
        assert!(refuse_for_agents(&text, true, false).is_err());
        assert!(refuse_for_agents(&text, true, true).is_ok());
        assert!(refuse_for_agents(&text, false, false).is_ok());
    }
}
