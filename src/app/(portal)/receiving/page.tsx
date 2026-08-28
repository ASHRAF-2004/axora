import { redirect } from "next/navigation";

/** Compatibility route: receiving now lives inside its owning Request. */
export default function ReceivingPage(props?: { searchParams?: Promise<{ notice?: string }> }) {
  void props;
  redirect("/requests");
  return null;
}
