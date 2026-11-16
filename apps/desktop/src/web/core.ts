/**
 * `@tauri-apps/api/core`, for a yaz served to a browser (ADR-0030).
 *
 * The web build aliases the Tauri module to this file, so `ipc.ts` and every
 * caller of it are the same code in both builds. What changes is only how a
 * command crosses: a `fetch` to the yaz web server instead of the webview's
 * IPC channel. The server hands it to the same Rust handler, so arguments and
 * results have the same shape, and a failure rejects with the same value.
 */

/** The header the server requires, which another origin cannot send unasked. */
const MARKER = { "x-yaz-web": "1" };

export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`/api/invoke/${encodeURIComponent(command)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...MARKER },
    body: JSON.stringify(args),
  });

  if (response.status === 422) {
    // The command's own error, exactly as Tauri would have rejected with it.
    throw await response.json();
  }
  if (!response.ok) {
    throw `${response.status} ${await response.text()}`;
  }

  if (response.headers.get("content-type")?.startsWith("application/json")) {
    return (await response.json()) as T;
  }
  return new Uint8Array(await response.arrayBuffer()) as T;
}

/** What the server says about the machine it runs on. */
export async function serverInfo(): Promise<{ home: string }> {
  const response = await fetch("/api/web/info", { headers: MARKER });
  if (!response.ok) throw `${response.status} ${await response.text()}`;
  return (await response.json()) as { home: string };
}
