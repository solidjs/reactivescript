// Probe (2026-11-25): "two adds show both" with the in-flight order of a pending add left free. While Plan sprint is
// still adding, the accepted #8 Retro may show above or below its placeholder (both cards shown once, each with its
// own id). Once Plan sprint lands, the column must be the server's: #7 then #8, as the hidden test requires.
import { TODO_ROWS, addCard, loaded } from "../../../tasks/board/fixtures.mjs";
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export default [
  { name: "HOLD two adds show both, each taking its own id", async run(app) {
    await loaded(app);
    await addCard(app, "Plan sprint");
    await addCard(app, "Retro");
    await app.colRows("todo", [...TODO_ROWS, "Plan sprint (adding…)", "Retro (adding…)"]);
    await app.land("addCard:todo,Retro", { id: 8, title: "Retro" });
    await app.page.waitForTimeout(60);
    const mid = (await app.page.locator('[data-testid="col-todo"] [data-testid="card"]').allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
    const want = [...TODO_ROWS, "Plan sprint (adding…)", "#8 Retro · 0/0"];
    if (!same(mid, want) || JSON.stringify(mid.slice(0, TODO_ROWS.length)) !== JSON.stringify(TODO_ROWS)) throw new Error(`Retro accepted: shown ${JSON.stringify(mid)}`);
    console.error(`  Retro accepted: ${JSON.stringify(mid)}`);
    await app.land("addCard:todo,Plan sprint", { id: 7, title: "Plan sprint" });
    await app.colRows("todo", [...TODO_ROWS, "#7 Plan sprint · 0/0", "#8 Retro · 0/0"]);
  } },
];
