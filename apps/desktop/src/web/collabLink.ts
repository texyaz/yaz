/**
 * The link to the session host, for a yaz served to a browser (ADR-0035).
 *
 * A WebSocket to the server the page came from, at `/api/collab/link`. It
 * carries no token and no header: the session cookie and the `Origin` the
 * browser adds are what let it in, and the connection ends at this server.
 */
import type { Link } from "../lib/collab/link";

/** Open the link for a project. */
export function openLink(root: string): Link {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(
    `${scheme}://${location.host}/api/collab/link?root=${encodeURIComponent(root)}`,
  );
  socket.binaryType = "arraybuffer";

  const link: Link = {
    send(frame) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame as Uint8Array<ArrayBuffer>);
      }
    },
    close() {
      socket.close();
    },
    onopen: null,
    onframe: null,
    onclose: null,
  };
  socket.onopen = () => link.onopen?.();
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      link.onframe?.(new Uint8Array(event.data));
    }
  };
  socket.onclose = () => link.onclose?.();
  return link;
}
