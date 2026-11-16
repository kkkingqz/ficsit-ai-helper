const result = document.querySelector("#result");
const target = document.querySelector("#screen-test");
if (innerWidth < 1100) target.style.setProperty("--ficsit-ui-scale", "1.5");
const assert = (ok, message) => { if (!ok) throw new Error(message); };

try {
  const { statisticsFixture, statisticsOptions, chatFixture, chatOptions } = await import("./fixtures.js");
  const { mountStatistics } = await import("./statistics.js");
  const { mountChat } = await import("./chat.js");
  const events = [];
  const record = name => value => events.push([name, value]);
  const statisticsActions = {
    tab: record("tab"), window: record("window"), export: record("export"),
    selectMetric: record("metric"), selectObject: record("object"),
  };
  const stats = mountStatistics(target, {
    ...statisticsOptions, Plot: window.uPlot, actions: statisticsActions,
  });
  const energy = statisticsFixture("energy", 15);
  stats.update(energy);
  assert(target.textContent.includes("Generators by type") && target.textContent.includes("281 MW"),
    "Energy shows grouped generators, production and grid capacity");
  assert(target.querySelector("canvas") && target.querySelector("progress").position === .72,
    "Energy chart and battery charge render");
  target.querySelector(".d2-row-button").click();
  assert(events.some(([name, value]) => name === "object" && value === "type-0"), "Group selection is delegated");
  target.querySelector('input[value="60"]').click();
  target.querySelector('input[value="resources"]').click();
  stats.update(statisticsFixture("resources", 60));
  assert(target.textContent.includes("Water") && target.textContent.includes("m³/min") &&
    target.textContent.includes("35 min of session history available"),
    "Resources shows liquids and the partial session");
  target.querySelector("[data-export]").click();
  const visibleReport = target.querySelector(".d2-stats-report:not([hidden])");
  const metricQuery = visibleReport.querySelector("[data-metric-search]");
  metricQuery.value = "water";
  metricQuery.dispatchEvent(new Event("input", { bubbles: true }));
  const metric = [...visibleReport.querySelectorAll("[data-metric]")].find(item => !item.hidden);
  assert(metric?.textContent.includes("Water"), "Metrics can be searched");
  metric.querySelector("button").click();
  assert(events.some(([name, value]) => name === "window" && value === 60) &&
    events.some(([name, value]) => name === "tab" && value === "resources") &&
    events.some(([name]) => name === "export") &&
    events.some(([name, value]) => name === "metric" && value === "water.production"),
    "Tabs, time window, export and metric selection are delegated");
  stats.unmount();

  const withoutPlot = mountStatistics(target, { ...statisticsOptions, actions: statisticsActions });
  withoutPlot.update(energy);
  withoutPlot.update(statisticsFixture("energy", 5));
  assert(!target.querySelector("canvas") && target.querySelector(".d2-plot").clientHeight > 0 &&
    target.querySelector(".d2-legend").textContent.includes("Generation") &&
    target.textContent.includes("Generators by type") && target.querySelector("progress").position === .72,
    "Missing uPlot leaves space for the chart and keeps the rest of Statistics working");
  withoutPlot.unmount();

  const chat = mountChat(target, { ...chatOptions, actions: {
    draft: record("draft"), send: record("send"), stop: record("stop"), retry: record("retry"),
  } });
  chat.update(chatFixture("empty"));
  assert(target.textContent.includes("No messages yet"), "Loaded empty history has a welcome");
  const draft = target.querySelector("textarea");
  const send = target.querySelector("[data-send]");
  assert(send.disabled && draft.maxLength === 2000, "Empty drafts cannot be sent and input is bounded");
  target.querySelector(".d2-chip").click();
  assert(draft.value && document.activeElement === draft && !events.some(([name]) => name === "send"),
    "A prompt only prefills and focuses the field");
  const pressEnter = options => draft.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, cancelable: true, ...options,
  }));
  pressEnter({ shiftKey: true });
  pressEnter({ isComposing: true });
  assert(!events.some(([name]) => name === "send"), "Shift+Enter and IME composition preserve editing");
  pressEnter();
  assert(events.some(([name, value]) => name === "send" && value === draft.value), "Enter delegates send");
  const sends = events.filter(([name]) => name === "send").length;
  chat.update({ ...chatFixture("empty"), draft: draft.value, sending: true });
  pressEnter();
  assert(events.filter(([name]) => name === "send").length === sends &&
    target.querySelector("[data-stop]").hidden, "Pending sends cannot be repeated and cannot be cancelled yet");
  const streaming = chatFixture("streaming");
  chat.update(streaming);
  const answer = target.querySelector('[data-role="assistant"]');
  assert(target.querySelector("[data-stop]").disabled === false && chat.handleBackAction(),
    "Stop and Back are available during streaming");
  assert(events.some(([name]) => name === "stop"), "Back delegates cancellation");
  const expanded = streaming.messages.map(message =>
    message.role === "assistant" ? { ...message, text: message.text + " A second fragment." } : message);
  chat.update({ ...streaming, messages: expanded, draft: "A follow-up draft" });
  assert(target.querySelector('[data-role="assistant"]') === answer && answer.textContent.includes("second fragment") &&
    draft.value === "A follow-up draft", "A stream updates the same message and retains the draft");
  const offline = { ...chatFixture("offline"), draft: "A follow-up draft" };
  target.querySelector("[data-stop]").focus();
  chat.update(offline);
  assert(document.activeElement === target.querySelector(".d2-chat-history"),
    "Focus moves to history after disconnection hides the active control");
  assert(target.querySelector('[data-role="assistant"]') === answer &&
    target.textContent.includes("History unavailable") && target.textContent.includes("Stopped") &&
    draft.closest("form").hidden && draft.value === "A follow-up draft", "Disconnect retains displayed history and disables sending");
  assert(chat.handleBackAction() === false, "Idle Back is delegated to the host");
  const retryable = chatFixture("error");
  chat.update(retryable);
  const retry = target.querySelector("[data-retry]");
  retry.click();
  assert(events.some(([name]) => name === "retry"), "Errors delegate retry separately from chat text");
  const retries = events.filter(([name]) => name === "retry").length;
  retry.focus();
  chat.update({ ...offline, error: retryable.error });
  retry.click();
  assert(events.filter(([name]) => name === "retry").length === retries,
    "Retry cannot dispatch after disconnection");
  assert(retry.disabled && target.textContent.includes(retryable.error.text) &&
    document.activeElement === target.querySelector(".d2-chat-history"),
    "Disconnect disables Retry, preserves the error and moves focus to history");
  chat.update(retryable);
  retry.click();
  assert(events.filter(([name]) => name === "retry").length === retries + 1,
    "Reconnection makes Retry available for the retained error");
  retry.focus();
  chat.update({ ...retryable, error: null });
  assert(document.activeElement === draft, "Focus moves to draft after the retry action is hidden");
  chat.unmount();
  assert(!target.children.length, "Destroy detaches both views");
  result.textContent = "Screen views smoke passed";
  result.dataset.pass = "true";
} catch (error) {
  result.textContent = String(error);
  result.dataset.pass = "false";
}
