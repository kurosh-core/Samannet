const VlessAdapter = require("./vless");
const VmessAdapter = require("./vmess");
const TrojanAdapter = require("./trojan");
const ShadowsocksAdapter = require("./shadowsocks");
const WireguardAdapter = require("./wireguard");

const registry = {
  VLESS: VlessAdapter,
  VMESS: VmessAdapter,
  TROJAN: TrojanAdapter,
  SHADOWSOCKS: ShadowsocksAdapter,
  WIREGUARD: WireguardAdapter,
};

function getAdapter(protocol) {
  const adapter = registry[protocol];
  if (!adapter) throw new Error(`پروتکل پشتیبانی نمی‌شود: ${protocol}`);
  return adapter;
}

function listProtocols() {
  return Object.entries(registry).map(([key, adapter]) => ({
    key,
    fields: adapter.fields,
  }));
}

module.exports = { getAdapter, listProtocols, registry };
