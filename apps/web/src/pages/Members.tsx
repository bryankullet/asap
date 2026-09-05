import { zodResolver } from "@hookform/resolvers/zod";
import {
  createInvitationRequestSchema,
  type CreateInvitationRequest,
  type Member,
} from "@asap/schema";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Field,
  Input,
  Notice,
  Select,
} from "@asap/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api, describeApiError } from "../lib/api.js";
import { can, useMe } from "../lib/me.js";

export function Members() {
  const me = useMe();
  const qc = useQueryClient();
  const orgId = me.data?.active_organization?.id;
  const canView = can(me.data, "user", "view");
  const canInvite = can(me.data, "user", "create");
  const canEdit = can(me.data, "user", "edit");

  const members = useQuery({
    queryKey: ["members", orgId],
    queryFn: api.members,
    enabled: !!orgId && canView,
    retry: false,
  });
  const roles = useQuery({
    queryKey: ["roles", orgId],
    queryFn: api.roles,
    enabled: !!orgId && canView,
    retry: false,
  });
  const invitations = useQuery({
    queryKey: ["invitations", orgId],
    queryFn: api.invitations,
    enabled: !!orgId && canView,
    retry: false,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["members", orgId] });
    void qc.invalidateQueries({ queryKey: ["invitations", orgId] });
  };

  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: api.invite,
    onSuccess: (res) => {
      setLastAcceptUrl(res.accept_url ?? null);
      form.reset({ email: "", role_id: form.getValues("role_id") });
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: api.revokeInvitation, onSuccess: refresh });
  const update = useMutation({
    mutationFn: (v: { id: string; role_id?: string; status?: Member["status"] }) =>
      api.updateMember(v.id, {
        ...(v.role_id ? { role_id: v.role_id } : {}),
        ...(v.status ? { status: v.status } : {}),
      }),
    onSuccess: refresh,
  });

  const form = useForm<CreateInvitationRequest>({
    resolver: zodResolver(createInvitationRequestSchema),
  });

  if (!orgId) return <Notice tone="waiting">Choose a brokerage first.</Notice>;
  if (!canView)
    return <Notice tone="info">Your role does not include viewing the member list.</Notice>;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          People with access to {me.data?.active_organization?.name}.
        </CardDescription>
        {members.isPending && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}
        {members.isError && (
          <Notice tone="error" className="mt-4">
            {describeApiError(members.error)}
          </Notice>
        )}
        {members.data && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Status</th>
                  {canEdit && <th className="py-2 pr-4">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {members.data.members.map((m) => (
                  <tr key={m.membership_id}>
                    <td className="py-2 pr-4">
                      <div className="font-medium text-ink">{m.user.full_name ?? m.user.email}</div>
                      <div className="text-xs text-ink-muted">{m.user.email}</div>
                    </td>
                    <td className="py-2 pr-4">
                      {canEdit && !m.is_owner && roles.data ? (
                        <Select
                          aria-label={`Role for ${m.user.email}`}
                          className="w-auto"
                          value={m.role.id}
                          disabled={update.isPending}
                          onChange={(e) =>
                            update.mutate({ id: m.membership_id, role_id: e.target.value })
                          }
                        >
                          {roles.data.roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span>
                          {m.role.name}
                          {m.is_owner && <Badge className="ml-2">Owner</Badge>}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge tone={m.status === "active" ? "active" : "waiting"}>{m.status}</Badge>
                    </td>
                    {canEdit && (
                      <td className="py-2 pr-4">
                        {!m.is_owner && m.user.id !== me.data?.user.id && (
                          <div className="flex gap-2">
                            {m.status === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({ id: m.membership_id, status: "suspended" })
                                }
                              >
                                Suspend
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate({ id: m.membership_id, status: "active" })
                                }
                              >
                                Reactivate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={update.isPending}
                              onClick={() => {
                                if (window.confirm(`Remove ${m.user.email} from this brokerage?`)) {
                                  update.mutate({ id: m.membership_id, status: "removed" });
                                }
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {update.isError && (
              <Notice tone="error" className="mt-3">
                {describeApiError(update.error)}
              </Notice>
            )}
          </div>
        )}
      </Card>

      {canInvite && (
        <Card>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            They receive an email with a link that expires in 7 days.
          </CardDescription>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            onSubmit={form.handleSubmit((v) => invite.mutate(v))}
            noValidate
          >
            <Field
              label="Email"
              htmlFor="invite-email"
              error={form.formState.errors.email?.message}
            >
              <Input
                id="invite-email"
                type="email"
                invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
            </Field>
            <Field
              label="Role"
              htmlFor="invite-role"
              error={form.formState.errors.role_id?.message}
            >
              <Select
                id="invite-role"
                invalid={!!form.formState.errors.role_id}
                {...form.register("role_id")}
              >
                <option value="">Choose…</option>
                {roles.data?.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="accent" disabled={invite.isPending}>
              {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
          {invite.isError && (
            <Notice tone="error" className="mt-3">
              {describeApiError(invite.error)}
            </Notice>
          )}
          {invite.isSuccess && (
            <Notice tone="success" className="mt-3">
              Invitation sent.
              {lastAcceptUrl && (
                <span className="block break-all text-xs">
                  Local environment — no email was sent. Link: <code>{lastAcceptUrl}</code>
                </span>
              )}
            </Notice>
          )}

          <h3 className="mt-6 text-sm font-semibold text-ink">Pending invitations</h3>
          {invitations.data?.invitations.length === 0 && (
            <p className="mt-2 text-sm text-ink-muted">None.</p>
          )}
          <ul className="mt-2 divide-y divide-line-soft text-sm">
            {invitations.data?.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium text-ink">{i.email}</span>
                <span className="text-ink-secondary">{i.role.name}</span>
                <Badge tone={i.status === "expired" ? "review" : "waiting"}>
                  {i.status === "expired"
                    ? "expired"
                    : `expires ${new Date(i.expires_at).toLocaleDateString()}`}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
