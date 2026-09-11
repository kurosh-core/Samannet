const { v4: uuidv4, validate: isUuid } = require("uuid");
const ProtocolAdapter = require("./ProtocolAdapter");

const NETWORKS = ["tcp", "ws", "grpc", "http"];

class VmessAdapter extends ProtocolAdapter {
  static key = "VMESS";

  static fields = [
    { name: "uuid", label: "UUID", type: "text", required: false },
    { name: "alterId", label: "AlterId", type: "number", required: false, note: "برای سازگاری با کلاینت‌های قدیمی، پیش‌فرض 0" },
    { name: "network", label: "Network", type: "select", options: NETWORKS, required: true },
    { name: "tls", label: "TLS", type: "select", options: ["none", "tls"], required: true },
    { name: "host", label: "Host", type: "text", required: false },
    { name: "path", label: "Path", type: "text", required: false, showIf: { network: ["ws", "http", "grpc"] } },
  ];

  static validate(input) {
    const errors = [];
    if (input.uuid && !isUuid(input.uuid)) errors.push("UUID نامعتبر است");
    if (!NETWORKS.includes(input.network)) errors.push("Network نامعتبر است");
    if (!input.server) errors.push("Server الزامی است");
    if (!input.port || input.port < 1 || input.port > 65535) errors.push("Port نامعتبر است");
    if (input.alterId !== undefined && input.alterId !== "" && Number(input.alterId) < 0) {
      errors.push("AlterId نامعتبر است");
    }
    return { valid: errors.length === 0, errors };
  }

  static generate(input) {
    return {
      uuid: input.uuid && isUuid(input.uuid) ? input.uuid : uuidv4(),
      alterId: input.alterId ? Number(input.alterId) : 0,
      network: input.network,
      tls: input.tls || "none",
      host: input.host || "",
      path: input.path || "/",
    };
  }

  static normalize(settings) {
    return { alterId: 0, network: "tcp", tls: "none", host: "", path: "/", ...settings };
  }

  static parse(config) {
    const s = VmessAdapter.normalize(config.settings);
    const obj = {
      v: "2",
      ps: config.name || "config",
      add: config.server,
      port: String(config.port),
      id: s.uuid,
      aid: String(s.alterId || 0),
      net: s.network,
      type: "none",
      host: s.host || "",
      path: s.path || "/",
      tls: s.tls === "tls" ? "tls" : "",
    };
    const json = JSON.stringify(obj);
    return `vmess://${Buffer.from(json, "utf8").toString("base64")}`;
  }
}

module.exports = VmessAdapter;
