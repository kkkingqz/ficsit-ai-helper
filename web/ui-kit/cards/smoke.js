import { presenter, copy, cardFixture, estimateFixture } from "./fixtures.js";
import { createPresenter } from "../components.js";

const target = document.querySelector("#cases");
target.classList.toggle("cards-scale-150", innerWidth < 1100);
const result = document.querySelector("#result");
const assert = (ok, message) => { if (!ok) throw new Error(message); };

try {
  const { chatCard } = await import("./card.js");
  let plot;
  let destroyed = 0;
  function recordPlot(...args) {
    plot = new window.uPlot(...args);
    const destroy = plot.destroy.bind(plot);
    plot.destroy = () => { destroyed += 1; destroy(); };
    return plot;
  }
  const card = chatCard({ presenter, Plot: recordPlot, copy });
  target.append(card.element);
  const zero = cardFixture();
  zero.resolved.metric.value = 0;
  card.update(zero);
  assert(card.element.querySelector(".d2-reading").textContent === "0 MW",
    "A valid zero uses the same metric widget as Statistics");
  for (const source of Object.keys(copy.sources)) {
    card.update(cardFixture("metric", "stale", source));
    assert(card.element.querySelector(".d2-card-origin").textContent.includes(copy.sources[source]) &&
      card.element.textContent.includes("Updated 2 min ago"), "Source remains distinct from freshness");
  }
  card.update(cardFixture("metric", "empty"));
  assert(card.element.querySelector(".d2-reading").textContent === "—",
    "Not applicable data is never rendered as zero");
  card.update(cardFixture("metric", "loading"));
  assert(card.element.textContent.includes("Loading telemetry") && !card.element.textContent.includes("576"),
    "Loading does not expose the previous reading");
  card.update(cardFixture("metric", "error"));
  assert(card.element.textContent.includes("The last request failed"), "The host supplies error text");

  const series = cardFixture("timeseries");
  card.update(series);
  const canvas = card.element.querySelector("canvas");
  assert(canvas && plot.data[1].includes(null) &&
    series.resolved.series.timestamps.every(time => plot.data[0].includes(time)),
    "Series reuse uPlot and retain real sample times with visible gaps");
  assert(card.element.textContent.includes(copy.incomplete), "A shorter session is identified");
  assert(series.resolved.series.timestamps.length === 116 &&
    !series.resolved.series.values.includes(null), "The acquired model is not mutated");
  for (const kind of ["stale", "fresh"]) {
    card.update(cardFixture("timeseries", kind));
    assert(card.element.querySelector("canvas") === canvas && !destroyed,
      "Freshness updates retain the existing plot");
  }
  card.update(cardFixture("timeseries", "empty"));
  assert(plot.data[1].every(value => value === null) &&
    card.element.textContent.includes("No applicable data"), "Empty history has no invented measurements");
  const complete = cardFixture("timeseries");
  complete.resolved.series.windowIncomplete = false;
  card.update(complete);
  assert(!card.element.textContent.includes(copy.incomplete), "A complete window clears the partial-history notice");
  const title = "<img src=x onerror=alert(1)>";
  const unsafe = cardFixture();
  unsafe.resolved.card.title = title;
  card.update(unsafe);
  assert(!card.element.querySelector("img") && card.element.textContent.includes(title) && destroyed === 1,
    "Switching widgets destroys the old plot and treats titles as text");

  card.update(estimateFixture());
  assert(card.element.dataset.origin === "estimate" && card.element.textContent.includes(copy.estimate) &&
    card.element.textContent.includes("150 MW") && !card.element.querySelector(".d2-tile"),
    "Assistant estimates remain labelled text");
  card.update({ resolved: null, state: { kind: "error", label: "Invalid card" },
    fallbackText: "<script>alert(1)</script>" });
  assert(!card.element.querySelector("script") && card.element.textContent.includes("<script>") &&
    !card.element.textContent.includes(copy.reference), "Rejected cards preserve the safe text fallback");
  const unsupported = cardFixture();
  unsupported.resolved.card.type = "line";
  card.update(unsupported);
  assert(card.element.textContent.includes(unsupported.resolved.fallbackText) &&
    !card.element.querySelector(".d2-tile"), "An unsupported widget uses the prepared text fallback");

  card.update({ ...series, start: undefined });
  assert(!card.element.querySelector("canvas") && card.element.textContent.includes(series.resolved.fallbackText),
    "A chart requires the host's explicit time range");
  card.update(series);
  target.classList.add("cards-narrow");
  card.update(series);
  assert(card.element.scrollWidth <= card.element.clientWidth + 1 &&
    document.documentElement.scrollWidth <= innerWidth, "A narrow scaled card stays within its container");
  const destroyedBeforeUnmount = destroyed;
  card.destroy();
  assert(destroyed === destroyedBeforeUnmount + 1 && !target.children.length,
    "Unmount removes the card and releases uPlot");
  card.update(series);
  assert(!target.children.length && destroyed === destroyedBeforeUnmount + 1,
    "Late updates cannot revive a destroyed card");

  const noPlot = chatCard({ presenter, copy });
  target.append(noPlot.element);
  noPlot.update(series);
  assert(!noPlot.element.querySelector("canvas") && noPlot.element.textContent.includes("576 MW") &&
    noPlot.element.querySelector(".d2-plot").clientHeight > 0, "Missing uPlot preserves the legend and plot area");
  noPlot.destroy();

  const translated = chatCard({
    presenter: createPresenter("ru", { megawatt: "МВт" }),
    copy: { ...copy, reference: "Ссылка на телеметрию", sources: { ...copy.sources, fixture: "Набор Fixture" } },
  });
  target.append(translated.element);
  const localized = cardFixture();
  localized.resolved.metric.value = 1204.5;
  localized.resolved.metric.precisionDigits = 1;
  localized.state.label = "Обновлено 2 с назад";
  translated.update(localized);
  assert(translated.element.textContent.includes("1\u202f204,5 МВт") &&
    translated.element.textContent.includes("Ссылка на телеметрию · Набор Fixture") &&
    translated.element.textContent.includes(localized.state.label), "Formatting and all UI labels come from the host");
  translated.destroy();
  result.textContent = "Chat cards smoke passed";
  result.dataset.pass = "true";
} catch (error) {
  result.textContent = String(error);
  result.dataset.pass = "false";
}
