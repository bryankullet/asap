import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, Field, Input, Notice } from "@asap/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { AuthLayout } from "../components/AuthLayout.js";
import { supabase } from "../lib/supabase.js";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(12, "Passwords are at least 12 characters"),
});
type Form = z.infer<typeof schema>;

export function SignIn() {
  const navigate = useNavigate();
  const { next } = useSearch({ strict: false }) as { next?: string };
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState<string | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Form) {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setError(
        error.message.toLowerCase().includes("confirm")
          ? "Please confirm your email address first — check your inbox."
          : "That email and password do not match.",
      );
      return;
    }
    void navigate({ to: next ?? "/today", replace: true });
  }

  async function magicLink() {
    setError(null);
    const email = form.getValues("email");
    const ok = schema.shape.email.safeParse(email);
    if (!ok.success) {
      form.setError("email", { message: "Enter your email to receive a sign-in link" });
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: ok.data,
      options: {
        emailRedirectTo: new URL("/auth/callback", window.location.origin).toString(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      setError("We could not send a sign-in link. Try again in a minute.");
      return;
    }
    setMagicSent(ok.data);
  }

  return (
    <AuthLayout title="Sign in" subtitle="Your brokerage workspace.">
      <Card>
        {magicSent ? (
          <Notice tone="success">
            We sent a sign-in link to <strong>{magicSent}</strong>. Open it on this device.
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
            <Field
              label="Password"
              htmlFor="password"
              error={form.formState.errors.password?.message}
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                invalid={!!form.formState.errors.password}
                {...form.register("password")}
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" variant="accent" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void magicLink()}>
              Email me a sign-in link instead
            </Button>
          </form>
        )}
      </Card>
      <p className="text-sm text-ink-secondary">
        New here?{" "}
        <Link
          className="font-medium text-accent-green underline-offset-2 hover:underline"
          to="/sign-up"
        >
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
