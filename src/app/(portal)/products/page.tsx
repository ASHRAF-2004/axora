import { PageHeader } from "@/components/PageHeader";
import { ProductCatalog } from "@/components/ProductCatalog";
import { ProductImage } from "@/components/ProductImage";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listProducts, listSuppliers } from "@/lib/repository";
import { createProductAction, replaceProductImageAction, setMasterActiveAction } from "../masters/actions";

export default async function ProductsPage() {
  const actor = await requirePagePermission("view_catalog");
  const products = await listProducts(actor);

  if (!actor.isOwner) {
    return <><PageHeader eyebrow="Axora catalog" title="Find what your branch needs"
      description="Search approved products, check the image and ordering details, then add an item to a purchase request." />
      <ProductCatalog products={products} canRequest={canAccess(actor, "create_requests")} /></>;
  }

  const suppliers = await listSuppliers(actor);
  return <><PageHeader eyebrow="Platform owner · Global catalog" title="Products"
    description="Create products once for every customer. Images and selling details appear in the company catalog; buying cost and suppliers remain private to Axora." />

    <section className="split-layout">
      <article className="panel">
        <div className="panel-header"><div><h2>Catalog management</h2><p>{products.length} products · {products.filter((item) => item.duplicateWarning).length} duplicate warning</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>
          <th>Image</th><th>Product</th><th>Category</th><th>Unit / MOQ</th><th>Preferred supplier</th><th>Buying / customer price</th><th>Status</th><th>Actions</th>
        </tr></thead><tbody>{products.map((product) => <tr key={product.id}>
          <td style={{ minWidth: 145 }}><ProductImage product={product} style={{ border: "1px solid var(--slate-200)", borderRadius: 10, width: 135 }} /></td>
          <td><strong>{product.name}</strong><br /><span className="subtle">{product.code}</span></td>
          <td>{product.category}<br /><span className="subtle">{product.subcategory}</span></td>
          <td>{product.unit}<br /><span className="subtle">MOQ {product.minimumOrderQuantity}</span></td>
          <td>{product.preferredSupplierName || "Not assigned"}</td>
          <td>{formatCurrency(product.defaultBuyPrice)}<br /><span className="subtle">Customer {formatCurrency(product.defaultSellPrice)}</span></td>
          <td><StatusBadge>{product.status}</StatusBadge></td>
          <td>
            <form action={replaceProductImageAction.bind(null, product.id)} className="stack-sm">
              <input aria-label={`Image for ${product.name}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" required />
              <input aria-label={`Alternative text for ${product.name}`} name="imageAltText" placeholder="Short image description" defaultValue={product.imageAltText} />
              <button className="button button-secondary" type="submit">{product.hasImage ? "Replace image" : "Upload image"}</button>
            </form>
            <form action={setMasterActiveAction.bind(null, "products", product.id, product.status === "Inactive")} style={{ marginTop: 8 }}>
              <button className="button button-secondary" type="submit">{product.status === "Active" ? "Deactivate" : product.status === "Needs Review" ? "Reject duplicate" : "Activate"}</button>
            </form>
          </td>
        </tr>)}</tbody></table></div>
      </article>

      <form action={createProductAction} className="panel form-panel">
        <h2>Create global product</h2>
        <p>Search the register first. Only active, reviewed products appear to company customers.</p>
        <div className="form-grid">
          <label className="field-full">Product name<input name="name" required /></label>
          <label>Category<select name="category"><option>Office Basics</option><option>Pantry / Hospitality</option><option>Cleaning & Hygiene</option><option>Printing & Branding / Marketing</option></select></label>
          <label>Subcategory<input name="subcategory" required /></label>
          <label>Brand<input name="brand" /></label><label>Size<input name="size" /></label>
          <label>Unit<select name="unit"><option>Piece</option><option>Pack</option><option>Box</option><option>Bottle</option><option>Roll</option><option>Carton</option><option>Ream</option><option>Jar</option><option>Sheet</option></select></label>
          <label>Packaging<input name="packaging" /></label>
          <label>Axora buying cost (RM)<input name="defaultBuyPrice" type="number" min="0" step="0.01" required /></label>
          <label>Customer selling price (RM)<input name="defaultSellPrice" type="number" min="0.01" step="0.01" required /></label>
          <label>Minimum quantity<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" defaultValue="1" /></label>
          <label>Delivery SLA (days)<input name="deliverySlaDays" type="number" min="0" defaultValue="1" /></label>
          <label className="field-full">Preferred supplier<select name="preferredSupplierId" defaultValue=""><option value="">Not assigned</option>
            {suppliers.filter((supplier) => supplier.status === "Active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
          </select></label>
          <label className="field-full">Description / specification<textarea name="description" /></label>
          <label className="field-full">Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>JPEG, PNG or WebP · maximum 5 MB · automatically prepared for the catalog</small></label>
          <label className="field-full">Image alternative text<input name="imageAltText" placeholder="Example: White A4 copy paper ream, 80gsm" maxLength={200} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">Create product</button></div>
      </form>
    </section>
  </>;
}
