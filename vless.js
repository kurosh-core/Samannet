const { v4: uuidv4, validate: isUuid } = require("uuid");
const ProtocolAdapter = require("./ProtocolAdapter");

const NETWORKS = ["tcp", "ws", "grpc", "http"];
const SECURITY = ["none", "tls", "reality"];

class VlessAdapter extends ProtocolAdapter {
  static key = "VLESS";

  static fields = [
    { name: "uuid", label: "UUID", type: "text", required: false, note: "خالی بگذارید تا خودکار ساخته شود" },
    { name: "network", label: "Network", type: "select", options: NETWORKS, required: true },
    { name: "security", label: "TLS / Security", type: "select", options: SECURITY, required: true },
    { name: "sni", label: "SNI", type: "text", required: false, showIf: { security: ["tls", "reality"] } },
    { name: "flow", label: "Flow", type: "select", options: ["", "xtls-rprx-vision"], required: false },
    { name: "path", label: "Path", type: "text", required: false, showIf: { network: ["ws", "http", "grpc"] } },
    { name: "host", label: "Host", type: "text", required: false, showIf: { network: ["ws", "http"] } },
  ];

  static validate(input) {
    const errors = [];
    if (input.uuid && !isUuid(input.uuid)) errors.push("UUID نامعتبر است");
    if (!NETWORKS.includes(input.network)) errors.push("Network نامعتبر است");
    if (!SECURITY.includes(input.security)) errors.push("Security نامعتبر است");
    if (!input.server) errors.push("Server الزامی است");
    if (!input.port || input.port < 1 || input.port > 65535) errors.push("Port نامعتبر است");
    return { valid: errors.length === 0, errors };
  }

  static generate(input) {
    return {
      uuid: input.uuid && isUuid(input.uuid) ? input.uuid : uuidv4(),
      network: input.network,
      security: input.security,
      sni: input.sni || "",
      flow: input.flow || "",
      path: input.path || "/",
      host: input.host || "",
    };
  }

  static normalize(settings) {
    return {
      network: "tcp",
      security: "none",
      sni: "",
      flow: "",
      path: "/",
      host: "",
      ...settings,
    };
  }

  static parse(config) {
    const s = VlessAdapter.normalize(config.settings);
    const params = new URLSearchParams();
    params.set("type", s.network);
    params.set("security", s.security);
    if (s.sni) params.set("sni", s.sni);
    if (s.flow) params.set("flow", s.flow);
    if (s.host) params.set("host", s.host);
    if (s.network === "ws" || s.network === "http" || s.network === "grpc") {
      params.set("path", s.path || "/");
    }
    const tag = encodeURIComponent(config.name || "config");
    return `vless://${s.uuid}@${config.server}:${config.port}?${params.toString()}#${tag}`;
  }
}

module.exports = VlessAdapter;
