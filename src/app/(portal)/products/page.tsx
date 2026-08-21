import { DeleteProductButton } from "@/components/DeleteProductButton";
import { PageHeader } from "@/components/PageHeader";
import { ShopCategoryHub } from "@/components/ShopCategoryHub";
import { ProductImage } from "@/components/ProductImage";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listProducts } from "@/lib/repository";
import { listShopDepartments } from "@/lib/catalog";
import Link from "next/link";
import { setMasterActiveAction } from "../masters/actions";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { loadOrganizationDirectory } from "@/lib/organization-access";

export default async function ProductsPage({
  searchParams,
}: { searchParams: Promise<{ branch?: string }> }) {
  const actor = await requirePagePermission("view_catalog");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).products;
  const common = corePortalMessages(locale).common;
  const canManageCatalog = canAccess(actor, "manage_catalog");

  if (!canManageCatalog) {
    const organization = await loadOrganizationDirectory(actor);
    const branches = organization.branches
      .filter((branch) => branch.status === "Active")
      .map((branch) => ({ id: branch.id, name: branch.name, code: branch.code }));
    const requestedBranch = (await searchParams).branch;
    const selectedBranchId = actor.branchId
      ?? branches.find((branch) => branch.id === requestedBranch)?.id
      ?? branches[0]?.id;
    const departments = await listShopDepartments(actor, selectedBranchId);

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
          purchasingBranches={branches}
          selectedBranchId={selectedBranchId}
          locale={locale}
        />
      </>
    );
  }

  const products = await listProducts(actor);
  const canViewCost = canAccess(actor, "view_internal_cost");
  const canManagePricing = canAccess(actor, "manage_commercial_pricing");
  return <><PageHeader eyebrow={copy.operationsEyebrow} title={copy.title}
    description={copy.operationsDescription} />
    {canManagePricing ? <div className="page-actions"><Link className="button button-primary" href="/products/new">{copy.create}</Link></div> : null}

    <section>
      <article className="panel">
        <div className="panel-header"><div><h2>{copy.management}</h2><p>{copy.count(products.length, products.filter((item) => item.duplicateWarning).length)}</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>
          <th>{copy.image}</th><th>{copy.product}</th><th>{copy.category}</th><th>{copy.unitMoq}</th><th>{copy.prices}</th><th>{common.status}</th><th>{common.actions}</th>
        </tr></thead><tbody>{products.map((product) => <tr key={product.id}>
          <td style={{ minWidth: 145 }}><ProductImage product={product} showControls={false} locale={locale} style={{ border: "1px solid var(--slate-200)", borderRadius: 10, width: 135 }} /></td>
          <td><strong>{product.name}</strong><br /><span className="subtle">{product.code}</span></td>
          <td>{product.category}<br /><span className="subtle">{product.subcategory}</span></td>
          <td>{product.unit}</td>
          <td>{canViewCost ? <>{formatCurrency(product.defaultBuyPrice, locale)}<br /></> : null}<span className="subtle">{copy.customer} {formatCurrency(product.defaultSellPrice, locale)}</span></td>
          <td><StatusBadge status={product.status}>{localizedStatus(product.status, locale)}</StatusBadge></td>
          <td style={{ minWidth: 165 }}>
            <Link className="button button-secondary" href={`/products/${product.id}`}>{copy.view}</Link>
            {canManagePricing ? <Link className="button button-secondary" href={`/products/${product.id}/edit`}>{copy.edit}</Link> : null}
            <form action={setMasterActiveAction.bind(null, "products", product.id, product.status === "Inactive")} style={{ marginBlockStart: 8 }}>
              <button className="button button-secondary" type="submit">{product.status === "Active" ? common.deactivate : product.status === "Needs Review" ? copy.rejectDuplicate : common.activate}</button>
            </form>
            {actor.isOwner ? <DeleteProductButton productId={product.id} productName={product.name} /> : null}
          </td>
        </tr>)}</tbody></table></div>
      </article>

    </section>
  </>;
}
