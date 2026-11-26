const STEPS = [
  { href: "#simulate", head: "Try a spend", body: "A small amount commits and books two lines." },
  { href: "#simulate", head: "Trip a limit", body: "Ask for more than an agent has left." },
  { href: "#ask", head: "Ask the ledger", body: "Plain English in, a query over the entries out." },
];

export function StartHere() {
  return (
    <div>
      <p>New here? Three things to try, in this order.</p>
      <ol className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.head} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
            <span className="font-display text-lg leading-6 text-brand [font-variant-numeric:lining-nums]">
              {i + 1}
            </span>
            <div className="min-w-0">
              <a
                href={step.href}
                className="text-[15px] font-medium text-fg underline decoration-brand-dim underline-offset-4 transition-colors hover:decoration-brand"
              >
                {step.head}
              </a>
              <p className="mt-0.5 text-sm leading-relaxed text-fg-mute">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
