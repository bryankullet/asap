import { zodResolver } from "@hookform/resolvers/zod";
import { createOrganizationRequestSchema, type CreateOrganizationRequest } from "@asap/schema";
import { Button, Card, Field, Input, Notice, Select } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AuthLayout } from "../components/AuthLayout.js";
import { api, describeApiError } from "../lib/api.js";
import { useInvalidateMe } from "../lib/me.js";

const COUNTRIES = [
  ["KE", "Kenya"],
  ["UG", "Uganda"],
  ["TZ", "Tanzania"],
  ["RW", "Rwanda"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["GB", "United Kingdom"],
] as const;
const CURRENCIES = ["KES", "UGX", "TZS", "RWF", "ZAR", "NGN", "GHS", "USD", "GBP", "EUR"] as const;
const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Accra",
  "Europe/London",
  "UTC",
] as const;

/** §7 Step 1. Country, currency and timezone; terms accepted; the caller becomes administrator. */
export function CreateOrganization() {
  const navigate = useNavigate();
  const router = useRouter();
  const invalidate = useInvalidateMe();
  const form = useForm<CreateOrganizationRequest>({
    resolver: zodResolver(createOrganizationRequestSchema),
    defaultValues: { country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  });
  const create = useMutation({
    mutationFn: api.createOrganization,
    onSuccess: async () => {
      await invalidate();
      void navigate({ to: "/today", replace: true });
    },
  });
  const errors = form.formState.errors;

  return (
    <AuthLayout
      title="Create your brokerage"
      subtitle="This creates a private workspace. Nothing here is shared with other brokerages."
    >
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          noValidate
        >
          <Field label="Brokerage name" htmlFor="name" error={errors.name?.message}>
            <Input
              id="name"
              autoComplete="organization"
              invalid={!!errors.name}
              {...form.register("name")}
            />
          </Field>
          <Field
            label="Legal name"
            htmlFor="legal_name"
            hint="Optional. As registered."
            error={errors.legal_name?.message}
          >
            <Input id="legal_name" invalid={!!errors.legal_name} {...form.register("legal_name")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Country" htmlFor="country" error={errors.country?.message}>
              <Select id="country" invalid={!!errors.country} {...form.register("country")}>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
              <Select id="currency" invalid={!!errors.currency} {...form.register("currency")}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Time zone" htmlFor="timezone" error={errors.timezone?.message}>
            <Select id="timezone" invalid={!!errors.timezone} {...form.register("timezone")}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink-secondary">
            <input type="checkbox" className="mt-1" {...form.register("accepted_terms")} />
            <span>
              I accept the data-processing and security terms on behalf of this brokerage.
              {errors.accepted_terms && (
                <span role="alert" className="block text-xs text-accent-red">
                  {errors.accepted_terms.message}
                </span>
              )}
            </span>
          </label>
          {create.isError && <Notice tone="error">{describeApiError(create.error)}</Notice>}
          <Button type="submit" variant="accent" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create brokerage"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.history.back()}>
            Back
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
