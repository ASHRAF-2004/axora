import type { SupportedLocale } from "./i18n";
import type { ProductQuantityRule } from "./procurement-rules";

interface ProcurementRulesMessages {
  automaticMarkup: string;
  calculatedSellingPrice: string;
  calculatedSellingHelp: string;
  supplierRule: string;
  minimum: string;
  maximum: string;
  noMaximum: string;
  increment: string;
  packSize: string;
  packUnit: string;
  effectiveFrom: string;
  changeReason: string;
  changeReasonPlaceholder: string;
  quantitySummary: (rule: ProductQuantityRule) => string;
  packSummary: (size: number, unit: string) => string;
  quantityError: (rule: ProductQuantityRule) => string;
  priceChangedTitle: string;
  priceChangedBody: (count: number) => string;
  acknowledgePrices: string;
  acknowledgePricesError: string;
  history: string;
  historyBody: string;
  historyEmpty: string;
  baseCost: string;
  sellingPrice: string;
  markup: string;
  version: string;
}

const en: ProcurementRulesMessages = {
  automaticMarkup: "Automatic 10% commercial markup",
  calculatedSellingPrice: "Calculated customer selling price",
  calculatedSellingHelp: "Axora calculates this from the confidential base cost and the active pricing rule. Tax and delivery remain separate.",
  supplierRule: "Preferred supplier ordering rule",
  minimum: "Minimum quantity",
  maximum: "Maximum quantity",
  noMaximum: "No maximum",
  increment: "Order increment",
  packSize: "Units per pack",
  packUnit: "Pack unit",
  effectiveFrom: "Effective from",
  changeReason: "Rule change reason",
  changeReasonPlaceholder: "Why this supplier-product rule is correct",
  quantitySummary: (rule) => `Min ${rule.minimum}${rule.maximum === undefined ? "" : ` · Max ${rule.maximum}`} · Step ${rule.increment}`,
  packSummary: (size, unit) => `${size} ${unit} per order unit`,
  quantityError: (rule) => `Use a whole quantity from ${rule.minimum}${rule.maximum === undefined ? "" : ` to ${rule.maximum}`} in increments of ${rule.increment}.`,
  priceChangedTitle: "Catalog prices changed",
  priceChangedBody: (count) => `${count} cart ${count === 1 ? "price was" : "prices were"} refreshed before submission. Review and acknowledge the current total.`,
  acknowledgePrices: "I reviewed the refreshed selling prices and total.",
  acknowledgePricesError: "Review and acknowledge the refreshed selling prices before submitting.",
  history: "Commercial price history",
  historyBody: "Platform-only evidence of confidential base cost, rule version, markup, and deterministic selling price.",
  historyEmpty: "No commercial price history is available.",
  baseCost: "Base cost",
  sellingPrice: "Selling price",
  markup: "Markup",
  version: "Rule version",
};

const ar: ProcurementRulesMessages = {
  automaticMarkup: "هامش تجاري تلقائي بنسبة 10٪",
  calculatedSellingPrice: "سعر البيع المحسوب للعميل",
  calculatedSellingHelp: "تحسب أكسورا هذا السعر من التكلفة الأساسية السرية وقاعدة التسعير النشطة. تبقى الضريبة والتسليم منفصلين.",
  supplierRule: "قاعدة الطلب للمورد المفضل",
  minimum: "الكمية الدنيا",
  maximum: "الكمية القصوى",
  noMaximum: "بلا حد أقصى",
  increment: "زيادة الطلب",
  packSize: "الوحدات في العبوة",
  packUnit: "وحدة العبوة",
  effectiveFrom: "سارية من",
  changeReason: "سبب تغيير القاعدة",
  changeReasonPlaceholder: "لماذا قاعدة المورد والمنتج هذه صحيحة",
  quantitySummary: (rule) => `الحد الأدنى ${rule.minimum}${rule.maximum === undefined ? "" : ` · الأقصى ${rule.maximum}`} · الزيادة ${rule.increment}`,
  packSummary: (size, unit) => `${size} ${unit} لكل وحدة طلب`,
  quantityError: (rule) => `استخدم كمية صحيحة تبدأ من ${rule.minimum}${rule.maximum === undefined ? "" : ` ولا تتجاوز ${rule.maximum}`} وبزيادة ${rule.increment}.`,
  priceChangedTitle: "تغيرت أسعار الكتالوج",
  priceChangedBody: (count) => `تم تحديث ${count} من أسعار السلة قبل الإرسال. راجع الإجمالي الحالي وأكده.`,
  acknowledgePrices: "راجعت أسعار البيع والإجمالي بعد التحديث.",
  acknowledgePricesError: "راجع أسعار البيع المحدثة وأكدها قبل إرسال الطلب.",
  history: "سجل الأسعار التجارية",
  historyBody: "دليل خاص بالمنصة للتكلفة الأساسية السرية وإصدار القاعدة والهامش وسعر البيع المحسوب.",
  historyEmpty: "لا يتوفر سجل للأسعار التجارية.",
  baseCost: "التكلفة الأساسية",
  sellingPrice: "سعر البيع",
  markup: "الهامش",
  version: "إصدار القاعدة",
};

const ms: ProcurementRulesMessages = {
  automaticMarkup: "Tokokan komersial automatik 10%",
  calculatedSellingPrice: "Harga jualan pelanggan yang dikira",
  calculatedSellingHelp: "Axora mengira harga ini daripada kos asas sulit dan peraturan harga aktif. Cukai dan penghantaran kekal berasingan.",
  supplierRule: "Peraturan pesanan pembekal pilihan",
  minimum: "Kuantiti minimum",
  maximum: "Kuantiti maksimum",
  noMaximum: "Tiada maksimum",
  increment: "Kenaikan pesanan",
  packSize: "Unit setiap pek",
  packUnit: "Unit pek",
  effectiveFrom: "Berkuat kuasa dari",
  changeReason: "Sebab perubahan peraturan",
  changeReasonPlaceholder: "Mengapa peraturan pembekal-produk ini betul",
  quantitySummary: (rule) => `Min ${rule.minimum}${rule.maximum === undefined ? "" : ` · Maks ${rule.maximum}`} · Langkah ${rule.increment}`,
  packSummary: (size, unit) => `${size} ${unit} bagi setiap unit pesanan`,
  quantityError: (rule) => `Gunakan kuantiti bulat dari ${rule.minimum}${rule.maximum === undefined ? "" : ` hingga ${rule.maximum}`} dalam kenaikan ${rule.increment}.`,
  priceChangedTitle: "Harga katalog berubah",
  priceChangedBody: (count) => `${count} harga troli dikemas kini sebelum penghantaran. Semak dan akui jumlah semasa.`,
  acknowledgePrices: "Saya telah menyemak harga jualan dan jumlah yang dikemas kini.",
  acknowledgePricesError: "Semak dan akui harga jualan yang dikemas kini sebelum menghantar.",
  history: "Sejarah harga komersial",
  historyBody: "Bukti khusus platform bagi kos asas sulit, versi peraturan, tokokan dan harga jualan deterministik.",
  historyEmpty: "Tiada sejarah harga komersial tersedia.",
  baseCost: "Kos asas",
  sellingPrice: "Harga jualan",
  markup: "Tokokan",
  version: "Versi peraturan",
};

const messages: Record<SupportedLocale, ProcurementRulesMessages> = { en, ar, ms };

export function procurementRulesMessages(locale: SupportedLocale = "en") {
  return messages[locale];
}
