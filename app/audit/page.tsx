import { ConsoleShell } from "@/components/app-tabs";
import { ConsoleGate } from "@/components/console-gate";
import { AuditPanel } from "@/components/audit-panel";
import { ConsoleHeader, Empty, LedgerSection } from "@/components/console-kit";
import { adminPageAllowed } from "@/lib/api";
import { auditReport } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: true },
  title: "Audit and chain verification",
  description:
    "Verify the tamper-evident hash chain over every ledger entry, see tamper detection demonstrated, and export the books as accounting journal lines.",
  alternates: { canonical: "/audit" },
};

const LINK =
  "text-fg underline decoration-brand-dim underline-offset-4 transition-colors hover:decoration-brand";

export default async function AuditPage() {
  if (!(await adminPageAllowed())) return <ConsoleGate />;

  const report = await auditReport();

  return (
    <ConsoleShell tab="audit">
      <ConsoleHeader
        title="Tamper-evident ledger"
        note={
          <>
            Journal lines import into QuickBooks or NetSuite.
            <a href="/api/export/journal" className={`mt-3 block w-fit ${LINK}`}>
              Export journal CSV
            </a>
          </>
        }
        intro="Each entry carries the hash of the one before it in the same account. Change or delete a row and the chain breaks at that line, and the verifier says where."
      />

      <AuditPanel
        initial={{
          ok: report.ok,
          entryCount: report.entryCount,
          accountCount: report.accountCount,
          problems: report.problems,
        }}
      />

      <LedgerSection id="heads" title="Chain heads" note="The latest hash in each account's chain.">
        {report.chains.length === 0 ? (
          <Empty>No entries yet. Book a spend and its chain starts here.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line-bright">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead className="bg-surface-2 text-left text-[13px] text-fg-mute">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-normal">
                    Lines
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Head hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.chains.map((c) => (
                  <tr key={c.accountId}>
                    <td className="px-4 py-2.5 text-fg">{c.accountName}</td>
                    <td className="tabular px-4 py-2.5 text-right text-fg-dim">{c.entryCount}</td>
                    <td className="tabular max-w-0 truncate px-4 py-2.5 text-xs text-fg-mute">
                      {c.head}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LedgerSection>
    </ConsoleShell>
  );
}
