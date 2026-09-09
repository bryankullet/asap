import type { MeResponse } from "@asap/schema";
import { Button, Select } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

/**
 * C01: one control at the bottom of the sidebar showing the brokerage and the person. It opens a
 * small menu with the brokerage switcher, Members, Agreements, Client files and Sign out. Pure:
 * the shell supplies the data and the two actions, so shell.test.tsx renders it in a memory router.
 */
export function ProfileMenu({
  me,
  switching,
  onSwitch,
  onSignOut,
}: {
  me: MeResponse | undefined;
  switching: boolean;
  onSwitch: (organizationId: string) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const org = me?.active_organization;
  const memberships = me?.memberships.filter((m) => m.status === "active") ?? [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const linkClass =
    "rounded-control px-3 py-2 text-sm text-ink-secondary hover:bg-wash hover:text-ink";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col items-start rounded-control border border-line-strong bg-paper px-3 py-2 text-left hover:bg-wash focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-green"
      >
        <span className="w-full truncate text-sm font-medium text-ink">
          {/* One membership is never a choice: name it even before the server has set it. */}
          {org?.name ??
            (memberships.length === 1 ? memberships[0]!.organization.name : "Choose a brokerage")}
        </span>
        <span className="w-full truncate text-xs text-ink-muted" title={me?.user.email}>
          {me?.user.full_name ?? me?.user.email ?? ""}
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Profile"
          className="absolute bottom-full left-0 z-20 mb-2 flex w-full flex-col gap-1 rounded-card border border-line-soft bg-paper p-2 shadow-card"
        >
          {memberships.length > 1 && (
            <Select
              aria-label="Active brokerage"
              value={org?.id ?? ""}
              disabled={switching}
              onChange={(e) => onSwitch(e.target.value)}
            >
              {!org && <option value="">Choose a brokerage…</option>}
              {memberships.map((m) => (
                <option key={m.organization.id} value={m.organization.id}>
                  {m.organization.name}
                </option>
              ))}
            </Select>
          )}
          <Link
            role="menuitem"
            to="/settings/members"
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Members
          </Link>
          <Link
            role="menuitem"
            to="/settings/agreements"
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Agreements
          </Link>
          <Link
            role="menuitem"
            to="/files"
            search={{ view: "blocking" }}
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Client files
          </Link>
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={onSignOut}
          >
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
