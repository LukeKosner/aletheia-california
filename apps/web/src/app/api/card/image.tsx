import { ImageResponse } from "next/og";
import { CARD_TYPES, DISCLOSURE, formatMoney, numbers, PREVIEW_CODE, validateCard, type ReceiptCard } from "./model";
import { cardPalette } from "./palette";
import { PRIVATE_HEADERS } from "./access";
import { qrMatrix } from "./qr";

export async function renderCard(card: ReceiptCard, origin: string, tall: boolean) {
  validateCard(card);
  const palette = await cardPalette();
  const receiptUrl = `${origin}/r/${card.id}`;
  const matrix = qrMatrix(receiptUrl);
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join("");
  const width = tall ? 1080 : 1200, height = tall ? 1350 : 630;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: tall ? 64 : 44, background: palette.paper, color: palette.ink, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}><span>ALETHEIA / {CARD_TYPES[card.type]}</span><span>UNVERIFIED TEAM PREVIEW</span></div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: tall ? 48 : 20 }}>
        <div style={{ display: "flex", fontSize: tall ? 78 : 56, lineHeight: 1.08, maxWidth: tall ? 920 : 1040 }}>{card.finding}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>{numbers(card).map((number) => <div key={number.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ fontSize: tall ? 72 : 54 }}>{formatMoney(number.cents)}</span><span style={{ fontSize: 24 }}>{number.label} · cited line only</span></div>)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `2px solid ${palette.border}`, paddingTop: 20, gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: tall ? 690 : 860 }}>
          <span style={{ fontSize: 20 }}>As of {card.asOf} · {card.methodVersion}</span>
          <span style={{ fontSize: 24 }}>{new URL(origin).host}/c/{PREVIEW_CODE}</span>
          <span style={{ fontSize: 18 }}>{DISCLOSURE}</span>
          <span style={{ fontSize: 17 }}>Final-card disclosure above. This preview has not been verified.</span>
        </div>
        <svg width={135} height={135} viewBox="0 0 45 45"><rect width="45" height="45" fill={palette.paper} /><path d={path} fill={palette.ink} /></svg>
      </div>
    </div>,
    { width, height, headers: PRIVATE_HEADERS },
  );
}
