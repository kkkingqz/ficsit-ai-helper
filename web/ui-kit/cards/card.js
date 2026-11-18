import { metricTile, timeChart } from "../components.js";
import { element } from "../screens/view-dom.js";

function textCard(title) {
  const panel = element("section", "d2-panel d2-card-fallback");
  element("h3", "d2-label", panel).textContent = title;
  const text = element("p", "", panel);
  const notice = element("p", "d2-notice", panel);
  const label = element("span", "d2-state", notice);
  const detail = element("span", "d2-notice-detail", notice);
  return {
    element: panel,
    update({ text: value, state }) {
      text.textContent = value;
      notice.dataset.state = state.kind;
      label.textContent = state.label;
      detail.textContent = state.detail ?? "";
      detail.hidden = !state.detail;
    },
  };
}

export function chatCard({ presenter, Plot, copy }) {
  const container = element("article", "d2 d2-chat-card");
  container.setAttribute("role", "region");
  const origin = element("p", "d2-card-origin", container);
  const body = element("div", "d2-card-body", container);
  let widget;
  let widgetKey;
  let destroyed = false;

  return {
    element: container,
    update({ resolved, state, start, end, fallbackText }) {
      if (destroyed) return;
      const title = resolved?.card.title ?? copy.fallbackTitle;
      const reference = resolved?.isReference && resolved.card.source?.kind === "metric";
      let kind = "fallback";
      if (reference && resolved.card.type === "metric") kind = "metric";
      if (reference && resolved.card.type === "timeseries" &&
          Number.isFinite(start) && Number.isFinite(end) && end > start) kind = "timeseries";
      const key = JSON.stringify([kind, title]);
      if (key !== widgetKey) {
        widget?.destroy?.();
        if (kind === "metric") widget = metricTile(presenter);
        else if (kind === "timeseries") widget = timeChart(presenter, Plot, {
          title, timeLabel: copy.time, axisLabel: copy.axis,
        });
        else widget = textCard(title);
        body.replaceChildren(widget.element);
        widgetKey = key;
      }

      container.setAttribute("aria-label", title);
      container.dataset.state = state.kind;
      origin.hidden = !resolved;
      if (resolved) {
        container.dataset.origin = resolved.isReference ? "reference" : "estimate";
        const sources = resolved.isReference
          ? [...new Set([resolved.metric?.source, resolved.series?.source].filter(Boolean))]
          : [];
        origin.textContent = [
          resolved.isReference ? copy.reference : copy.estimate,
          ...sources.map(source => copy.sources[source] ?? source),
        ].join(" · ");
      } else {
        delete container.dataset.origin;
        origin.textContent = "";
      }

      if (kind === "metric") {
        widget.update({ label: title, reading: resolved.metric, state });
      } else if (kind === "timeseries") {
        const series = resolved.series;
        const detail = [state.detail, series?.windowIncomplete ? copy.incomplete : ""]
          .filter(Boolean).join(" · ");
        widget.update({
          state: { ...state, detail }, start, end,
          series: series ? [{
            ...series, id: series.metricId, label: resolved.descriptor?.displayName ?? title,
            current: resolved.metric,
          }] : [],
        });
      } else {
        widget.update({ text: fallbackText ?? resolved?.fallbackText ?? "", state });
      }
    },
    destroy() {
      destroyed = true;
      widget?.destroy?.();
      widget = undefined;
      container.remove();
    },
  };
}
