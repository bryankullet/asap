import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, Field, Input, Notice } from "@asap/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthLayout } from "../components/AuthLayout.js";
import { useAuth } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

/**
 * Forgetting a password (D-068).
 *
 * Two screens, one route each, because they are two different moments: asking for a link, and
 * choosing a new password once the link has been opened.
 *
 * The rule both hold: **the answer never depends on whether the address exists.** "We sent a link
 * if that address has an account" is the same sentence either way, so nobody can use this form to
 * discover who banks with this brokerage. The same reason sign-in says "that email and password do
 * not match" rather than naming which half was wrong.
 */
const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
type RequestForm = z.infer<typeof requestSchema>;

export function ForgotPassword() {
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const form = useForm<RequestForm>({ resolver: zodResolver(requestSchema) });

  async function onSubmit(values: RequestForm) {
    setFailed(false);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: new URL("/reset-password", window.location.origin).toString(),
    });
    // A failure here is the service, not the address. An address that does not exist is not an
    // error and must not look like one.
    if (error && !/user|email|not found/i.test(error.message)) {
      setFailed(true);
      return;
    }
    setSent(values.email);
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new one.">
      <Card>
        {sent ? (
          <Notice tone="success">
            If <strong>{sent}</strong> has an account, a link is on its way. It expires in an hour,
            and opening it lets you choose a new password on this device.
          </Notice>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                invalid={!!form.formState.errors.email}
                {...form.register("email")}
              />
            </Field>
            {failed && (
              <Notice tone="error">
                We could not send the email just now. Try again in a minute.
              </Notice>
            )}
            <Button type="submit" variant="green" full disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Sending…" : "Email me a reset link"}
            </Button>
          </form>
        )}
      </Card>
      <p className="text-sm text-ink-secondary">
        <Link className="font-bold text-accent-green underline-offset-2 hover:underline" to="/sign-in">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

const chooseSchema = z
  .object({
    password: z.string().min(12, "Passwords are at least 12 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "These two do not match",
    path: ["confirm"],
  });
type ChooseForm = z.infer<typeof chooseSchema>;

/**
 * Choosing the new password. Reached by opening the emailed link, which signs the person in with a
 * recovery session — so this screen requires that session and says so plainly when there is none,
 * rather than presenting a form that could not possibly work.
 */
export function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<ChooseForm>({ resolver: zodResolver(chooseSchema) });

  async function onSubmit(values: ChooseForm) {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setError(
        /same/i.test(error.message)
          ? "That is the password you already had. Choose a different one."
          : "We could not change the password. The link may have expired — ask for a new one.",
      );
      return;
    }
    setDone(true);
    // The recovery session is a real session, so there is nowhere to sign in to: go to work.
    setTimeout(() => void navigate({ to: "/discover", replace: true }), 1200);
  }

  if (loading) {
    return (
      <AuthLayout title="One moment">
        <Notice tone="info">Checking your link.</Notice>
      </AuthLayout>
    );
  }

  if (!session) {
    return (
      <AuthLayout title="This link is no longer valid">
        <Card className="flex flex-col gap-3">
          <Notice tone="error">
            A reset link can be used once, and expires an hour after it is sent.
          </Notice>
          <Link
            className="font-bold text-accent-green underline-offset-2 hover:underline"
            to="/forgot-password"
          >
            Ask for a new one
          </Link>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Twelve characters or more.">
      <Card>
        {done ? (
          <Notice tone="success">Password changed. Taking you to your workspace…</Notice>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Field
              label="New password"
              htmlFor="password"
              error={form.formState.errors.password?.message}
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                invalid={!!form.formState.errors.password}
                {...form.register("password")}
              />
            </Field>
            <Field
              label="Again, to be sure"
              htmlFor="confirm"
              error={form.formState.errors.confirm?.message}
            >
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                invalid={!!form.formState.errors.confirm}
                {...form.register("confirm")}
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="green" full disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Changing…" : "Change my password"}
            </Button>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}
