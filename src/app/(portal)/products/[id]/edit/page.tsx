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

function optionsWithCurrent(options: readonly string[], current: string) {
  return options.includes(current) ? options : [current, ...options];
}

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("manage_catalog");
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
      eyebrow="Platform owner · Product editor"
      title={product.name}
      description="Update every catalog field and manage the customer-facing image slideshow."
    />

    <div className="toolbar" style={{ marginBottom: 18 }}>
      <Link className="button button-secondary" href="/products"><ArrowLeft aria-hidden="true" size={16} />Back to products</Link>
      <div className="toolbar-group"><span className="subtle">{product.code}</span><StatusBadge>{product.status}</StatusBadge></div>
    </div>

    <section className="split-layout" style={{ alignItems: "start" }}>
      <form action={updateProductAction.bind(null, product.id)} className="panel form-panel">
        <div className="panel-header"><div><h2>Edit product information</h2><p>Changes appear in the customer catalog after saving.</p></div></div>
        <div className="form-grid">
          <label className="field-full">Product name<input name="name" defaultValue={product.name} required /></label>
          <label>Category<select name="category" defaultValue={product.category}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>Subcategory<input name="subcategory" defaultValue={product.subcategory} required /></label>
          <label>Brand<input name="brand" defaultValue={product.brand} /></label>
          <label>Size<input name="size" defaultValue={product.size} /></label>
          <label>Unit<select name="unit" defaultValue={product.unit}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
          <label>Packaging<input name="packaging" defaultValue={product.packaging} /></label>
          <label>Axora buying cost (RM)<input name="defaultBuyPrice" type="number" min="0" step="0.01" defaultValue={product.defaultBuyPrice} required /></label>
          <label>Customer selling price (RM)<input name="defaultSellPrice" type="number" min="0.01" step="0.01" defaultValue={product.defaultSellPrice} required /></label>
          <label>Minimum order quantity (MOQ)<input name="minimumOrderQuantity" type="number" min="1" step="1" defaultValue={product.minimumOrderQuantity} required />
            <small>Smallest whole number of units a customer can request.</small></label>
          <label>Delivery SLA (days)<input name="deliverySlaDays" type="number" min="0" step="1" defaultValue={product.deliverySlaDays} required /></label>
          <label className="field-full">Preferred supplier<select name="preferredSupplierId" defaultValue={product.preferredSupplierId ?? ""}>
            <option value="">Not assigned</option>
            {suppliers.filter((supplier) => supplier.status === "Active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
          </select></label>
          <label className="field-full">Description / specification<textarea name="description" defaultValue={product.description} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">Save product changes</button></div>
      </form>

      <div className="stack-lg">
        <form action={addProductImagesAction.bind(null, product.id)} className="panel form-panel" encType="multipart/form-data">
          <div className="panel-header"><div><h2>Image slideshow</h2><p>{images.length} of {MAX_PRODUCT_IMAGES} images uploaded</p></div><ImagePlus aria-hidden="true" size={22} /></div>
          <div className="form-grid">
            <label className="field-full">Add images<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={images.length >= MAX_PRODUCT_IMAGES} />
              <small>Select multiple JPEG, PNG or WebP images. Each original file may be up to 5 MB.</small></label>
            <label className="field-full">Alternative text for this upload<input name="imageAltText" maxLength={200} placeholder={`Example: ${product.name} shown from the front`} />
              <small>You can edit the description for each image after uploading.</small></label>
          </div>
          <div className="form-actions"><button className="button button-primary" type="submit" disabled={images.length >= MAX_PRODUCT_IMAGES}>Upload images</button></div>
        </form>

        <section className="panel">
          <div className="panel-header"><div><h2>Manage gallery</h2><p>The primary image appears first. Customers can move through every active image.</p></div></div>
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
                    <span className="status-badge" style={{ left: 10, position: "absolute", top: 10 }}>
                      {image.isPrimary ? "Primary" : `Image ${index + 1}`}
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 10, padding: 12 }}>
                    <form action={updateProductImageAltTextAction.bind(null, product.id, image.id)} className="stack-sm">
                      <label>Image description<input name="altText" defaultValue={image.altText} maxLength={200} required /></label>
                      <button className="button button-secondary" type="submit">Save description</button>
                    </form>
                    <div className="toolbar" style={{ alignItems: "stretch", gap: 8 }}>
                      {!image.isPrimary ? (
                        <form action={setPrimaryProductImageAction.bind(null, product.id, image.id)}>
                          <button className="button button-secondary" type="submit"><Star aria-hidden="true" size={15} />Make primary</button>
                        </form>
                      ) : <span className="subtle">Shown first</span>}
                      <form action={removeProductImageAction.bind(null, product.id, image.id)}>
                        <button className="button button-secondary" type="submit"><Trash2 aria-hidden="true" size={15} />Remove</button>
                      </form>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><ImagePlus aria-hidden="true" size={30} /><strong>No product images yet</strong><p>Upload one or more images to create the customer slideshow.</p></div>
          )}
        </section>
      </div>
    </section>
  </>;
}
