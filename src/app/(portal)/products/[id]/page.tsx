import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ProductImage } from "@/components/ProductImage";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { formatCurrency } from "@/lib/domain";
import { canAccess, canManageCommercialCatalog } from "@/lib/permissions";
import { listProducts } from "@/lib/repository";

const detailCopy = {
  en: { eyebrow: "Catalog record", back: "Back to products", information: "Product information", pricing: "Authorized pricing", edit: "Edit product", sla: "Delivery SLA", days: "days" },
  ar: { eyebrow: "سجل الكتالوج", back: "العودة إلى المنتجات", information: "معلومات المنتج", pricing: "الأسعار المخولة", edit: "تعديل المنتج", sla: "مهلة التسليم", days: "أيام" },
  ms: { eyebrow: "Rekod katalog", back: "Kembali ke produk", information: "Maklumat produk", pricing: "Harga dibenarkan", edit: "Edit produk", sla: "SLA penghantaran", days: "hari" },
} as const;

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("manage_catalog");
  if (!canManageCommercialCatalog(actor)) notFound();
  const { id } = await params;
  const product = (await listProducts(actor)).find((item) => item.id === id);
  if (!product) notFound();

  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).products;
  const local = detailCopy[locale];
  const canViewCost = canAccess(actor, "view_internal_cost");
  const canEdit = canManageCommercialCatalog(actor);

  return <>
    <PageHeader eyebrow={local.eyebrow} title={product.name} description={product.description || copy.operationsDescription} />
    <div className="page-actions">
      <Link className="button button-secondary" href="/products">{local.back}</Link>
      {canEdit ? <Link className="button button-primary" href={`/products/${product.id}/edit`}>{local.edit}</Link> : null}
    </div>
    <section className="split-layout" style={{ alignItems: "start" }}>
      <article className="panel">
        <ProductImage product={product} locale={locale} showControls />
      </article>
      <article className="panel">
        <div className="panel-header"><div><h2>{local.information}</h2><StatusBadge status={product.status}>{localizedStatus(product.status, locale)}</StatusBadge></div></div>
        <dl className="summary-list">
          <div><dt>{copy.category}</dt><dd>{product.category} · {product.subcategory}</dd></div>
          <div><dt>{copy.brand}</dt><dd>{product.brand || "—"}</dd></div>
          <div><dt>{copy.size}</dt><dd>{product.size || "—"}</dd></div>
          <div><dt>{copy.unit}</dt><dd>{product.unit}</dd></div>
          <div><dt>{local.sla}</dt><dd>{product.deliverySlaDays} {local.days}</dd></div>
          <div><dt>{copy.sellPrice}</dt><dd>{formatCurrency(product.defaultSellPrice, locale)}</dd></div>
          {canViewCost ? <div><dt>{copy.buyCost}</dt><dd>{formatCurrency(product.defaultBuyPrice, locale)}</dd></div> : null}
        </dl>
      </article>
    </section>
  </>;
}
