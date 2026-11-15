import { chatMessage, objectCard, promptChip } from "../components.js";
import { button, element, keyedList, mountView } from "./view-dom.js";

const draftLimit = 2000;

export function mountChat(root, { presenter, copy, actions }) {
  const page = mountView(root, "d2-chat-view");
  const thread = element("section", "d2-panel d2-chat-thread", page);
  thread.setAttribute("aria-label", copy.history);
  const history = element("div", "d2-scroll d2-chat-history", thread);
  history.tabIndex = 0;
  history.setAttribute("role", "region");
  history.setAttribute("aria-label", copy.history);
  const historyNotice = element("div", "d2-chat-history-notice");
  history.before(historyNotice);
  const historyTitle = element("h2", "d2-panel-heading", historyNotice);
  const historyDetail = element("p", "d2-label", historyNotice);
  const messages = element("div", "d2-chat-messages", history);
  const updateMessages = keyedList(messages, () => chatMessage());

  const stream = element("div", "d2-chat-stream", thread);
  const streamText = element("span", "d2-label", stream);
  streamText.setAttribute("role", "status");
  const stop = button(copy.stop, actions.stop);
  stop.dataset.stop = "";
  stream.append(stop);

  const problem = element("div", "d2-chat-problem", thread);
  problem.setAttribute("data-state", "error");
  const problemText = element("p", "d2-state", problem);
  problemText.setAttribute("role", "status");
  const retry = button(copy.retry, actions.retry);
  retry.dataset.retry = "";
  problem.append(retry);

  const offline = element("section", "d2-chat-offline", thread);
  element("h2", "d2-panel-heading", offline).textContent = copy.offlineTitle;
  element("p", "", offline).textContent = copy.offlineDetail;
  element("p", "d2-label", offline).textContent = copy.offlineScope;

  const composer = element("form", "d2-chat-composer", thread);
  const label = element("label", "d2-chat-draft d2-label", composer);
  label.textContent = copy.draftLabel;
  const draft = element("textarea", "d2-screen-input", label);
  draft.rows = 3;
  draft.maxLength = draftLimit;
  const rateLimit = element("p", "d2-label", composer);
  rateLimit.setAttribute("role", "status");
  const controls = element("div", "d2-chat-actions", composer);
  element("span", "d2-label", controls).textContent = copy.sendHint;
  const send = button(copy.send, null, "d2-screen-button d2-screen-primary");
  send.type = "submit";
  send.dataset.send = "";
  controls.append(send);

  const prompts = element("div", "d2-chat-prompts", composer);
  for (const { label, text } of copy.prompts) {
    prompts.append(promptChip({
      label, prompt: text,
      onSelect(prompt) {
        draft.value = prompt.slice(0, draftLimit);
        onDraft();
        draft.focus();
      },
    }));
  }
  element("p", "d2-label", composer).textContent = copy.promptHint;

  const sidebar = element("aside", "d2-chat-sidebar", page);
  const sidePanels = ["context", "workOrders", "assistant"].map(key => {
    const panel = objectCard(presenter);
    sidebar.append(panel.element);
    return { key, panel };
  });
  let current;

  function syncSend() {
    send.disabled = !current?.connected || current.streaming || Boolean(current.rateLimit) || !draft.value.trim();
  }

  function onDraft() {
    actions.draft(draft.value);
    syncSend();
  }

  function submit() {
    if (!send.disabled) actions.send(draft.value);
  }

  draft.addEventListener("input", onDraft);
  draft.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      submit();
    }
  });
  composer.addEventListener("submit", event => {
    event.preventDefault();
    submit();
  });

  return {
    update(model) {
      const focused = document.activeElement;
      const follow = history.scrollHeight - history.clientHeight - history.scrollTop < 8 || !current;
      current = model;
      const notice = copy.historyStates[model.history];
      historyNotice.hidden = !notice;
      historyTitle.textContent = notice?.label ?? "";
      historyDetail.textContent = notice?.detail ?? "";
      updateMessages(model.messages);
      if (follow) history.scrollTop = history.scrollHeight;

      composer.hidden = !model.connected;
      offline.hidden = model.connected;
      stream.hidden = !model.streaming;
      stop.disabled = !model.streaming;
      const streamingLabel = model.streaming ? copy.streaming(model.backKey) : "";
      if (streamText.textContent !== streamingLabel) streamText.textContent = streamingLabel;
      problem.hidden = !model.error;
      const errorText = model.error?.text ?? "";
      if (problemText.textContent !== errorText) problemText.textContent = errorText;
      retry.hidden = !model.error?.canRetry;
      draft.disabled = !model.connected;
      if (draft.value !== model.draft) draft.value = model.draft;
      if (rateLimit.textContent !== (model.rateLimit ?? "")) rateLimit.textContent = model.rateLimit ?? "";
      rateLimit.hidden = !model.rateLimit;
      syncSend();
      if (page.contains(focused) && (focused.disabled || focused.closest("[hidden]"))) {
        (model.connected ? draft : history).focus({ preventScroll: true });
      }
      sidebar.hidden = !sidePanels.some(({ key }) => model[key]);
      for (const { key, panel } of sidePanels) {
        panel.element.hidden = !model[key];
        if (model[key]) panel.update({ title: copy[key], fields: model[key] });
      }
    },
    handleBackAction() {
      if (!current?.streaming) return false;
      actions.stop();
      return true;
    },
    destroy() {
      page.remove();
    },
  };
}
