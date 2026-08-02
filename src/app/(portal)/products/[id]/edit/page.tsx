/* eslint-disable @next/next/no-img-element */

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { MAX_PRODUCT_IMAGES, listProductImages } from "@/lib/product-images";
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from "@/lib/product-options";
import { listProducts, listSuppliers } from "@/lib/repository";
import { ArrowLeft, ImagePlus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addProductImagesAction,
  removeProductImageAction,
  setPrimaryProductImageAction,
  updateProductAction,
  updateProductImageAltTextAction,
} from "../../../masters/actions";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { productEditorMessages } from "@/lib/product-editor-i18n";

function optionsWithCurrent(options: readonly string[], current: string) {
  return options.includes(current) ? options : [current, ...options];
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("manage_catalog");
  const locale = actor.preferredLocale ?? "en";
  const productCopy = corePortalMessages(locale).products;
  const copy = productEditorMessages(locale);
  const { id } = await params;
  const [products, suppliers, images] = await Promise.all([
    listProducts(actor),
    listSuppliers(actor),
    listProductImages(id, actor),
  ]);
  const product = products.find((item) => item.id === id);
  if (!product) notFound();

  const categories = optionsWithCurrent(PRODUCT_CATEGORIES, product.category);
  const units = optionsWithCurrent(PRODUCT_UNITS, product.unit);

  return <>
    <PageHeader
      eyebrow={copy.eyebrow}
      title={product.name}
      description={copy.description}
    />

    <div className="toolbar" style={{ marginBlockEnd: 18 }}>
      <Link className="button button-secondary" href="/products"><ArrowLeft className="directional-icon" aria-hidden="true" size={16} />{copy.back}</Link>
      <div className="toolbar-group"><span className="subtle">{product.code}</span><StatusBadge status={product.status}>{localizedStatus(product.status, locale)}</StatusBadge></div>
    </div>

    <section className="split-layout" style={{ alignItems: "start" }}>
      <form action={updateProductAction.bind(null, product.id)} className="panel form-panel">
        <div className="panel-header"><div><h2>{copy.information}</h2><p>{copy.informationBody}</p></div></div>
        <div className="form-grid">
          <label className="field-full">{productCopy.name}<input name="name" defaultValue={product.name} required /></label>
          <label>{productCopy.category}<select name="category" defaultValue={product.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>{productCopy.subcategory}<input name="subcategory" defaultValue={product.subcategory} required /></label>
          <label>{productCopy.brand}<input name="brand" defaultValue={product.brand} /></label>
          <label>{productCopy.size}<input name="size" defaultValue={product.size} /></label>
          <label>{productCopy.unit}<select name="unit" defaultValue={product.unit}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
          <label>{productCopy.packaging}<input name="packaging" defaultValue={product.packaging} /></label>
          <label>{productCopy.buyCost}<input name="defaultBuyPrice" type="number" min="0" step="0.01" defaultValue={product.defaultBuyPrice} required /></label>
          <label>{productCopy.sellPrice}<input name="defaultSellPrice" type="number" min="0.01" step="0.01" defaultValue={product.defaultSellPrice} required /></label>
          <label>{productCopy.minimumOrder}<input name="minimumOrderQuantity" type="number" min="1" step="1" defaultValue={product.minimumOrderQuantity} required />
            <small>{productCopy.minimumOrderHelp}</small></label>
          <label>{productCopy.deliverySla}<input name="deliverySlaDays" type="number" min="0" step="1" defaultValue={product.deliverySlaDays} required /></label>
          <label className="field-full">{productCopy.supplier}<select name="preferredSupplierId" defaultValue={product.preferredSupplierId ?? ""}>
            <option value="">{productCopy.notAssigned}</option>
            {suppliers.filter((supplier) => supplier.status === "Active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
          </select></label>
          <label className="field-full">{productCopy.description}<textarea name="description" defaultValue={product.description} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">{copy.save}</button></div>
      </form>

      <div className="stack-lg">
        <form action={addProductImagesAction.bind(null, product.id)} className="panel form-panel">
          <div className="panel-header"><div><h2>{copy.slideshow}</h2><p>{copy.uploadCount(images.length, MAX_PRODUCT_IMAGES)}</p></div><ImagePlus aria-hidden="true" size={22} /></div>
          <div className="form-grid">
            <label className="field-full">{copy.addImages}<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={images.length >= MAX_PRODUCT_IMAGES} />
              <small>{copy.imagesHelp}</small></label>
            <label className="field-full">{copy.uploadAlt}<input name="imageAltText" maxLength={200} placeholder={copy.altPlaceholder(product.name)} />
              <small>{copy.altHelp}</small></label>
          </div>
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={images.length >= MAX_PRODUCT_IMAGES}>{copy.upload}</button></div>
        </form>

        <section className="panel">
          <div className="panel-header"><div><h2>{copy.gallery}</h2><p>{copy.galleryBody}</p></div></div>
          {images.length ? (
            <div className="panel-body" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {images.map((image, index) => (
                <article key={image.id} style={{ border: "1px solid var(--slate-200)", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "16 / 10", background: "white", position: "relative" }}>
                    <img
                      alt={image.altText || product.name}
                      src={`/api/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(image.id)}`}
                      style={{ height: "100%", objectFit: "contain", padding: 10, width: "100%" }}
                    />
                    <span className="status-badge" style={{ insetInlineStart: 10, position: "absolute", top: 10 }}>
                      {image.isPrimary ? copy.primary : copy.image(index + 1)}
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 10, padding: 12 }}>
                    <form action={updateProductImageAltTextAction.bind(null, product.id, image.id)} className="stack-sm">
                      <label>{copy.imageDescription}<input name="altText" defaultValue={image.altText} maxLength={200} required /></label>
                      <button className="button button-secondary" type="submit">{copy.saveDescription}</button>
                    </form>
                    <div className="toolbar" style={{ alignItems: "stretch", gap: 8 }}>
                      {!image.isPrimary ? (
                        <form action={setPrimaryProductImageAction.bind(null, product.id, image.id)}>
                          <button className="button button-secondary" type="submit"><Star aria-hidden="true" size={15} />{copy.makePrimary}</button>
                        </form>
                      ) : <span className="subtle">{copy.shownFirst}</span>}
                      <form action={removeProductImageAction.bind(null, product.id, image.id)}>
                        <button className="button button-secondary" type="submit"><Trash2 aria-hidden="true" size={15} />{copy.remove}</button>
                      </form>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><ImagePlus aria-hidden="true" size={30} /><strong>{copy.empty}</strong><p>{copy.emptyBody}</p></div>
          )}
        </section>
      </div>
    </section>
  </>;
}
