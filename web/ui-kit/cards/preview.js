import { chatMessage } from "../components.js";
import { chatCard } from "./card.js";
import { presenter, copy, cardFixture, estimateFixture } from "./fixtures.js";

if (new URLSearchParams(location.search).get("scale") === "150") {
  document.body.classList.add("cards-scale-150");
}
const conversation = document.querySelector("#conversation");
const examples = document.querySelector("#examples");
const operator = chatMessage();
operator.update({
  author: "Operator", role: "operator", time: "09:41",
  text: "Show generation on this grid.",
});
const answer = chatMessage();
answer.update({
  author: "FICSIT AI", role: "assistant", time: "09:41",
  text: "Generation readings and the available session history are shown below.",
});
conversation.append(operator.element, answer.element);
const views = ["metric", "timeseries"].map(type => {
  const card = chatCard({ presenter, Plot: window.uPlot, copy });
  answer.element.append(card.element);
  return { type, card };
});
const select = document.querySelector("#state");
select.addEventListener("change", render);
function render() {
  for (const { type, card } of views) {
    const model = cardFixture(type, select.value);
    if (type === "timeseries") model.resolved.card.title = "Generation history";
    card.update(model);
  }
}
render();

for (const model of [
  cardFixture("metric", "stale"),
  estimateFixture(),
  { resolved: null, state: { kind: "error", label: "Card rejected" },
    fallbackText: "Requested metric is unavailable. The assistant's response remains readable as text." },
]) {
  const card = chatCard({ presenter, Plot: window.uPlot, copy });
  examples.append(card.element);
  card.update(model);
}
