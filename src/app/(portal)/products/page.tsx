import { DeleteProductButton } from "@/components/DeleteProductButton";
import { PageHeader } from "@/components/PageHeader";
import { ShopCategoryHub } from "@/components/ShopCategoryHub";
import { ProductImage } from "@/components/ProductImage";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from "@/lib/product-options";
import { listProducts, listSuppliers } from "@/lib/repository";
import { listShopDepartments } from "@/lib/catalog";
import Link from "next/link";
import { createProductAction, setMasterActiveAction } from "../masters/actions";

export default async function ProductsPage() {
  const actor = await requirePagePermission("view_catalog");

  if (!actor.isOwner) {
    const departments = await listShopDepartments(actor);

    return (
      <>
        <PageHeader
          eyebrow="Axora Shop"
          title="Shop for your branch"
          description="Browse visual departments and subcategories, then add approved products to a purchase request."
        />

        <ShopCategoryHub
          departments={departments}
          canRequest={canAccess(actor, "create_requests")}
        />
      </>
    );
  }

  const [products, suppliers] = await Promise.all([
    listProducts(actor),
    listSuppliers(actor),
  ]);
  return <><PageHeader eyebrow="Platform owner · Global catalog" title="Products"
    description="Create products once for every customer. Edit product details and manage an image gallery from each catalog record." />

    <section className="split-layout">
      <article className="panel">
        <div className="panel-header"><div><h2>Catalog management</h2><p>{products.length} products · {products.filter((item) => item.duplicateWarning).length} duplicate warning</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>
          <th>Image</th><th>Product</th><th>Category</th><th>Unit / MOQ</th><th>Preferred supplier</th><th>Buying / customer price</th><th>Status</th><th>Actions</th>
        </tr></thead><tbody>{products.map((product) => <tr key={product.id}>
          <td style={{ minWidth: 145 }}><ProductImage product={product} showControls={false} style={{ border: "1px solid var(--slate-200)", borderRadius: 10, width: 135 }} /></td>
          <td><strong>{product.name}</strong><br /><span className="subtle">{product.code}</span></td>
          <td>{product.category}<br /><span className="subtle">{product.subcategory}</span></td>
          <td>{product.unit}<br /><span className="subtle">MOQ {product.minimumOrderQuantity}</span></td>
          <td>{product.preferredSupplierName || "Not assigned"}</td>
          <td>{formatCurrency(product.defaultBuyPrice)}<br /><span className="subtle">Customer {formatCurrency(product.defaultSellPrice)}</span></td>
          <td><StatusBadge>{product.status}</StatusBadge></td>
          <td style={{ minWidth: 165 }}>
            <Link className="button button-secondary" href={`/products/${product.id}/edit`}>Edit product</Link>
            <form action={setMasterActiveAction.bind(null, "products", product.id, product.status === "Inactive")} style={{ marginTop: 8 }}>
              <button className="button button-secondary" type="submit">{product.status === "Active" ? "Deactivate" : product.status === "Needs Review" ? "Reject duplicate" : "Activate"}</button>
            </form>
            <DeleteProductButton productId={product.id} productName={product.name} />
          </td>
        </tr>)}</tbody></table></div>
      </article>

      <form action={createProductAction} className="panel form-panel" encType="multipart/form-data">
        <h2>Create global product</h2>
        <p>Search the register first. Only active, reviewed products appear to company customers.</p>
        <div className="form-grid">
          <label className="field-full">Product name<input name="name" required /></label>
          <label>Category<select name="category">{PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>Subcategory<input name="subcategory" required /></label>
          <label>Brand<input name="brand" /></label><label>Size<input name="size" /></label>
          <label>Unit<select name="unit">{PRODUCT_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
          <label>Packaging<input name="packaging" /></label>
          <label>Axora buying cost (RM)<input name="defaultBuyPrice" type="number" min="0" step="0.01" required /></label>
          <label>Customer selling price (RM)<input name="defaultSellPrice" type="number" min="0.01" step="0.01" required /></label>
          <label>Minimum order quantity (MOQ)<input name="minimumOrderQuantity" type="number" min="1" step="1" defaultValue="1" required />
            <small>Smallest whole number of units a customer can request.</small></label>
          <label>Delivery SLA (days)<input name="deliverySlaDays" type="number" min="0" defaultValue="1" /></label>
          <label className="field-full">Preferred supplier<select name="preferredSupplierId" defaultValue=""><option value="">Not assigned</option>
            {suppliers.filter((supplier) => supplier.status === "Active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
          </select></label>
          <label className="field-full">Description / specification<textarea name="description" /></label>
          <label className="field-full">Product images<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple />
            <small>Upload up to 8 JPEG, PNG or WebP images · maximum 5 MB each · customers see them as a slideshow.</small></label>
          <label className="field-full">Image alternative text<input name="imageAltText" placeholder="Example: White A4 copy paper ream, 80gsm" maxLength={200} />
            <small>Optional shared description for the first upload. You can edit each image description later.</small></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">Create product</button></div>
      </form>
    </section>
  </>;
}
