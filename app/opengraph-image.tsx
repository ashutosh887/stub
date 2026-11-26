import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Stub: the general ledger for agent spend";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#07090d",
        padding: "72px 80px",
        fontFamily: "Georgia, serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 85% -10%, rgba(228,179,99,0.14), transparent 60%)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <img src={logoSrc} alt="" width={104} height={104} />
        <span style={{ fontSize: 56, fontWeight: 600, color: "#eef1f5", letterSpacing: -1 }}>
          Stub
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 76,
            fontWeight: 600,
            color: "#eef1f5",
            lineHeight: 1.05,
          }}
        >
          <span>One budget your</span>
          <span>agents can&apos;t break.</span>
        </div>
        <div style={{ fontSize: 30, color: "#98a4b2", maxWidth: 900, lineHeight: 1.35 }}>
          A double-entry spend ledger on Amazon Aurora DSQL. The database refuses the overspend.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24 }}>
        <div style={{ width: 40, height: 3, background: "#e4b363" }} />
        <span style={{ color: "#e4b363" }}>trystub.vercel.app</span>
      </div>
    </div>,
    { ...size },
  );
}
