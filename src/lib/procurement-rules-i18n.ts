import type { SupportedLocale } from "./i18n";

interface ProcurementRulesMessages {
  automaticMarkup: string;
  calculatedSellingPrice: string;
  calculatedSellingHelp: string;
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
  priceChangedTitle: "Catalog prices changed",
  priceChangedBody: (count) => `${count} cart ${count === 1 ? "price was" : "prices were"} refreshed before submission. Review and acknowledge the current total.`,
  acknowledgePrices: "I reviewed the refreshed selling prices and total.",
  acknowledgePricesError: "Review and acknowledge the refreshed selling prices before submitting.",
  history: "Commercial price history",
  historyBody: "Platform-only evidence of confidential base cost, pricing version, markup, and deterministic selling price.",
  historyEmpty: "No commercial price history is available.",
  baseCost: "Base cost",
  sellingPrice: "Selling price",
  markup: "Markup",
  version: "Pricing version",
};

const ar: ProcurementRulesMessages = {
  automaticMarkup: "هامش تجاري تلقائي بنسبة 10٪",
  calculatedSellingPrice: "سعر البيع المحسوب للعميل",
  calculatedSellingHelp: "تحسب أكسورا هذا السعر من التكلفة الأساسية السرية وقاعدة التسعير النشطة. تبقى الضريبة والتسليم منفصلين.",
  priceChangedTitle: "تغيرت أسعار الكتالوج",
  priceChangedBody: (count) => `تم تحديث ${count} من أسعار السلة قبل الإرسال. راجع الإجمالي الحالي وأكده.`,
  acknowledgePrices: "راجعت أسعار البيع والإجمالي بعد التحديث.",
  acknowledgePricesError: "راجع أسعار البيع المحدثة وأكدها قبل إرسال الطلب.",
  history: "سجل الأسعار التجارية",
  historyBody: "دليل خاص بالمنصة للتكلفة الأساسية السرية وإصدار التسعير والهامش وسعر البيع المحسوب.",
  historyEmpty: "لا يتوفر سجل للأسعار التجارية.",
  baseCost: "التكلفة الأساسية",
  sellingPrice: "سعر البيع",
  markup: "الهامش",
  version: "إصدار التسعير",
};

const ms: ProcurementRulesMessages = {
  automaticMarkup: "Tokokan komersial automatik 10%",
  calculatedSellingPrice: "Harga jualan pelanggan yang dikira",
  calculatedSellingHelp: "Axora mengira harga ini daripada kos asas sulit dan peraturan harga aktif. Cukai dan penghantaran kekal berasingan.",
  priceChangedTitle: "Harga katalog berubah",
  priceChangedBody: (count) => `${count} harga troli dikemas kini sebelum penghantaran. Semak dan akui jumlah semasa.`,
  acknowledgePrices: "Saya telah menyemak harga jualan dan jumlah yang dikemas kini.",
  acknowledgePricesError: "Semak dan akui harga jualan yang dikemas kini sebelum menghantar.",
  history: "Sejarah harga komersial",
  historyBody: "Bukti khusus platform bagi kos asas sulit, versi harga, tokokan dan harga jualan deterministik.",
  historyEmpty: "Tiada sejarah harga komersial tersedia.",
  baseCost: "Kos asas",
  sellingPrice: "Harga jualan",
  markup: "Tokokan",
  version: "Versi harga",
};

const messages: Record<SupportedLocale, ProcurementRulesMessages> = { en, ar, ms };

export function procurementRulesMessages(locale: SupportedLocale = "en") {
  return messages[locale];
}
