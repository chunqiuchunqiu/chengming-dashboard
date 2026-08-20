import { parseWithAdapter, type HeaderAliases } from "../parser-core";

const aliases: HeaderAliases = {
  occurredAt: ["交易创建时间", "创建时间", "付款时间", "交易时间"],
  category: ["类型", "交易分类", "交易类型"],
  counterparty: ["交易对方", "对方"],
  description: ["商品名称", "商品说明", "备注名称"],
  direction: ["收/支", "收支", "资金方向"],
  amount: ["金额(元)", "金额（元）", "金额"],
  paymentMethod: ["支付方式", "付款方式", "资金状态"],
  status: ["交易状态", "状态"],
  externalId: ["交易号", "支付宝交易号", "订单号"],
};

export function parseAlipayBill(bytes: Uint8Array) {
  return parseWithAdapter(bytes, { source: "alipay", platformWords: ["支付宝", "余额收支明细", "交易号"], aliases });
}
