import { mountStatistics } from "./statistics.js";
import { mountChat } from "./chat.js";
import { chatFixture, chatOptions, statisticsFixture, statisticsOptions } from "./fixtures.js";

const params = new URLSearchParams(location.search);
const selectedView = params.get("view") === "chat" ? "chat" : "statistics";
const root = document.querySelector("#screen");
if (params.get("scale") === "150") root.style.setProperty("--ficsit-ui-scale", "1.5");
const current = document.querySelector(`[data-view="${selectedView}"]`);
current.setAttribute("aria-current", "page");
document.querySelector("#screen-title").textContent = selectedView === "chat" ? "Chat with AI" : current.textContent;

if (selectedView === "statistics") {
  let tab = params.get("tab") === "resources" ? "resources" : "energy";
  let window = 15;
  let selected = "GEN-02";
  const selectedMetrics = new Map();
  let notice;
  const statistics = mountStatistics(root, {
    ...statisticsOptions,
    Plot: globalThis.uPlot,
    actions: {
      tab(value) { tab = value; selected = value === "energy" ? "GEN-02" : "iron"; render(); },
      window(value) { window = value; render(); },
      selectMetric(id) {
        const items = statisticsFixture(tab, window, selected, selectedMetrics.get(tab)).metrics;
        const chosen = items.find(item => item.id === id);
        const kept = items.filter(item => item.id !== id && item.selected && item.unit === chosen.unit);
        selectedMetrics.set(tab, [...kept.map(item => item.id), ...(chosen.selected ? [] : [id])]);
        render();
      },
      selectObject(id) { selected = id; render(); },
      export() { notice = "CSV export is provided by the game host."; render(); },
    },
  });
  function render() {
    const model = statisticsFixture(tab, window, selected, selectedMetrics.get(tab));
    statistics.update({ ...model, notice });
  }
  render();
} else {
  let model = chatFixture(params.get("state") ?? "streaming");
  const chat = mountChat(root, {
    ...chatOptions,
    actions: {
      draft(text) { model.draft = text; },
      send(text) {
        model = {
          ...model, draft: "", streaming: true, history: "ready",
          messages: [...model.messages, {
            id: `operator-${model.messages.length}`, author: "Operator", role: "operator", time: "09:42", text,
          }, {
            id: `assistant-${model.messages.length}`, author: "FICSIT AI", role: "assistant", time: "09:42",
            text: "There is 281 MW of headroom on this grid.",
          }],
        };
        chat.update(model);
      },
      stop() {
        model.streaming = false;
        const last = model.messages.at(-1);
        if (last?.role === "assistant") last.status = "Stopped";
        chat.update(model);
      },
      retry() { model.error = null; chat.update(model); },
    },
  });
  chat.update(model);
}
