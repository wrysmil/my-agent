import { registerChatIpc } from "./chat.js";
import { registerSessionsIpc } from "./sessions.js";
import { registerConfigIpc } from "./config.js";
import { registerSkillsIpc } from "./skills.js";

export function registerIpcHandlers(): void {
  registerChatIpc();
  registerSessionsIpc();
  registerConfigIpc();
  registerSkillsIpc();
}
