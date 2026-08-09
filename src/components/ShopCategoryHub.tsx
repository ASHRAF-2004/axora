"use client";

import {
  CATALOG_SORTS,
  type CatalogSearchResult,
  type CatalogSort,
  type ShopCategorySummary,
} from "@/lib/catalog-contracts";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";
import { productQuantityRule } from "@/lib/procurement-rules";
import {
  addProductToRequestCart,
  readRequestCart,
  REQUEST_CART_EVENT,
  type RequestCartItem,
} from "@/lib/request-cart";
import { shopMessages } from "@/lib/shop-i18n";
import type { Product } from "@/lib/types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  PackageSearch,
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductImage } from "./ProductImage";
import { useUxFeedback } from "./UxFeedbackProvider";

export function ShopCategoryHub({
  departments,
  canRequest,
  locale="en",
}: {
  departments:ShopCategorySummary[];
  canRequest:boolean;
  locale?:SupportedLocale;
}) {
  const productCopy=corePortalMessages(locale).products;
  const shopCopy=shopMessages(locale);
  const ruleCopy=procurementRulesMessages(locale);
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const paramsKey=searchParams.toString();
  const categoryName=searchParams.get("category")?.trim() ?? "";
  const selectedCategory=useMemo(() => departments.find((item) => item.name===categoryName) ?? null,[categoryName,departments]);
  const selectedSubcategory=searchParams.get("subcategory")?.trim() || null;
  const view=searchParams.get("view");
  const query=searchParams.get("q")?.trim() ?? "";
  const requestedSort=searchParams.get("sort") as CatalogSort | null;
  const sort=CATALOG_SORTS.includes(requestedSort as CatalogSort) ? requestedSort! : "relevance";
  const requestedPage=Number(searchParams.get("page") ?? 1);
  const page=Number.isSafeInteger(requestedPage) && requestedPage>0 ? Math.min(requestedPage,100_000) : 1;
  const [searchText,setSearchText]=useState(query);
  const [searchQuery,setSearchQuery]=useState(query);
  const [catalog,setCatalog]=useState<CatalogSearchResult|null>(null);
  const [products,setProducts]=useState<Product[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [cartItems,setCartItems]=useState<RequestCartItem[]>([]);
  const focusAfterLoad=useRef(false);
  const productHeading=useRef<HTMLHeadingElement>(null);
  const {notify}=useUxFeedback();

  if (searchQuery!==query) {
    setSearchQuery(query);
    setSearchText(query);
  }

  const updateUrl=useCallback((updates:Record<string,string|null>,replace=false) => {
    const params=new URLSearchParams(paramsKey);
    for (const [key,value] of Object.entries(updates)) {
      if (value) params.set(key,value); else params.delete(key);
    }
    const target=params.toString() ? `${pathname}?${params}` : pathname;
    if (replace) router.replace(target,{scroll:false}); else router.push(target,{scroll:false});
  },[paramsKey,pathname,router]);

  useEffect(() => {
    if (searchText.trim()===query) return;
    const timer=window.setTimeout(() => updateUrl({q:searchText.trim() || null,page:null},true),350);
    return () => window.clearTimeout(timer);
  },[query,searchText,updateUrl]);
  useEffect(() => {
    function syncCart() { setCartItems(readRequestCart()); }
    syncCart();
    window.addEventListener("storage",syncCart);
    window.addEventListener(REQUEST_CART_EVENT,syncCart);
    return () => {
      window.removeEventListener("storage",syncCart);
      window.removeEventListener(REQUEST_CART_EVENT,syncCart);
    };
  },[]);

  const showingProducts=Boolean(query || selectedSubcategory || view==="category" || view==="all");
  const buildParams=useCallback(() => {
    const params=new URLSearchParams({page:String(page),limit:"24",sort});
    if (query) params.set("q",query);
    if (categoryName) params.append("category",categoryName);
    if (selectedSubcategory) params.append("subcategory",selectedSubcategory);
    return params;
  },[categoryName,page,query,selectedSubcategory,sort]);

  useEffect(() => {
    if (!showingProducts) return;
    const controller=new AbortController();
    const timer=window.setTimeout(() => {
      setLoading(true);setError("");
      void fetch(`/api/catalog?${buildParams()}`,{credentials:"same-origin",signal:controller.signal})
        .then(async (response) => {
          const payload=await response.json() as CatalogSearchResult|{error?:string};
          if (!response.ok || !("products" in payload)) throw new Error("error" in payload && payload.error ? payload.error : shopCopy.loadError);
          setCatalog(payload);setProducts(payload.products);
          if (payload.page>payload.totalPages) updateUrl({page:String(payload.totalPages)},true);
          if (focusAfterLoad.current) {
            focusAfterLoad.current=false;
            window.setTimeout(() => productHeading.current?.focus(),0);
          }
        }).catch((loadError:unknown) => {
          if (loadError instanceof DOMException && loadError.name==="AbortError") return;
          setError(loadError instanceof Error ? loadError.message : shopCopy.loadError);
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    },0);
    return () => { window.clearTimeout(timer);controller.abort(); };
  },[buildParams,shopCopy.loadError,showingProducts,updateUrl]);

  function scrollToTop() {
    const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top:0,behavior:reduce ? "auto" : "smooth"});
  }
  function openCategory(category:ShopCategorySummary) {
    updateUrl({category:category.name,subcategory:null,view:null,q:null,sort:null,page:null});
    scrollToTop();
  }
  function returnToDepartments() {
    updateUrl({category:null,subcategory:null,view:null,q:null,sort:null,page:null});
  }
  function openSubcategory(name:string) {
    focusAfterLoad.current=true;
    updateUrl({subcategory:name,view:null,sort:null,page:null});
  }
  function addToCart(product:Product) {
    const result=addProductToRequestCart(product);setCartItems(result.items);
    notify(result.added ? shopCopy.addedNotice(product.name) : shopCopy.duplicateNotice(product.name),result.added ? "success" : "info");
  }

  const pageTitle=useMemo(() => {
    if (query) return categoryName ? shopCopy.searchIn(categoryName) : shopCopy.searchResults;
    if (selectedSubcategory) return selectedSubcategory;
    if (view==="category") return shopCopy.allIn(categoryName);
    if (view==="all") return categoryName ? shopCopy.allIn(categoryName) : shopCopy.allProducts;
    return "";
  },[categoryName,query,selectedSubcategory,shopCopy,view]);
  const cartProductIds=useMemo(() => new Set(cartItems.map((item) => item.product.id)),[cartItems]);
  const cartQuantity=cartItems.reduce((total,item) => total+item.quantity,0);
  const cartSubtotal=cartItems.reduce((total,item) => total+roundMoney(item.quantity*item.product.defaultSellPrice),0);
  const from=catalog?.total ? (catalog.page-1)*catalog.limit+1 : 0;
  const to=catalog ? Math.min(catalog.page*catalog.limit,catalog.total) : 0;

  return (
    <section className="shop-hub" aria-label={shopCopy.aria}>
      <div className="shop-search-hero">
        <div className="shop-search-copy"><span>{productCopy.shopEyebrow}</span><h2>{shopCopy.heading}</h2><p>{shopCopy.intro}</p></div>
        <div className="shop-search-box"><Search size={22} aria-hidden="true" /><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={categoryName ? shopCopy.searchInside(categoryName) : shopCopy.searchPlaceholder} aria-label={shopCopy.searchAria} />
          {searchText ? <button type="button" aria-label={shopCopy.clearSearch} data-ux-silent="true" onClick={() => {setSearchText("");updateUrl({q:null,page:null},true);}}><X size={18} /></button> : null}
        </div>
      </div>
      {canRequest ? <aside className={cartItems.length ? "shop-cart-bar has-items" : "shop-cart-bar"} aria-label={shopCopy.cartAria}>
        <div className="shop-cart-bar-icon"><ShoppingCart size={21} aria-hidden="true" />{cartItems.length ? <span>{cartItems.length}</span> : null}</div>
        <div className="shop-cart-bar-copy"><strong>{cartItems.length ? shopCopy.cartItems(cartItems.length) : shopCopy.emptyCart}</strong><span>{cartItems.length ? shopCopy.cartSummary(cartQuantity,formatCurrency(cartSubtotal,locale)) : shopCopy.emptyCartBody}</span></div>
        <Link href="/requests/new?cart=1" className="button button-primary" aria-disabled={!cartItems.length} tabIndex={cartItems.length ? undefined : -1}>{shopCopy.review}<ArrowRight className="directional-icon" size={16} aria-hidden="true" /></Link>
      </aside> : null}
      {categoryName ? <nav className="shop-breadcrumb" aria-label={shopCopy.breadcrumb}>
        <button type="button" data-ux-silent="true" onClick={returnToDepartments}>{shopCopy.shop}</button><ChevronRight size={14} aria-hidden="true" />
        <button type="button" data-ux-silent="true" onClick={() => updateUrl({subcategory:null,view:null,q:null,page:null})}>{categoryName}</button>
        {selectedSubcategory ? <><ChevronRight size={14} aria-hidden="true" /><span>{selectedSubcategory}</span></> : null}
      </nav> : null}
      {!categoryName && !query && view!=="all" ? <>
        <div className="shop-section-heading"><div><span>{shopCopy.browse}</span><h2>{shopCopy.byCategory}</h2><p>{shopCopy.chooseDepartment}</p></div>
          <div className="shop-section-actions"><strong>{departments.length} {departments.length===1 ? shopCopy.department : shopCopy.departments}</strong><Link className="button button-primary" href="/products?view=all" onClick={() => {focusAfterLoad.current=true;}}><Grid3X3 size={17} />{shopCopy.seeAllProducts}</Link></div>
        </div>
        <div className="shop-department-grid">{departments.map((department) => <button key={department.name} type="button" className="shop-department-card" data-ux-silent="true" onClick={() => openCategory(department)}>
          <div className="shop-department-image"><ProductImage product={department.sampleProduct} showControls={false} locale={locale} /><span className="shop-department-count">{department.count} {department.count===1 ? shopCopy.product : shopCopy.products}</span></div>
          <div className="shop-department-content"><h3>{department.name}</h3><div className="shop-subcategory-preview">{department.subcategories.slice(0,5).map((subcategory) => <span key={subcategory.name}>{subcategory.name}</span>)}</div><div className="shop-department-action">{shopCopy.browseDepartment}<ArrowRight className="directional-icon" size={17} aria-hidden="true" /></div></div>
        </button>)}</div>
      </> : null}
      {selectedCategory && !showingProducts && !query ? <>
        <div className="shop-category-banner"><button type="button" className="shop-back-button" data-ux-silent="true" onClick={returnToDepartments}><ArrowLeft className="directional-icon" size={17} />{shopCopy.allDepartments}</button>
          <div><span>{shopCopy.departmentLabel}</span><h2>{selectedCategory.name}</h2><p>{shopCopy.chooseOrView}</p></div>
          <button type="button" className="button button-primary" data-ux-silent="true" onClick={() => {focusAfterLoad.current=true;updateUrl({subcategory:null,view:"category",page:null});}}><Grid3X3 size={17} />{shopCopy.viewAll(selectedCategory.count)}</button>
        </div>
        <div className="shop-section-heading"><div><span>{selectedCategory.name}</span><h2>{shopCopy.chooseSubcategory}</h2></div></div>
        <div className="shop-subcategory-grid">{selectedCategory.subcategories.map((subcategory) => <button key={subcategory.name} type="button" className="shop-subcategory-card" data-ux-silent="true" onClick={() => openSubcategory(subcategory.name)}><div className="shop-subcategory-image"><ProductImage product={subcategory.sampleProduct} showControls={false} locale={locale} /></div><div><h3>{subcategory.name}</h3><span>{subcategory.count} {subcategory.count===1 ? shopCopy.product : shopCopy.products}</span></div><ChevronRight className="directional-icon" size={19} aria-hidden="true" /></button>)}</div>
      </> : null}
      {showingProducts ? <div className="shop-product-view">
        <div className="shop-product-toolbar"><div><button type="button" data-ux-silent="true" onClick={() => {if (query) {setSearchText("");updateUrl({q:null,page:null});return;} if (selectedSubcategory || view==="category") {updateUrl({subcategory:null,view:null,page:null});return;} returnToDepartments();}}><ArrowLeft className="directional-icon" size={16} />{shopCopy.back}</button><h2 ref={productHeading} tabIndex={-1}>{pageTitle}</h2><span aria-live="polite">{catalog ? shopCopy.found(catalog.total) : shopCopy.loadingProducts}</span></div>
          <div className="shop-product-controls"><label>{shopCopy.filterCategory}<select value={categoryName} onChange={(event) => {focusAfterLoad.current=true;updateUrl({category:event.target.value || null,subcategory:null,view:"all",page:null});}}><option value="">{shopCopy.allCategories}</option>{departments.map((department) => <option key={department.name} value={department.name}>{department.name}</option>)}</select></label>
            <label>{shopCopy.sortBy}<select value={sort} onChange={(event) => {focusAfterLoad.current=true;updateUrl({sort:event.target.value==="relevance" ? null : event.target.value,page:null});}}><option value="relevance">{shopCopy.recommended}</option><option value="name-asc">{shopCopy.nameAsc}</option><option value="price-asc">{shopCopy.priceAsc}</option><option value="price-desc">{shopCopy.priceDesc}</option><option value="delivery-asc">{shopCopy.fastest}</option><option value="moq-asc">{shopCopy.lowestMoq}</option></select></label></div>
        </div>
        {error ? <div className="request-section-error" role="alert">{error}</div> : null}
        <div className={loading ? "shop-product-grid is-loading" : "shop-product-grid"} aria-busy={loading}>{products.map((product) => <article key={product.id} className="shop-product-card" tabIndex={0}>
          <div className="shop-product-image"><ProductImage product={product} locale={locale} /></div><div className="shop-product-content"><div className="shop-product-meta"><span>{product.subcategory}</span><small>{product.code}</small></div><h3>{product.name}</h3>{product.brand || product.size ? <p>{[product.brand,product.size].filter(Boolean).join(" · ")}</p> : null}
            <div className="shop-product-price"><strong>{formatCurrency(product.defaultSellPrice,locale)}</strong><span>{shopCopy.per} {product.packSize && product.packSize>1 ? product.packUnit : product.unit}</span></div>{product.packSize && product.packSize>1 ? <small>{ruleCopy.packSummary(product.packSize,product.packUnit ?? product.unit)}</small> : null}
            <div className="shop-product-facts"><span>{ruleCopy.quantitySummary(productQuantityRule(product))}</span><span>{product.deliverySlaDays===0 ? shopCopy.sameDay : shopCopy.days(product.deliverySlaDays)}</span></div>
            {canRequest ? <button type="button" className={cartProductIds.has(product.id) ? "button button-secondary" : "button button-primary"} data-ux-silent="true" disabled={cartProductIds.has(product.id)} onClick={() => addToCart(product)}>{cartProductIds.has(product.id) ? <><Check size={16} />{shopCopy.added}</> : <><ShoppingBag size={16} />{shopCopy.add}</>}</button> : <span className="button button-secondary">{shopCopy.viewOnly}</span>}
          </div></article>)}</div>
        {!loading && !products.length ? <div className="shop-empty-state"><PackageSearch size={40} /><strong>{shopCopy.noMatch}</strong><p>{shopCopy.noMatchBody}</p></div> : null}
        {catalog && catalog.totalPages>1 ? <nav className="shop-pagination" aria-label={shopCopy.pagination}><button type="button" className="button button-secondary" disabled={page<=1} onClick={() => {focusAfterLoad.current=true;updateUrl({page:String(page-1)});}}><ChevronLeft className="directional-icon" size={16} />{shopCopy.previousPage}</button><div><strong>{shopCopy.pageStatus(catalog.page,catalog.totalPages)}</strong><span>{shopCopy.showingRange(from,to,catalog.total)}</span></div><button type="button" className="button button-secondary" disabled={page>=catalog.totalPages} onClick={() => {focusAfterLoad.current=true;updateUrl({page:String(page+1)});}}>{shopCopy.nextPage}<ChevronRight className="directional-icon" size={16} /></button></nav> : null}
      </div> : null}
    </section>
  );
}
