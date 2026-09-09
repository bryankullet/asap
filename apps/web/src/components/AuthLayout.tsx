import type { ReactNode } from "react";

/**
 * The prototype's split sign-in: a navy story panel that says what ASAP is, and the form beside
 * it. Under 900px the story is dropped and the form takes the screen — it is the part that works.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy px-[clamp(2.5rem,7vw,7rem)] py-16 text-paper lg:flex">
        <div className="flex items-center gap-2.5 font-heading font-bold tracking-[0.15em]">
          <span
            aria-hidden
            className="grid h-[34px] w-[34px] place-items-center rounded-compact bg-paper/10 text-[#f0c75e]"
          >
            A
          </span>
          ASAP
        </div>
        <div className="relative z-10 max-w-[720px]">
          <h2 className="font-heading text-[clamp(2.4rem,4.5vw,4rem)] leading-[1.05] font-semibold tracking-tight">
            The work, not the software.
          </h2>
          <p className="mt-5 max-w-[560px] text-lg text-[#c8d7e4]">
            ASAP prepares the renewal, the placement, the claim and the endorsement. Sending,
            approving and paying stay with a person, with evidence.
          </p>
        </div>
        <p className="relative z-10 max-w-[520px] text-sm text-[#dce6ee]">
          Every brokerage sees only its own clients, policies and money.
        </p>
        <span
          aria-hidden
          className="absolute -right-[180px] -bottom-[160px] h-[420px] w-[420px] rounded-full border border-paper/[0.12] shadow-[0_0_0_70px_rgba(255,255,255,.025),0_0_0_140px_rgba(255,255,255,.025)]"
        />
      </aside>
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex w-[min(430px,100%)] flex-col gap-5">
          <header>
            <p className="font-heading text-xs font-bold tracking-[0.1em] text-accent-green uppercase">
              ASAP
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {subtitle && <p className="mt-2 text-sm text-ink-secondary">{subtitle}</p>}
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
