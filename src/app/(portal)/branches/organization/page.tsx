import { permanentRedirect } from "next/navigation";

/**
 * The historical organization hierarchy is retained in PostgreSQL for
 * compatibility, but it is not part of the current branch-based MVP.
 */
export default function RetiredOrganizationStructurePage() {
  permanentRedirect("/branches");
}
