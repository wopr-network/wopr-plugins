import { readFileSync } from "node:fs";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import type { CronScript } from "./cron-client.js";
import { CronClient, getDaemonUrl } from "./cron-client.js";

/** Parse a human-friendly time spec into epoch ms. Supports: "now", "+Ns/m/h/d", epoch, "HH:MM", ISO dates. */
function parseTimeSpec(spec: string): number {
  const now = Date.now();
  if (spec === "now") return now;

  if (spec.startsWith("+")) {
    const match = spec.match(/^\+(\d+)([smhd])$/);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = match[2] as "s" | "m" | "h" | "d";
      const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
      return now + val * mult;
    }
  }

  if (/^\d{10,13}$/.test(spec)) {
    const ts = parseInt(spec, 10);
    return ts < 1e12 ? ts * 1000 : ts;
  }

  if (/^\d{1,2}:\d{2}$/.test(spec)) {
    const [h, m] = spec.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  const parsed = Date.parse(spec);
  if (!Number.isNaN(parsed)) return parsed;

  throw new Error(`Invalid time spec: ${spec}`);
}

function printUsage(): void {
  console.log(`
wopr cron - Scheduled injection management

Usage:
  wopr cron add <name> <schedule> <session> <message> [--now] [--once] [--scripts-file <path>]
  wopr cron once <time> <session> <message>
  wopr cron now <session> <message>
  wopr cron remove <name>
  wopr cron list
`);
}

export async function cronCommandHandler(_ctx: WOPRPluginContext, args: string[]): Promise<void> {
  const client = new CronClient(getDaemonUrl());

  if (!(await client.isRunning())) {
    console.error("Daemon not running. Start it: wopr daemon start");
    process.exit(1);
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "add": {
      const flags: { now: boolean; once: boolean; scriptsFile: string | null } = {
        now: false,
        once: false,
        scriptsFile: null,
      };
      const filtered = rest.filter((a, i) => {
        if (a === "--now") {
          flags.now = true;
          return false;
        }
        if (a === "--once") {
          flags.once = true;
          return false;
        }
        if (a === "--scripts-file" && rest[i + 1]) {
          flags.scriptsFile = rest[i + 1];
          return false;
        }
        if (i > 0 && rest[i - 1] === "--scripts-file") {
          return false;
        }
        return true;
      });
      if (filtered.length < 4) {
        console.error("Usage: wopr cron add <name> <schedule> <session> <message> [--scripts-file <path>]");
        process.exit(1);
      }

      let scripts: CronScript[] | undefined;
      if (flags.scriptsFile) {
        try {
          const raw = readFileSync(flags.scriptsFile, "utf-8");
          scripts = JSON.parse(raw);
          if (!Array.isArray(scripts)) {
            console.error("Scripts file must contain a JSON array");
            process.exit(1);
          }
        } catch (err: unknown) {
          console.error(`Failed to read scripts file: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      await client.addCron({
        name: filtered[0],
        schedule: filtered[1],
        session: filtered[2],
        message: filtered.slice(3).join(" "),
        scripts,
        once: flags.once || undefined,
      });
      console.log(`Added cron: ${filtered[0]}${scripts ? ` (${scripts.length} script(s))` : ""}`);
      if (flags.now) {
        await client.inject(filtered[2], filtered.slice(3).join(" "), (msg) => {
          if (msg.type === "text") process.stdout.write(msg.content);
        });
      }
      break;
    }
    case "once": {
      if (rest.length < 3) {
        console.error("Usage: wopr cron once <time> <session> <message>");
        process.exit(1);
      }
      const runAt = parseTimeSpec(rest[0]);
      await client.addCron({
        name: `once-${Date.now()}`,
        schedule: "once",
        session: rest[1],
        message: rest.slice(2).join(" "),
        once: true,
        runAt,
      });
      console.log(`Scheduled for ${new Date(runAt).toLocaleString()}`);
      break;
    }
    case "now":
      if (rest.length < 2) {
        console.error("Usage: wopr cron now <session> <message>");
        process.exit(1);
      }
      await client.inject(rest[0], rest.slice(1).join(" "), (msg) => {
        if (msg.type === "text") process.stdout.write(msg.content);
        else if (msg.type === "complete") console.log(`\n[wopr] ${msg.content}`);
      });
      break;
    case "remove": {
      if (!rest[0]) {
        console.error("Usage: wopr cron remove <name>");
        process.exit(1);
      }
      await client.removeCron(rest[0]);
      console.log(`Removed: ${rest[0]}`);
      break;
    }
    case "list": {
      const crons = await client.getCrons();
      if (crons.length === 0) {
        console.log("No crons.");
      } else {
        console.log("Crons:");
        for (const c of crons) {
          if (c.runAt) {
            console.log(`  ${c.name}: once @ ${new Date(c.runAt).toLocaleString()}`);
          } else {
            console.log(`  ${c.name}: ${c.schedule}${c.once ? " (one-time)" : ""}`);
          }
          console.log(`    -> ${c.session}: "${c.message}"`);
          if (c.scripts && c.scripts.length > 0) {
            console.log(`    scripts: ${c.scripts.map((s: CronScript) => s.name).join(", ")}`);
          }
        }
      }
      break;
    }
    default:
      printUsage();
  }
}
