import { SiteNav } from "@/components/site-nav";
import { AppTabs, type AppTab } from "@/components/app-tabs";

export function PageSkeleton({ tab }: { tab: AppTab }) {
  return (
    <>
      <SiteNav current="dashboard" />
      <AppTabs current={tab} />
      <main className="mx-auto max-w-6xl px-6 py-8" aria-busy="true">
        <div className="flex flex-col gap-3">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-8 w-72" />
          <div className="skeleton h-4 w-full max-w-2xl" />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <div className="skeleton h-3 w-24" />
            <div className="mt-5 flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <div className="skeleton h-3 w-24" />
            <div className="mt-5 flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-12 w-full" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
