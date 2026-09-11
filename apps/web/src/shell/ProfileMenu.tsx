import type { MeResponse } from "@asap/schema";
import { Button, Select } from "@asap/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

/**
 * C01, as the approved demo draws it: the sidebar itself shows the avatar, the person and the
 * brokerage, and this is the `•••` button beside them (D-064). It opens the company paths the demo
 * exposes — team and permissions, data and connections, insurers and business rules, audit history,
 * client files — plus the brokerage switcher, then Sign out.
 *
 * It used to render its own avatar and two lines of text, which sat on top of the sidebar's and
 * produced a doubled, overlapping profile row. Pure: the shell supplies the data and the two
 * actions, so shell.test.tsx renders it in a memory router.
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
    "rounded-compact px-3 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink";

  return (
    <div ref={root} className="profile-menu relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile and company"
        className="more-btn"
      >
        <span aria-hidden>•••</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Profile"
          className="absolute bottom-full left-0 z-20 mb-2 flex w-full flex-col gap-1 rounded-card border border-line-strong bg-paper p-2 shadow-card"
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
            Team and permissions
          </Link>
          <Link
            role="menuitem"
            to="/settings/agreements"
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Insurers and business rules
          </Link>
          <Link
            role="menuitem"
            to="/settings/connections"
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Data and connections
          </Link>
          <Link
            role="menuitem"
            to="/audit"
            className={linkClass}
            onClick={() => setOpen(false)}
          >
            Audit history
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
