/**
 * Path constants for skills plugin - moved from core
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const WOPR_HOME = process.env.WOPR_HOME || join(homedir(), ".wopr");
export const SKILLS_DIR = join(WOPR_HOME, "skills");
export const PROJECT_SKILLS_DIR = join(process.cwd(), ".wopr", "skills");
export const REGISTRIES_FILE = join(WOPR_HOME, "registries.json");
