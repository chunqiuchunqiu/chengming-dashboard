import { parseWithAdapter, type HeaderAliases } from "../parser-core";

const aliases: HeaderAliases = {
  occurredAt: ["交易时间", "时间"],
  category: ["交易类型", "类型"],
  counterparty: ["交易对方", "对方"],
  description: ["商品", "商品说明", "交易说明"],
  direction: ["收/支", "收支", "资金方向"],
  amount: ["金额(元)", "金额（元）", "金额"],
  paymentMethod: ["支付方式", "付款方式"],
  status: ["当前状态", "交易状态", "状态"],
  externalId: ["交易单号", "微信支付单号", "订单号"],
};

export function parseWechatBill(bytes: Uint8Array) {
  return parseWithAdapter(bytes, { source: "wechat", platformWords: ["微信", "微信支付", "交易类型"], aliases });
}
