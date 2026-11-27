/**
 * `@tauri-apps/plugin-dialog`, for a yaz served to a browser (ADR-0030).
 *
 * Every dialog yaz opens asks for a folder **on the machine yaz runs on**,
 * which is not the machine the browser is on — so the browser's own file
 * picker would be browsing the wrong disk. The path is typed instead, starting
 * from the server's home directory and remembering the last answer.
 */

import { t } from "../lib/i18n";
import { serverInfo } from "./core";

const REMEMBERED = "yaz.web.last-directory";

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

export async function open(_options?: {
  directory?: boolean;
  multiple?: boolean;
}): Promise<string | null> {
  let start = remembered();
  if (start === null) {
    try {
      start = (await serverInfo()).home;
    } catch {
      start = "";
    }
  }

  const answer = window.prompt(t("web-choose-directory"), start)?.trim();
  if (!answer) return null;

  try {
    localStorage.setItem(REMEMBERED, answer);
  } catch {
    // Private browsing: the next prompt starts from home again.
  }
  return answer;
}
