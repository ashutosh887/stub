import { ConsoleShell, type AppTab } from "@/components/app-tabs";

function Block({ lines }: { lines: number }) {
  return (
    <div className="border-t border-line">
      <div className="mx-auto grid max-w-6xl px-4 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
        <div className="margin-rule border-l-[3px] pt-8 pl-3 lg:border-l-0 lg:border-r-[3px] lg:pt-9 lg:pr-6 lg:pl-0">
          <div className="skeleton h-5 w-24" />
          <div className="skeleton mt-3 h-3 w-32" />
        </div>
        <div className="flex flex-col gap-3 py-6 lg:py-9">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="skeleton h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PageSkeleton({ tab }: { tab: AppTab }) {
  return (
    <ConsoleShell tab={tab}>
      <div aria-busy="true">
        <div className="mx-auto grid max-w-6xl px-4 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-x-12">
          <div className="margin-rule hidden lg:block lg:border-r-[3px]" />
          <div className="flex flex-col gap-3 pt-9 pb-8 lg:pt-12 lg:pb-10">
            <div className="skeleton h-10 w-72 max-w-full" />
            <div className="skeleton h-4 w-full max-w-2xl" />
          </div>
        </div>
        <Block lines={4} />
        <Block lines={3} />
      </div>
    </ConsoleShell>
  );
}
