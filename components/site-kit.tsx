import Link from "next/link";
import { GITHUB_URL } from "@/config/seo";

export interface Citation {
  label: string;
  href: string;
  code?: boolean;
}

export const repoFile = (path: string, label = path): Citation => ({
  label,
  href: `${GITHUB_URL}/blob/main/${path}`,
  code: true,
});

export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-md bg-brand px-5 py-3 text-[15px] font-semibold text-ink transition-colors hover:bg-brand-bright ${FOCUS}`}
    >
      {children}
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-md border border-line-bright px-5 py-3 text-[15px] font-medium text-fg transition-colors hover:border-fg-mute hover:bg-surface ${FOCUS}`}
    >
      {children}
    </Link>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  const className =
    "text-fg underline decoration-brand-dim decoration-1 underline-offset-[5px] transition-colors hover:decoration-brand";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function Stamp({
  code,
  label = "Refused",
  delay,
  className = "",
}: {
  code: string;
  label?: string;
  delay?: number;
  className?: string;
}) {
  return (
    <span
      className={`stamp ${delay === undefined ? "" : "stamp-in"} text-deny ${className}`}
      style={delay === undefined ? undefined : ({ "--delay": `${delay}s` } as React.CSSProperties)}
    >
      {label && <span className="text-[0.78em] font-medium">{label}</span>}
      {code}
    </span>
  );
}

export function SiteSection({
  id,
  title,
  intro,
  cites = [],
  children,
}: {
  id?: string;
  title: string;
  intro?: React.ReactNode;
  cites?: Citation[];
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-y-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
        <div className="min-w-0 lg:col-start-2">
          <h2 className="max-w-3xl font-display text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] text-fg sm:text-[2.6rem]">
            {title}
          </h2>
          {intro && (
            <div className="mt-5 max-w-2xl text-[17px] leading-relaxed text-fg-dim">{intro}</div>
          )}
          {children && <div className="mt-10">{children}</div>}
        </div>
        {cites.length > 0 && (
          <aside
            aria-label="Sources"
            className="margin-rule border-t-[3px] pt-4 lg:col-start-1 lg:row-start-1 lg:border-t-0 lg:border-r-[3px] lg:pt-1 lg:pr-6"
          >
            <p className="text-sm text-fg-mute">Sources</p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 lg:block lg:space-y-1.5">
              {cites.map((cite) => (
                <li key={cite.href} className="min-w-0">
                  <a
                    href={cite.href}
                    target={cite.href.startsWith("http") ? "_blank" : undefined}
                    rel={cite.href.startsWith("http") ? "noreferrer" : undefined}
                    className={`break-words text-fg-dim transition-colors hover:text-brand ${cite.code ? "font-mono text-[13px]" : "text-sm"}`}
                  >
                    {cite.label}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}

export function CodeBlock({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="min-w-0">
      <pre className="overflow-x-auto rounded-md border border-line bg-ink px-5 py-4 font-mono text-[13px] leading-[1.7] text-fg-dim">
        <code>{children}</code>
      </pre>
      {caption && <figcaption className="mt-2.5 text-sm text-fg-mute">{caption}</figcaption>}
    </figure>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.88em] text-fg">{children}</code>;
}

export function NumberedStep({
  n,
  head,
  children,
}: {
  n: number;
  head: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <span className="font-display text-xl text-brand [font-variant-numeric:lining-nums]">
        {n}
      </span>
      <div>
        <h3 className="font-medium text-fg">{head}</h3>
        <p className="mt-1 leading-relaxed text-fg-dim">{children}</p>
      </div>
    </li>
  );
}
