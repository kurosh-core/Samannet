const crypto = require("crypto");
const ProtocolAdapter = require("./ProtocolAdapter");

const NETWORKS = ["tcp", "ws", "grpc"];

class TrojanAdapter extends ProtocolAdapter {
  static key = "TROJAN";

  static fields = [
    { name: "password", label: "Password", type: "text", required: false, note: "خالی بگذارید تا خودکار ساخته شود" },
    { name: "network", label: "Network", type: "select", options: NETWORKS, required: true },
    { name: "sni", label: "SNI", type: "text", required: false },
  ];

  static validate(input) {
    const errors = [];
    if (!NETWORKS.includes(input.network)) errors.push("Network نامعتبر است");
    if (!input.server) errors.push("Server الزامی است");
    if (!input.port || input.port < 1 || input.port > 65535) errors.push("Port نامعتبر است");
    return { valid: errors.length === 0, errors };
  }

  static generate(input) {
    return {
      password: input.password && input.password.length >= 6 ? input.password : crypto.randomBytes(12).toString("hex"),
      network: input.network,
      sni: input.sni || "",
    };
  }

  static normalize(settings) {
    return { network: "tcp", sni: "", ...settings };
  }

  static parse(config) {
    const s = TrojanAdapter.normalize(config.settings);
    const params = new URLSearchParams();
    params.set("type", s.network);
    if (s.sni) params.set("sni", s.sni);
    const tag = encodeURIComponent(config.name || "config");
    return `trojan://${encodeURIComponent(s.password)}@${config.server}:${config.port}?${params.toString()}#${tag}`;
  }
}

module.exports = TrojanAdapter;
