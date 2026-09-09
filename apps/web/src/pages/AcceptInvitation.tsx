import { Badge, Button, Card, CardDescription, CardTitle, Notice } from "@asap/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AuthLayout } from "../components/AuthLayout.js";
import { api, describeApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { useInvalidateMe } from "../lib/me.js";

/**
 * /invite/:token — the link from the invitation email. Shows the preview before sign-in, then
 * accepts. Accepting twice is harmless (the database function is idempotent).
 */
export function AcceptInvitation() {
  const { token = "" } = useParams({ strict: false }) as { token?: string };
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const invalidate = useInvalidateMe();

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.invitationPreview(token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token),
    onSuccess: async ({ organization_id }) => {
      await api.setActiveOrganization(organization_id);
      await invalidate();
      void navigate({ to: "/today", replace: true });
    },
  });

  const here = `/invite/${token}`;

  return (
    <AuthLayout title="You have been invited">
      <Card className="flex flex-col gap-3.5">
        {preview.isPending && <Notice tone="info">Checking the invitation…</Notice>}
        {preview.isError && <Notice tone="error">This invitation link is not valid.</Notice>}
        {preview.data && (
          <>
            <CardTitle>{preview.data.organization_name}</CardTitle>
            <CardDescription>
              Invitation for <strong>{preview.data.email}</strong> as {preview.data.role_name}.
            </CardDescription>
            {preview.data.status === "pending" ? (
              <Badge tone="waiting" className="self-start">
                Expires {new Date(preview.data.expires_at).toLocaleDateString()}
              </Badge>
            ) : (
              <Notice tone="error">
                {preview.data.status === "expired"
                  ? "This invitation has expired. Ask your administrator for a new one."
                  : preview.data.status === "revoked"
                    ? "This invitation was withdrawn."
                    : "This invitation has already been accepted."}
              </Notice>
            )}

            {preview.data.status === "pending" &&
              !loading &&
              (session ? (
                <>
                  {session.user.email?.toLowerCase() !== preview.data.email.toLowerCase() && (
                    <Notice tone="waiting">
                      You are signed in as {session.user.email}. The invitation is for{" "}
                      {preview.data.email}; sign out and use that address.
                    </Notice>
                  )}
                  {accept.isError && <Notice tone="error">{describeApiError(accept.error)}</Notice>}
                  <Button
                    variant="green"
                    full
                    disabled={accept.isPending}
                    onClick={() => accept.mutate()}
                  >
                    {accept.isPending ? "Joining…" : `Join ${preview.data.organization_name}`}
                  </Button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button asChild variant="green" full>
                    <Link to="/sign-up" search={{ email: preview.data.email, next: here }}>
                      Create an account to join
                    </Link>
                  </Button>
                  <Button asChild variant="outline" full>
                    <Link to="/sign-in" search={{ next: here }}>
                      I already have an account
                    </Link>
                  </Button>
                </div>
              ))}
          </>
        )}
      </Card>
    </AuthLayout>
  );
}
