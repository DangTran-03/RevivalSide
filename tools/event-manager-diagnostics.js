const fs = require("fs");
const path = require("path");
const { createEventManager, formatEventDiagnostics } = require("../modules/event-manager");

const ROOT_DIR = path.resolve(__dirname, "..");

loadDotEnv(path.join(ROOT_DIR, ".env"));

const args = parseArgs(process.argv.slice(2));
const env = { ...process.env };
if (args.date) env.CS_EVENT_DATE = args.date;
if (args.scan) env.CS_EVENT_TABLE_SCAN = args.scan;
if (args.roots) env.CS_EVENT_TABLE_ROOTS = args.roots;
if (args.manager) env.CS_EVENT_MANAGER = args.manager;
if (args.packaged) env.CS_EVENT_TABLE_ROOTS = "gameplay-jsons/Assetbundles";
if (!env.CS_EVENT_MANAGER) env.CS_EVENT_MANAGER = "auto";

const manager = createEventManager({ rootDir: ROOT_DIR, env });
const diagnostics = manager.getDiagnostics(env.CS_EVENT_DATE, { limit: args.limit || 20 });

if (args.json) {
  process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
} else {
  process.stdout.write(formatEventDiagnostics(diagnostics));
}

process.exitCode = diagnostics.status === "ok" || args.allowWarnings ? 0 : 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--packaged") {
      result.packaged = true;
    } else if (arg === "--allow-warnings") {
      result.allowWarnings = true;
    } else if (arg === "--date") {
      result.date = argv[++index] || "";
    } else if (arg.startsWith("--date=")) {
      result.date = arg.slice("--date=".length);
    } else if (arg === "--scan") {
      result.scan = argv[++index] || "";
    } else if (arg.startsWith("--scan=")) {
      result.scan = arg.slice("--scan=".length);
    } else if (arg === "--roots") {
      result.roots = argv[++index] || "";
    } else if (arg.startsWith("--roots=")) {
      result.roots = arg.slice("--roots=".length);
    } else if (arg === "--manager") {
      result.manager = argv[++index] || "";
    } else if (arg.startsWith("--manager=")) {
      result.manager = arg.slice("--manager=".length);
    } else if (arg === "--limit") {
      result.limit = Number(argv[++index] || 0) || 0;
    } else if (arg.startsWith("--limit=")) {
      result.limit = Number(arg.slice("--limit=".length)) || 0;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }
  return result;
}

function printHelpAndExit() {
  process.stdout.write(
    [
      "Usage: node tools/event-manager-diagnostics.js [options]",
      "",
      "Options:",
      "  --date YYYY-MM-DD       Diagnose the event date.",
      "  --packaged              Use only gameplay-jsons/Assetbundles.",
      "  --scan known|all        Choose known event tables or recursive JSON scan.",
      "  --roots PATHS           Override table roots, separated by comma or semicolon.",
      "  --manager auto|1|0      Override CS_EVENT_MANAGER.",
      "  --json                  Print JSON instead of text.",
      "  --limit N               Limit list output.",
      "  --allow-warnings        Exit 0 even when diagnostics have warnings.",
      "",
    ].join("\n")
  );
  process.exit(0);
}

function loadDotEnv(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("export ")) line = line.slice("export ".length).trim();
      const equals = line.indexOf("=");
      if (equals <= 0) continue;
      const key = line.slice(0, equals).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
      let value = line.slice(equals + 1).trim();
      const quote = value[0];
      if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "");
      }
      process.env[key] = value;
    }
  } catch (error) {
    process.stderr.write(`[env] failed to load ${filePath}: ${error.message}\n`);
  }
}
