import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, Field, Input, Notice } from "@asap/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { AuthLayout } from "../components/AuthLayout.js";
import { supabase } from "../lib/supabase.js";

const schema = z
  .object({
    full_name: z.string().trim().min(2, "Enter your name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: z.string().min(12, "Use at least 12 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type Form = z.infer<typeof schema>;

export function SignUp() {
  const params = useSearch({ strict: false }) as { email?: string; next?: string };
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.email ?? "" },
  });

  async function onSubmit(values: Form) {
    setError(null);
    // After email confirmation the user lands back here; `next` carries an invitation link through.
    const next = params.next;
    const redirect = new URL("/auth/callback", window.location.origin);
    if (next) redirect.searchParams.set("next", next);
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.full_name }, emailRedirectTo: redirect.toString() },
    });
    if (error) {
      setError(
        error.message.includes("registered")
          ? "An account with that email already exists. Sign in instead."
          : error.message,
      );
      return;
    }
    setDone(values.email);
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Then create a brokerage or accept an invitation."
    >
      <Card>
        {done ? (
          <Notice tone="success">
            Check <strong>{done}</strong> for a confirmation link. Once confirmed, you can sign in.
          </Notice>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <Field
              label="Full name"
              htmlFor="full_name"
              error={form.formState.errors.full_name?.message}
            >
              <Input
                id="full_name"
                autoComplete="name"
                invalid={!!form.formState.errors.full_name}
                {...form.register("full_name")}
              />
            </Field>
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
              hint="At least 12 characters."
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
              label="Confirm password"
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
              {form.formState.isSubmitting ? "Creating…" : "Create account"}
            </Button>
          </form>
        )}
      </Card>
      <p className="text-sm text-ink-secondary">
        Already have an account?{" "}
        <Link
          className="font-bold text-accent-green underline-offset-2 hover:underline"
          to="/sign-in"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
