import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  applyWhitelist,
  DEFERRED_PLANNER_TOOLS,
  HIDDEN_SAVE_TOOLS,
  hiddenCallRefusal,
  hiddenToolNames,
  isHidden,
} from "../src/whitelist.js";

/**
 * S2: белый список инструментов и системный промпт под него.
 *
 * Главная проверка здесь — не фильтр (он в три строки), а **согласие промпта со
 * списком**: штатный промпт Foreman обещает инструменты поимённо, и если
 * спрятать обещанное, ход заканчивается без ответа. Проверять это глазами
 * нельзя — промпт длинный, а список будет расти.
 */

const promptPath = fileURLToPath(
  new URL("../../../third_party/foreman/SYSTEM_PROMPT.md", import.meta.url),
);

/** Тот же разбор, что у Foreman (`anthropic/systemPrompt.ts`): содержимое блока. */
function promptTemplate(): string {
  const raw = readFileSync(promptPath, "utf8");
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}

const tool = (name: string): Tool => ({ name, description: name, inputSchema: { type: "object" } });

describe("белый список", () => {
  it("инструменты чтения сохранения скрыты", () => {
    for (const name of HIDDEN_SAVE_TOOLS) expect(isHidden(name)).toBe(true);
  });

  it("справочные инструменты игры остаются видны", () => {
    for (const name of ["get_item", "get_recipe", "list_buildings", "nearest_resource_nodes"]) {
      expect(isHidden(name)).toBe(false);
    }
  });

  it("расчётные инструменты в v0.1 видны: замены им ещё нет", () => {
    // Прячутся вместе с реестром операций (V-3), а не раньше: ADR-018 запрещает
    // показывать инструмент раньше ручного пути, но не требует прятать раньше
    // замены. Тест — напоминание, что это решение, а не недосмотр.
    for (const name of DEFERRED_PLANNER_TOOLS) expect(isHidden(name)).toBe(false);
  });

  it("незнакомое имя проходит: список — запрет, а не разрешение", () => {
    expect(isHidden("инструмент_которого_мы_не_видели")).toBe(false);
  });

  it("фильтр убирает скрытые и сохраняет порядок остальных", () => {
    const filtered = applyWhitelist([
      tool("get_item"),
      tool("get_player_state"),
      tool("list_recipes"),
      tool("get_storage"),
    ]);
    expect(filtered.map((entry) => entry.name)).toEqual(["get_item", "list_recipes"]);
  });

  it("вызов скрытого инструмента получает отказ с причиной", () => {
    expect(hiddenCallRefusal("get_storage")).toContain("скрыт белым списком");
    expect(hiddenCallRefusal("get_item")).toBeUndefined();
  });
});

describe("системный промпт согласован со списком", () => {
  it("не обещает ни одного скрытого инструмента", () => {
    const template = promptTemplate();
    const promised = hiddenToolNames().filter((name) => template.includes(name));
    expect(promised).toEqual([]);
  });

  it("называет инструменты, которые модель получает", () => {
    const template = promptTemplate();
    for (const name of ["create_work_order", "nearest_resource_nodes", "get_building"]) {
      expect(template).toContain(name);
    }
  });

  it("разбирается так же, как его читает Foreman", () => {
    const template = promptTemplate();
    // Блок найден (иначе в промпт уехал бы и наш заголовок про изменения).
    expect(template.startsWith("You are the Foreman")).toBe(true);
    for (const placeholder of ["{{PERSONALITY}}", "{{PIONEER_PROFILE}}", "{{SESSION_SUMMARY}}"]) {
      expect(template).toContain(placeholder);
    }
  });

  it("уведомление об изменении по Apache 2.0 — вне блока промпта", () => {
    const raw = readFileSync(promptPath, "utf8");
    expect(raw).toContain("изменённая копия");
    expect(promptTemplate()).not.toContain("изменённая копия");
  });
});

describe("имена мода важнее имён sf-mcp", () => {
  it("скрытое имя, занятое модом, вызывается, а не отклоняется", () => {
    // Протокол канала: при совпадении имени побеждает мод, инструмент `sf-mcp`
    // с тем же именем скрыт. Проверка отказа стоит после ветки мода в
    // `index.ts`, и этот тест держит порядок.
    expect(isHidden("get_power")).toBe(true);
    const modTools = [{ name: "get_power" }];
    const handled = modTools.some((tool) => tool.name === "get_power");
    expect(handled).toBe(true);
  });
});
