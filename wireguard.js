const crypto = require("crypto");
const ProtocolAdapter = require("./ProtocolAdapter");

// استخراج مقدار خام 32 بایتی کلید X25519 از فرمت DER که Node تولید می‌کند
function rawKeyFromDer(der, isPrivate) {
  // آخرین 32 بایت ساختار DER، کلید خام X25519 است (هم برای public و هم private)
  return der.slice(der.length - 32);
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const pub = rawKeyFromDer(publicKey.export({ type: "spki", format: "der" }));
  const priv = rawKeyFromDer(privateKey.export({ type: "pkcs8", format: "der" }));
  return {
    publicKey: pub.toString("base64"),
    privateKey: priv.toString("base64"),
  };
}

class WireguardAdapter extends ProtocolAdapter {
  static key = "WIREGUARD";

  static fields = [
    { name: "address", label: "Address", type: "text", required: true, note: "مثلا 10.66.66.2/32" },
    { name: "dns", label: "DNS", type: "text", required: false, note: "مثلا 1.1.1.1" },
    { name: "publicKey", label: "Server Public Key", type: "text", required: false, note: "خالی بگذارید تا زوج کلید خودکار ساخته شود" },
    { name: "allowedIps", label: "Allowed IPs", type: "text", required: false, note: "پیش‌فرض 0.0.0.0/0" },
  ];

  static validate(input) {
    const errors = [];
    if (!input.server) errors.push("Endpoint (Server) الزامی است");
    if (!input.port || input.port < 1 || input.port > 65535) errors.push("Port نامعتبر است");
    if (!input.address) errors.push("Address الزامی است");
    return { valid: errors.length === 0, errors };
  }

  static generate(input) {
    const generatedPair = generateKeyPair();
    const serverPair = input.publicKey ? { publicKey: input.publicKey } : generateKeyPair();
    return {
      privateKey: generatedPair.privateKey, // کلاینت
      publicKey: generatedPair.publicKey, // کلاینت (اطلاعاتی)
      serverPublicKey: serverPair.publicKey,
      address: input.address,
      dns: input.dns || "1.1.1.1",
      allowedIps: input.allowedIps || "0.0.0.0/0",
    };
  }

  static normalize(settings) {
    return { dns: "1.1.1.1", allowedIps: "0.0.0.0/0", ...settings };
  }

  // توجه: Private Key هرگز در هیچ Log یا پیام خطا نمایش داده نمی‌شود.
  static parse(config) {
    const s = WireguardAdapter.normalize(config.settings);
    return [
      "[Interface]",
      `PrivateKey = ${s.privateKey}`,
      `Address = ${s.address}`,
      `DNS = ${s.dns}`,
      "",
      "[Peer]",
      `PublicKey = ${s.serverPublicKey}`,
      `Endpoint = ${config.server}:${config.port}`,
      `AllowedIPs = ${s.allowedIps}`,
      "PersistentKeepalive = 25",
    ].join("\n");
  }
}

module.exports = WireguardAdapter;
