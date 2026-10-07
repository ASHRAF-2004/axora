import type { SupportedLocale } from "./profile-preferences";

const messages = {
  en: {
    label: "Delete permanently", title: "Delete product permanently?",
    body: (name: string) => `“${name}” will be permanently removed. This cannot be undone. Products with purchase, cart, or draft references remain protected.`,
    cancel: "Keep product", pending: "Deleting product…",
    errors: {
      PURCHASE_HISTORY: "This product is used in purchase history and cannot be permanently deleted. Deactivate it instead.",
      CART: "This product is still referenced by a shopping cart and cannot be permanently deleted. Deactivate it instead.",
      DRAFT: "This product is referenced by an integration request draft and cannot be permanently deleted. Deactivate it instead.",
      PROTECTED: "This product has protected references and cannot be permanently deleted. Deactivate it instead.",
      FORBIDDEN: "Your account cannot permanently delete this product.",
      UNAVAILABLE: "The product could not be deleted. Please try again.",
    },
  },
  ar: {
    label: "حذف نهائي", title: "هل تريد حذف المنتج نهائيًا؟",
    body: (name: string) => `سيتم حذف «${name}» نهائيًا. لا يمكن التراجع عن ذلك. تظل المنتجات المرتبطة بالمشتريات أو سلات التسوق أو المسودات محمية.`,
    cancel: "الاحتفاظ بالمنتج", pending: "جارٍ حذف المنتج…",
    errors: {
      PURCHASE_HISTORY: "هذا المنتج مستخدم في سجل المشتريات ولا يمكن حذفه نهائيًا. يمكنك تعطيله بدلًا من ذلك.",
      CART: "لا يزال هذا المنتج مرتبطًا بسلة تسوق ولا يمكن حذفه نهائيًا. يمكنك تعطيله بدلًا من ذلك.",
      DRAFT: "هذا المنتج مرتبط بمسودة طلب من أحد التكاملات ولا يمكن حذفه نهائيًا. يمكنك تعطيله بدلًا من ذلك.",
      PROTECTED: "لهذا المنتج مراجع محمية ولا يمكن حذفه نهائيًا. يمكنك تعطيله بدلًا من ذلك.",
      FORBIDDEN: "ليس لدى حسابك صلاحية حذف هذا المنتج نهائيًا.",
      UNAVAILABLE: "تعذر حذف المنتج. يرجى المحاولة مرة أخرى.",
    },
  },
  ms: {
    label: "Padam secara kekal", title: "Padam produk secara kekal?",
    body: (name: string) => `“${name}” akan dipadam secara kekal. Tindakan ini tidak boleh dibatalkan. Produk yang dirujuk oleh pembelian, troli atau draf kekal dilindungi.`,
    cancel: "Kekalkan produk", pending: "Memadam produk…",
    errors: {
      PURCHASE_HISTORY: "Produk ini digunakan dalam sejarah pembelian dan tidak boleh dipadam secara kekal. Nyahaktifkannya sebagai alternatif.",
      CART: "Produk ini masih dirujuk oleh troli beli-belah dan tidak boleh dipadam secara kekal. Nyahaktifkannya sebagai alternatif.",
      DRAFT: "Produk ini dirujuk oleh draf permintaan integrasi dan tidak boleh dipadam secara kekal. Nyahaktifkannya sebagai alternatif.",
      PROTECTED: "Produk ini mempunyai rujukan yang dilindungi dan tidak boleh dipadam secara kekal. Nyahaktifkannya sebagai alternatif.",
      FORBIDDEN: "Akaun anda tidak dibenarkan memadam produk ini secara kekal.",
      UNAVAILABLE: "Produk tidak dapat dipadam. Sila cuba lagi.",
    },
  },
};

export function productDeletionMessages(locale: SupportedLocale) {
  return messages[locale];
}
