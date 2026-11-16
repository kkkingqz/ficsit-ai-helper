export function element(tag, className, parent) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (parent) parent.append(result);
  return result;
}

export function mountView(root, className) {
  return element("section", `d2 d2-screen ${className}`, root);
}

export function button(label, onClick, className = "d2-screen-button") {
  const result = element("button", className);
  result.type = "button";
  result.textContent = label;
  if (onClick) result.addEventListener("click", () => onClick());
  return result;
}

export function keyedList(parent, create) {
  const mounted = new Map();
  return records => {
    const ids = new Set(records.map(({ id }) => id));
    for (const [id, view] of mounted) {
      if (ids.has(id)) continue;
      view.element.remove();
      mounted.delete(id);
    }
    let next = parent.firstElementChild;
    for (const record of records) {
      let view = mounted.get(record.id);
      if (!view) {
        view = create(record.id);
        mounted.set(record.id, view);
      }
      if (view.element !== next) parent.insertBefore(view.element, next);
      next = view.element.nextElementSibling;
      view.update(record);
    }
  };
}
