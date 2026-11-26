import type { Db } from "../db";

/**
 * Deletes the portal sessions and sign-in codes of each email, unless another contact (one not listed in
 * `exceptContactIds`) with that email still has portal access. Used when access is removed, a contact is
 * removed or changes email, and when a customer is anonymised. Returns how many emails were signed out.
 * Staff-side only: no role check here, so it is not exported from any barrel.
 */
export async function endPortalSignIns(
  store: Pick<Db, "contact" | "portalCode" | "portalSession">,
  emails: readonly string[],
  exceptContactIds: readonly string[],
): Promise<number> {
  let ended = 0;
  for (const email of new Set(emails)) {
    const stillHasAccess = await store.contact.count({
      where: { email, portalAccess: true, id: { notIn: [...exceptContactIds] } },
    });
    if (stillHasAccess > 0) continue;
    await store.portalSession.deleteMany({ where: { email } });
    await store.portalCode.deleteMany({ where: { email } });
    ended += 1;
  }
  return ended;
}
