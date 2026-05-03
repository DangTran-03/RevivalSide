const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const assemblyDir = path.join(root, "Assembly-CSharp");
const outputPath = path.join(root, "packet-schema.json");

const primitiveTypes = new Set([
  "bool",
  "sbyte",
  "byte",
  "short",
  "ushort",
  "int",
  "uint",
  "long",
  "ulong",
  "float",
  "double",
  "string",
  "DateTime",
  "TimeSpan",
  "BitArray",
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "bin" || entry.name === "obj") {
        continue;
      }
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".cs")) {
      files.push(fullPath);
    }
  }
  return files;
}

function cleanSource(source) {
  return source
    .replace(/\/\/ Token:[^\n]*\n/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function normalizeType(type) {
  return type
    .replace(/\bglobal::/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*<\s*/g, "<")
    .replace(/\s*>\s*/g, ">")
    .trim();
}

function shortType(type) {
  const normalized = normalizeType(type);
  const generic = normalized.match(/^([A-Za-z0-9_.]+)<(.+)>$/);
  if (generic) {
    return `${shortType(generic[1])}<${splitGenericArgs(generic[2]).map(shortType).join(", ")}>`;
  }
  return normalized.split(".").pop();
}

function splitGenericArgs(args) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === "<") depth += 1;
    if (ch === ">") depth -= 1;
    if (ch === "," && depth === 0) {
      result.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(args.slice(start).trim());
  return result.filter(Boolean);
}

function classifyType(type, callKind) {
  const typeName = shortType(type);
  if (callKind === "AsHalf") {
    return { kind: "half", type: "float" };
  }
  if (callKind === "PutOrGetEnum") {
    let match = typeName.match(/^List<(.+)>$/);
    if (match) {
      return { kind: "list", type: typeName, element: { kind: "enum", type: match[1] } };
    }
    match = typeName.match(/^HashSet<(.+)>$/);
    if (match) {
      return { kind: "hashSet", type: typeName, element: { kind: "enum", type: match[1] } };
    }
    return { kind: "enum", type: typeName };
  }
  if (typeName === "byte[]") {
    return { kind: "byteArray", type: typeName };
  }
  if (typeName.endsWith("[]")) {
    return { kind: "array", type: typeName.slice(0, -2), element: classifyType(typeName.slice(0, -2), "PutOrGet") };
  }
  let match = typeName.match(/^List<(.+)>$/);
  if (match) {
    return { kind: "list", type: typeName, element: classifyType(match[1], "PutOrGet") };
  }
  match = typeName.match(/^HashSet<(.+)>$/);
  if (match) {
    return { kind: "hashSet", type: typeName, element: classifyType(match[1], "PutOrGet") };
  }
  match = typeName.match(/^Dictionary<(.+)>$/);
  if (match) {
    const [keyType, valueType] = splitGenericArgs(match[1]);
    return {
      kind: "dictionary",
      type: typeName,
      key: classifyType(keyType, "PutOrGet"),
      value: classifyType(valueType, "PutOrGet"),
    };
  }
  if (primitiveTypes.has(typeName)) {
    return { kind: "primitive", type: typeName };
  }
  return { kind: "object", type: typeName };
}

function inferDirection(name) {
  if (name.endsWith("_REQ")) return "client->server";
  if (name.endsWith("_ACK") || name.endsWith("_NOT")) return "server->client";
  return "shared";
}

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const source = cleanSource(raw);
  const namespaceMatch = source.match(/\bnamespace\s+([A-Za-z0-9_.]+)/);
  const namespace = namespaceMatch ? namespaceMatch[1] : "";
  const classMatch = source.match(/\b(?:public|internal)?\s*(?:sealed\s+)?class\s+([A-Za-z0-9_]+)\b[\s\S]*?\bISerializable\b/);
  if (!classMatch) {
    return null;
  }

  const className = classMatch[1];
  const packetIdMatch = source.match(/\[PacketId\(ClientPacketId\.([A-Za-z0-9_]+)\)\]/);
  const fieldTypes = {};
  const fieldPattern = /\bpublic\s+([A-Za-z0-9_<>,.\[\]\s]+?)\s+([A-Za-z0-9_]+)(?:\s*=\s*[^;]+)?;/g;
  for (const match of source.matchAll(fieldPattern)) {
    fieldTypes[match[2]] = normalizeType(match[1]);
  }

  const serializeMatch = source.match(/void\s+ISerializable\.Serialize\s*\(\s*IPacketStream\s+stream\s*\)\s*\{([\s\S]*?)\n\s*\}/);
  if (!serializeMatch) {
    return null;
  }

  const fields = [];
  const callPattern = /stream\.(PutOrGetEnum|PutOrGet|AsHalf)(?:<([^>]+)>)?\s*\(\s*ref\s+this\.([A-Za-z0-9_]+)\s*\)/g;
  for (const match of serializeMatch[1].matchAll(callPattern)) {
    const call = match[1];
    const generic = match[2] ? normalizeType(match[2]) : null;
    const name = match[3];
    const declaredType = fieldTypes[name] || generic || "unknown";
    const effectiveType = call === "PutOrGetEnum" && generic ? generic : declaredType;
    fields.push({
      name,
      declaredType: shortType(declaredType),
      call,
      wire: classifyType(effectiveType, call),
    });
  }

  return {
    name: className,
    namespace,
    fullName: namespace ? `${namespace}.${className}` : className,
    packetIdName: packetIdMatch ? packetIdMatch[1] : null,
    direction: packetIdMatch ? inferDirection(packetIdMatch[1].replace(/^k/, "")) : "shared",
    source: path.relative(root, filePath).replace(/\\/g, "/"),
    fields,
  };
}

function parsePacketIds() {
  const enumPath = path.join(assemblyDir, "Protocol", "ClientPacketId.cs");
  const source = cleanSource(fs.readFileSync(enumPath, "utf8"));
  const body = source.match(/enum\s+ClientPacketId\s*:\s*ushort\s*\{([\s\S]*?)\n\s*\}/);
  if (!body) {
    throw new Error(`Could not parse ${enumPath}`);
  }

  const ids = {};
  let current = -1;
  for (const line of body[1].split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_]+)(?:\s*=\s*(\d+))?,?/);
    if (!match) continue;
    current = match[2] ? Number(match[2]) : current + 1;
    ids[match[1]] = current;
  }
  return ids;
}

function main() {
  const packetIds = parsePacketIds();
  const serializables = {};
  const packets = {};
  const warnings = [];

  for (const file of walk(assemblyDir)) {
    const parsed = parseFile(file);
    if (!parsed) continue;
    serializables[parsed.name] = parsed;
    if (parsed.packetIdName) {
      const id = packetIds[parsed.packetIdName];
      if (id == null) {
        warnings.push(`Missing enum value for ${parsed.packetIdName} (${parsed.fullName})`);
        continue;
      }
      packets[String(id)] = { id, ...parsed };
    }
  }

  const schema = {
    generatedAt: new Date().toISOString(),
    source: "Assembly-CSharp decompiled ISerializable.Serialize order",
    packets,
    types: serializables,
    warnings,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
  const c2s = Object.values(packets).filter((packet) => packet.direction === "client->server").length;
  const s2c = Object.values(packets).filter((packet) => packet.direction === "server->client").length;
  console.log(`Wrote ${outputPath}`);
  console.log(`Packets: ${Object.keys(packets).length} (${c2s} client->server, ${s2c} server->client)`);
  console.log(`Serializable types: ${Object.keys(serializables).length}`);
  if (warnings.length > 0) {
    console.log(`Warnings: ${warnings.length}`);
  }
}

main();
