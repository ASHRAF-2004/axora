import type { SupportedLocale } from "./i18n";

type CategoryImage = {
  avif: string;
  webp: string;
  alt: Record<SupportedLocale, string>;
};

const categoryImages: Record<string, CategoryImage> = {
  "IT & Equipment": image("it-equipment", "Computer equipment arranged for a workplace", "معدات حاسوب مرتبة لمكان العمل", "Peralatan komputer untuk ruang kerja"),
  "Facilities / Services": image("facilities-services", "Facilities and workplace services", "خدمات ومرافق مكان العمل", "Kemudahan dan perkhidmatan tempat kerja"),
  "Office Supplies": image("office-supplies", "Everyday office supplies", "لوازم مكتبية يومية", "Bekalan pejabat harian"),
  "Office Basics": image("office-basics", "Essential items for an office", "مستلزمات أساسية للمكتب", "Keperluan asas pejabat"),
  "Pantry & Refreshments": image("pantry-refreshments", "Pantry refreshments and drinks", "مرطبات ومشروبات للمطبخ", "Minuman dan hidangan ringan pantri"),
  "Pantry / Hospitality": image("pantry-hospitality", "Hospitality and pantry essentials", "أساسيات الضيافة والمطبخ", "Keperluan hospitaliti dan pantri"),
  "Cleaning & Hygiene": image("cleaning-hygiene", "Cleaning and hygiene supplies", "مستلزمات التنظيف والنظافة", "Bekalan pembersihan dan kebersihan"),
  Furniture: image("furniture", "Workplace furniture", "أثاث مكان العمل", "Perabot tempat kerja"),
  "Safety & Security": image("safety-security", "Workplace safety and security equipment", "معدات السلامة والأمن", "Peralatan keselamatan dan sekuriti"),
  Maintenance: image("maintenance", "Maintenance tools and supplies", "أدوات ومستلزمات الصيانة", "Alat dan bekalan penyelenggaraan"),
  "Printing & Stationery": image("printing-stationery", "Printing and stationery supplies", "مستلزمات الطباعة والقرطاسية", "Bekalan percetakan dan alat tulis"),
  "Printing & Branding / Marketing": image("printing-branding", "Printed branding and marketing materials", "مواد مطبوعة للعلامة التجارية والتسويق", "Bahan percetakan penjenamaan dan pemasaran"),
  "Uniforms & Apparel": image("uniforms-apparel", "Work uniforms and apparel", "زي وملابس العمل", "Uniform dan pakaian kerja"),
  Other: image("other", "Additional workplace products", "منتجات إضافية لمكان العمل", "Produk tempat kerja tambahan"),
};

function image(slug: string, en: string, ar: string, ms: string): CategoryImage {
  return {
    avif: `/catalog/categories/${slug}.avif`,
    webp: `/catalog/categories/${slug}.webp`,
    alt: { en, ar, ms },
  };
}

export function categoryImage(category: string, locale: SupportedLocale) {
  const item = categoryImages[category] ?? categoryImages.Other;
  return {
    avif: item.avif,
    webp: item.webp,
    srcSet: { avif: item.avif, webp: item.webp },
    alt: item.alt[locale],
  };
}

export const CATEGORY_IMAGE_CATEGORIES = Object.freeze(Object.keys(categoryImages));
