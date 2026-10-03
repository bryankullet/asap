/**
 * Whether an imported contact is a person the client already has.
 *
 * Scoped to one client by the caller: the same name at two clients is two people. Within a client,
 * the same email (ignoring case), the same phone number (by its last nine digits, so "+254 712…"
 * and "0712…" agree), or — when the row gives neither — the same name (ignoring case, spacing and
 * punctuation) is the same person. A row that gives an email or phone which differs from the one
 * on file is treated as someone new rather than merged on a shared name: two people called
 * "J. Otieno" are not one.
 */
export type ContactIdentity = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const digits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D+/g, "");
  return d.length >= 7 ? d.slice(-9) : "";
};

export function sameContact(row: ContactIdentity, onFile: ContactIdentity): boolean {
  const rowEmail = (row.email ?? "").trim().toLowerCase();
  const fileEmail = (onFile.email ?? "").trim().toLowerCase();
  if (rowEmail && fileEmail) return rowEmail === fileEmail;
  const rowPhone = digits(row.phone);
  const filePhone = digits(onFile.phone);
  if (rowPhone && filePhone) return rowPhone === filePhone;
  const rowName = norm(row.fullName);
  return rowName !== "" && rowName === norm(onFile.fullName);
}

export function findSameContact<T extends ContactIdentity>(
  row: ContactIdentity,
  onFile: T[],
): T | null {
  return onFile.find((c) => sameContact(row, c)) ?? null;
}
