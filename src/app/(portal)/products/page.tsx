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
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";
import { productQuantityRule } from "@/lib/procurement-rules";

export default async function ProductsPage() {
  const actor = await requirePagePermission("view_catalog");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).products;
  const common = corePortalMessages(locale).common;
  const rules = procurementRulesMessages(locale);
  const canManageCatalog = canAccess(actor, "manage_catalog");

  if (!canManageCatalog) {
    const departments = await listShopDepartments(actor);

    return (
      <>
        <PageHeader
          eyebrow={copy.shopEyebrow}
          title={copy.shopTitle}
          description={copy.shopDescription}
        />

        <ShopCategoryHub
          departments={departments}
          canRequest={canAccess(actor, "create_requests")}
          locale={locale}
        />
      </>
    );
  }

  const [products, suppliers] = await Promise.all([
    listProducts(actor),
    listSuppliers(actor),
  ]);
  const canViewCost = canAccess(actor, "view_internal_cost");
  const canViewSuppliers = canAccess(actor, "manage_suppliers");
  const canManagePricing = canAccess(actor, "manage_commercial_pricing");
  return <><PageHeader eyebrow={copy.operationsEyebrow} title={copy.title}
    description={copy.operationsDescription} />

    <section className="split-layout">
      <article className="panel">
        <div className="panel-header"><div><h2>{copy.management}</h2><p>{copy.count(products.length, products.filter((item) => item.duplicateWarning).length)}</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>
          <th>{copy.image}</th><th>{copy.product}</th><th>{copy.category}</th><th>{copy.unitMoq}</th>{canViewSuppliers ? <th>{copy.supplier}</th> : null}<th>{copy.prices}</th><th>{common.status}</th><th>{common.actions}</th>
        </tr></thead><tbody>{products.map((product) => <tr key={product.id}>
          <td style={{ minWidth: 145 }}><ProductImage product={product} showControls={false} locale={locale} style={{ border: "1px solid var(--slate-200)", borderRadius: 10, width: 135 }} /></td>
          <td><strong>{product.name}</strong><br /><span className="subtle">{product.code}</span></td>
          <td>{product.category}<br /><span className="subtle">{product.subcategory}</span></td>
          <td>{product.unit}<br /><span className="subtle">{rules.quantitySummary(productQuantityRule(product))}</span></td>
          {canViewSuppliers ? <td>{product.preferredSupplierName || copy.notAssigned}</td> : null}
          <td>{canViewCost ? <>{formatCurrency(product.defaultBuyPrice, locale)}<br /></> : null}<span className="subtle">{copy.customer} {formatCurrency(product.defaultSellPrice, locale)}</span></td>
          <td><StatusBadge status={product.status}>{localizedStatus(product.status, locale)}</StatusBadge></td>
          <td style={{ minWidth: 165 }}>
            {canManagePricing ? <Link className="button button-secondary" href={`/products/${product.id}/edit`}>{copy.edit}</Link> : null}
            <form action={setMasterActiveAction.bind(null, "products", product.id, product.status === "Inactive")} style={{ marginBlockStart: 8 }}>
              <button className="button button-secondary" type="submit">{product.status === "Active" ? common.deactivate : product.status === "Needs Review" ? copy.rejectDuplicate : common.activate}</button>
            </form>
            {actor.isOwner ? <DeleteProductButton productId={product.id} productName={product.name} /> : null}
          </td>
        </tr>)}</tbody></table></div>
      </article>

      {canManagePricing ? <form action={createProductAction} className="panel form-panel" data-draft-id="create-product">
        <h2>{copy.createTitle}</h2>
        <p>{copy.createBody}</p>
        <div className="form-grid">
          <label className="field-full">{copy.name}<input name="name" required /></label>
          <label>{copy.category}<select name="category">{PRODUCT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>{copy.subcategory}<input name="subcategory" required /></label>
          <label>{copy.brand}<input name="brand" /></label><label>{copy.size}<input name="size" /></label>
          <label>{copy.unit}<select name="unit">{PRODUCT_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
          <label>{copy.packaging}<input name="packaging" /></label>
          <label>{copy.buyCost}<input name="defaultBuyPrice" type="number" min="0" step="0.01" required /></label>
          <label>{rules.calculatedSellingPrice}<output>{rules.automaticMarkup}</output><small>{rules.calculatedSellingHelp}</small></label>
          <label>{rules.minimum}<input name="minimumOrderQuantity" type="number" min="1" step="1" defaultValue="1" required /></label>
          <label>{rules.maximum}<input name="maximumOrderQuantity" type="number" min="1" step="1" placeholder={rules.noMaximum} /></label>
          <label>{rules.increment}<input name="orderIncrement" type="number" min="1" step="1" defaultValue="1" required /></label>
          <label>{rules.packSize}<input name="packSize" type="number" min="1" step="1" defaultValue="1" required /></label>
          <label>{rules.packUnit}<input name="packUnit" maxLength={80} /></label>
          <label>{rules.effectiveFrom}<input name="quantityRuleEffectiveFrom" type="date" /></label>
          <label className="field-full">{rules.changeReason}<textarea name="quantityRuleReason" defaultValue="Initial supplier-product ordering rule" required /></label>
          <label>{copy.deliverySla}<input name="deliverySlaDays" type="number" min="0" defaultValue="1" /></label>
          <label className="field-full">{copy.supplier}<select name="preferredSupplierId" defaultValue=""><option value="">{copy.notAssigned}</option>
            {suppliers.filter((supplier) => supplier.status === "Active").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
          </select></label>
          <label className="field-full">{copy.description}<textarea name="description" /></label>
          <label className="field-full">{copy.images}<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple />
            <small>{copy.imagesHelp}</small></label>
          <label className="field-full">{copy.altText}<input name="imageAltText" placeholder={copy.altPlaceholder} maxLength={200} />
            <small>{copy.altHelp}</small></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">{copy.create}</button></div>
      </form> : null}
    </section>
  </>;
}
