/**
 * `@tauri-apps/api/event`, for a yaz served to a browser (ADR-0030).
 *
 * The web server has no channel from Rust to the page yet, so nothing is ever
 * delivered. The one event yaz emits is an agent calling a *plugin's* MCP tool;
 * over the web that call times out with an error rather than being answered.
 */

export type UnlistenFn = () => void;

export function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(() => {});
}
