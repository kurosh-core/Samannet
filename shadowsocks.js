const crypto = require("crypto");
const ProtocolAdapter = require("./ProtocolAdapter");

const METHODS = [
  "aes-256-gcm",
  "aes-128-gcm",
  "chacha20-ietf-poly1305",
  "2022-blake3-aes-256-gcm",
];

class ShadowsocksAdapter extends ProtocolAdapter {
  static key = "SHADOWSOCKS";

  static fields = [
    { name: "method", label: "Method", type: "select", options: METHODS, required: true },
    { name: "password", label: "Password", type: "text", required: false, note: "خالی بگذارید تا خودکار ساخته شود" },
  ];

  static validate(input) {
    const errors = [];
    if (!METHODS.includes(input.method)) errors.push("Method نامعتبر است");
    if (!input.server) errors.push("Server الزامی است");
    if (!input.port || input.port < 1 || input.port > 65535) errors.push("Port نامعتبر است");
    return { valid: errors.length === 0, errors };
  }

  static generate(input) {
    return {
      method: input.method,
      password: input.password && input.password.length >= 6 ? input.password : crypto.randomBytes(12).toString("base64"),
    };
  }

  static normalize(settings) {
    return { method: "aes-256-gcm", ...settings };
  }

  static parse(config) {
    const s = ShadowsocksAdapter.normalize(config.settings);
    const userinfo = Buffer.from(`${s.method}:${s.password}`, "utf8").toString("base64url");
    const tag = encodeURIComponent(config.name || "config");
    return `ss://${userinfo}@${config.server}:${config.port}#${tag}`;
  }
}

module.exports = ShadowsocksAdapter;
