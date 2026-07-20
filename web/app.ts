import {
  ApiClientError,
  buildIdentifierPath,
  buildItemPath,
  buildListPath,
  fetchIdentifier,
  fetchModel,
  fetchModels,
  type ApiModel,
  type Fetcher,
  type ListFilters,
  type SortField,
  type SortOrder,
} from "./api.js";

type RequestMode = "list" | "item" | "identifier";
type DetailTab = "overview" | "json";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const form = required<HTMLFormElement>("#request-form");
const listFields = required<HTMLElement>("#list-fields");
const itemFields = required<HTMLElement>("#item-fields");
const identifierFields = required<HTMLElement>("#identifier-fields");
const queryInput = required<HTMLInputElement>("#query");
const providerInput = required<HTMLSelectElement>("#provider");
const availabilityInput = required<HTMLSelectElement>("#availability");
const availabilityStageInput = required<HTMLSelectElement>("#availability-stage");
const lifecycleStatusInput = required<HTMLSelectElement>("#lifecycle-status");
const identifierInput = required<HTMLSelectElement>("#identifier-type");
const fromInput = required<HTMLInputElement>("#from-date");
const toInput = required<HTMLInputElement>("#to-date");
const sortInput = required<HTMLSelectElement>("#sort");
const orderInput = required<HTMLSelectElement>("#order");
const limitInput = required<HTMLSelectElement>("#limit");
const modelIdInput = required<HTMLInputElement>("#model-id");
const identifierNamespaceInput = required<HTMLSelectElement>("#identifier-namespace");
const upstreamIdentifierInput = required<HTMLInputElement>("#upstream-identifier");
const requestPath = required<HTMLElement>("#request-path");
const copyRequestButton = required<HTMLButtonElement>("#copy-request");
const runButton = required<HTMLButtonElement>("#run-request");
const responseStatus = required<HTMLElement>("#response-status");
const catalogNotice = required<HTMLElement>("#catalog-notice");
const errorBanner = required<HTMLElement>("#error-banner");
const resultsBody = required<HTMLTableSectionElement>("#results-body");
const emptyState = required<HTMLElement>("#empty-state");
const resultRange = required<HTMLElement>("#result-range");
const pageNumber = required<HTMLElement>("#page-number");
const previousPage = required<HTMLButtonElement>("#previous-page");
const nextPage = required<HTMLButtonElement>("#next-page");
const detailEmpty = required<HTMLElement>("#detail-empty");
const detailOverview = required<HTMLElement>("#detail-overview");
const detailProvider = required<HTMLAnchorElement>("#detail-provider");
const detailModel = required<HTMLElement>("#detail-model");
const detailEndpoint = required<HTMLElement>("#detail-endpoint");
const detailDate = required<HTMLElement>("#detail-date");
const detailAvailability = required<HTMLElement>("#detail-availability");
const detailType = required<HTMLElement>("#detail-type");
const detailConfidence = required<HTMLElement>("#detail-confidence");
const detailStatus = required<HTMLElement>("#detail-status");
const detailVerified = required<HTMLElement>("#detail-verified");
const identifierCount = required<HTMLElement>("#identifier-count");
const identifiersList = required<HTMLElement>("#identifiers-list");
const availabilityEventCount = required<HTMLElement>("#availability-event-count");
const availabilityEventsList = required<HTMLElement>("#availability-events-list");
const lifecycleEventCount = required<HTMLElement>("#lifecycle-event-count");
const lifecycleEventsList = required<HTMLElement>("#lifecycle-events-list");
const relationshipsSection = required<HTMLElement>("#relationships-section");
const relationshipsList = required<HTMLElement>("#relationships-list");
const sourceCount = required<HTMLElement>("#source-count");
const sourcesList = required<HTMLElement>("#sources-list");
const rawResponse = required<HTMLElement>("#raw-response");
const modeButtons = document.querySelectorAll<HTMLButtonElement>("[data-mode]");
const detailTabs = document.querySelectorAll<HTMLButtonElement>("[data-detail-tab]");
const presetButtons = document.querySelectorAll<HTMLButtonElement>("[data-preset]");

const browserFetch: Fetcher = (input, init) => window.fetch(input, init);

let mode: RequestMode = "list";
let detailTab: DetailTab = "overview";
let offset = 0;
let total = 0;
let selectedModelId: string | undefined;
let lastResponse: unknown = {};

function sortField(): SortField {
  return sortInput.value === "model" ? "model" : "release_date";
}

function sortOrder(): SortOrder {
  return orderInput.value === "desc" ? "desc" : "asc";
}

function filters(): ListFilters {
  return {
    q: queryInput.value,
    provider: providerInput.value,
    identifierNamespace: "",
    identifier: "",
    identifierType: identifierInput.value,
    availability: availabilityInput.value,
    availabilityStage: availabilityStageInput.value,
    lifecycleStatus: lifecycleStatusInput.value,
    from: fromInput.value,
    to: toInput.value,
    sort: sortField(),
    order: sortOrder(),
    limit: Number(limitInput.value),
    offset,
  };
}

function activePath(): string {
  if (mode === "item") {
    return buildItemPath(modelIdInput.value);
  }
  if (mode === "identifier") {
    return buildIdentifierPath(identifierNamespaceInput.value, upstreamIdentifierInput.value);
  }
  return buildListPath(filters());
}

function updateRequestPreview(): void {
  try {
    requestPath.textContent = activePath();
  } catch {
    requestPath.textContent = mode === "identifier"
      ? "/api/identifiers/{namespace}/{identifier}"
      : "/api/models/{provider}/{model}";
  }
}

function setStatus(kind: "ready" | "loading" | "success" | "error", text: string): void {
  responseStatus.className = `response-status is-${kind}`;
  const label = responseStatus.querySelector<HTMLSpanElement>("span:last-child");
  if (label !== null) {
    label.textContent = text;
  }
}

function setBusy(busy: boolean): void {
  runButton.disabled = busy;
  const label = runButton.querySelector<HTMLSpanElement>("span:first-child");
  if (label !== null) {
    label.textContent = busy ? "Sending…" : "Send";
  }
  if (busy) {
    setStatus("loading", "Requesting");
  }
}

function clearError(): void {
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The request failed";
  const code = error instanceof ApiClientError ? error.code : "client_error";
  errorBanner.textContent = `${code}: ${message}`;
  errorBanner.hidden = false;
  setStatus("error", error instanceof ApiClientError && error.status > 0 ? `${error.status} Error` : "Error");
  lastResponse = { error: { code, message } };
  renderRawResponse();
}

function tag(value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "tag";
  element.textContent = value;
  return element;
}

function renderModels(models: readonly ApiModel[]): void {
  resultsBody.replaceChildren();
  emptyState.hidden = models.length !== 0;

  for (const model of models) {
    const row = document.createElement("tr");
    row.dataset["model"] = model.model;
    row.classList.toggle("is-selected", model.model === selectedModelId);

    const modelCell = document.createElement("td");
    const modelButton = document.createElement("button");
    modelButton.type = "button";
    modelButton.className = "model-cell-button";
    modelButton.textContent = model.model;
    modelButton.title = `Inspect ${model.model}`;
    modelButton.addEventListener("click", () => void inspectModel(model.model));
    modelCell.append(modelButton);

    const dateCell = document.createElement("td");
    dateCell.textContent = model.release_date;

    const availabilityCell = document.createElement("td");
    const tags = document.createElement("div");
    tags.className = "tag-list";
    tags.append(...model.availability.map(tag));
    availabilityCell.append(tags);

    const typeCell = document.createElement("td");
    typeCell.append(tag(model.identifier_type));

    row.append(modelCell, dateCell, availabilityCell, typeCell);
    resultsBody.append(row);
  }
}

function renderPagination(count: number): void {
  if (total === 0) {
    resultRange.textContent = "0 results";
  } else {
    resultRange.textContent = `${offset + 1}–${offset + count} of ${total}`;
  }
  const limit = Number(limitInput.value);
  pageNumber.textContent = `Page ${Math.floor(offset / limit) + 1}`;
  previousPage.disabled = mode !== "list" || offset === 0;
  nextPage.disabled = mode !== "list" || offset + count >= total;
}

function renderRawResponse(): void {
  rawResponse.textContent = JSON.stringify(lastResponse, null, 2);
}

function renderCoverage(coverage: { readonly statement: string }, researchedAt: string): void {
  catalogNotice.textContent = `${coverage.statement} · Catalog researched ${researchedAt}`;
}

function sourceCard(source: ApiModel["sources"][number]): HTMLElement {
  const article = document.createElement("article");
  article.className = "source-card";
  const link = document.createElement("a");
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = source.title;
  const publisher = document.createElement("span");
  publisher.className = "publisher";
  publisher.textContent = source.publisher;
  const evidence = document.createElement("p");
  evidence.textContent = source.evidence;
  article.append(link, publisher, evidence);
  return article;
}

function eventSourceLinks(sources: ApiModel["sources"]): readonly HTMLAnchorElement[] {
  return sources.map((source) => {
    const link = document.createElement("a");
    link.className = "event-source-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${source.publisher}: ${source.title} ↗`;
    return link;
  });
}

function renderDetail(model: ApiModel): void {
  selectedModelId = model.model;
  for (const row of resultsBody.querySelectorAll<HTMLTableRowElement>("tr")) {
    row.classList.toggle("is-selected", row.dataset["model"] === model.model);
  }

  detailProvider.textContent = model.provider.name;
  detailProvider.href = model.provider.website;
  detailModel.textContent = model.display_name;
  detailEndpoint.textContent = `GET ${buildItemPath(model.model)}`;
  detailDate.textContent = model.release_date_precision === "day"
    ? model.release_date
    : `${model.release_date} (${model.release_date_precision} precision)`;
  detailAvailability.textContent = model.availability.join(" + ");
  detailType.textContent = model.identifier_type;
  detailConfidence.textContent = model.confidence;
  detailStatus.textContent = model.lifecycle_status.replaceAll("_", " ");
  detailVerified.textContent = model.verified_at;
  identifierCount.textContent = `${model.identifiers.length} ID${model.identifiers.length === 1 ? "" : "s"}`;
  identifiersList.replaceChildren(
    ...model.identifiers.map((identifier) => {
      const row = document.createElement("div");
      row.className = "identifier-row";
      const value = document.createElement("code");
      value.textContent = identifier.value;
      const meta = document.createElement("span");
      meta.textContent = `${identifier.namespace} · ${identifier.kind}`;
      row.append(value, meta);
      return row;
    }),
  );

  availabilityEventCount.textContent = `${model.availability_events.length} event${model.availability_events.length === 1 ? "" : "s"}`;
  availabilityEventsList.replaceChildren(
    ...model.availability_events.map((event) => {
      const card = document.createElement("article");
      card.className = "event-card";
      const summary = document.createElement("div");
      summary.className = "event-summary";
      const title = document.createElement("strong");
      title.textContent = `${event.channel} · ${event.stage.replaceAll("_", " ")}`;
      const date = document.createElement("time");
      date.textContent = event.date;
      summary.append(title, date);
      const meta = document.createElement("div");
      meta.className = "event-meta";
      meta.textContent = `${event.confidence} · ${event.date_precision ?? "day"} precision`;
      card.append(summary, meta, ...eventSourceLinks(event.sources));
      return card;
    }),
  );

  lifecycleEventCount.textContent = `${model.lifecycle_events.length} event${model.lifecycle_events.length === 1 ? "" : "s"}`;
  lifecycleEventsList.replaceChildren(
    ...model.lifecycle_events.map((event) => {
      const card = document.createElement("article");
      card.className = "event-card is-lifecycle";
      const summary = document.createElement("div");
      summary.className = "event-summary";
      const title = document.createElement("strong");
      title.textContent = event.status.replaceAll("_", " ");
      const date = document.createElement("time");
      date.textContent = event.date;
      summary.append(title, date);
      const meta = document.createElement("div");
      meta.className = "event-meta";
      const scope = event.identifier === undefined
        ? event.channel ?? "model"
        : `${event.identifier.namespace}/${event.identifier.value}`;
      meta.textContent = `${event.date_role} · ${scope} · ${event.confidence}`;
      card.append(summary, meta, ...eventSourceLinks(event.sources));
      return card;
    }),
  );

  relationshipsSection.hidden = model.relationships.length === 0;
  relationshipsList.replaceChildren(
    ...model.relationships.map((relationship) => {
      const row = document.createElement("div");
      row.className = "relationship-row";
      const target = document.createElement("code");
      target.textContent = relationship.target_model;
      const type = document.createElement("span");
      type.textContent = relationship.type.replaceAll("_", " ");
      row.append(target, type);
      return row;
    }),
  );

  sourceCount.textContent = `${model.sources.length} source${model.sources.length === 1 ? "" : "s"}`;
  sourcesList.replaceChildren(...model.sources.map(sourceCard));
  detailEmpty.hidden = true;
  showDetailTab("overview");
}

function clearDetail(): void {
  selectedModelId = undefined;
  detailEmpty.hidden = false;
  detailOverview.hidden = true;
  if (detailTab === "overview") {
    rawResponse.hidden = true;
  }
}

function showDetailTab(tabValue: DetailTab): void {
  detailTab = tabValue;
  for (const button of detailTabs) {
    const active = button.dataset["detailTab"] === tabValue;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  const hasSelection = selectedModelId !== undefined;
  detailOverview.hidden = tabValue !== "overview" || !hasSelection;
  detailEmpty.hidden = tabValue !== "overview" || hasSelection;
  rawResponse.hidden = tabValue !== "json";
}

function syncLocation(): void {
  const parameters = new URLSearchParams();
  if (mode === "item") {
    parameters.set("mode", "item");
    parameters.set("model", modelIdInput.value.trim());
  } else if (mode === "identifier") {
    parameters.set("mode", "identifier");
    parameters.set("namespace", identifierNamespaceInput.value);
    parameters.set("identifier", upstreamIdentifierInput.value.trim());
  } else {
    const current = filters();
    const values: ReadonlyArray<readonly [string, string]> = [
      ["q", current.q.trim()],
      ["provider", current.provider],
      ["availability", current.availability],
      ["availability_stage", current.availabilityStage],
      ["lifecycle_status", current.lifecycleStatus],
      ["identifier_type", current.identifierType],
      ["from", current.from],
      ["to", current.to],
    ];
    for (const [key, value] of values) {
      if (value !== "") {
        parameters.set(key, value);
      }
    }
    parameters.set("sort", current.sort);
    parameters.set("order", current.order);
    parameters.set("limit", String(current.limit));
    if (current.offset > 0) {
      parameters.set("offset", String(current.offset));
    }
  }
  history.replaceState(null, "", `${location.pathname}?${parameters.toString()}`);
}

async function runListRequest(): Promise<void> {
  clearError();
  setBusy(true);
  const startedAt = performance.now();
  try {
    const current = filters();
    syncLocation();
    const response = await fetchModels(browserFetch, current);
    lastResponse = response;
    total = response.meta.total;
    renderModels(response.data);
    renderPagination(response.data.length);
    renderRawResponse();
    renderCoverage(response.meta.coverage, response.meta.researched_at);
    setStatus("success", `200 OK · ${response.meta.count} rows · ${Math.round(performance.now() - startedAt)} ms`);

    const selected = response.data.find((model) => model.model === selectedModelId);
    if (selected !== undefined) {
      renderDetail(selected);
    } else if (response.data[0] !== undefined) {
      renderDetail(response.data[0]);
    } else {
      clearDetail();
    }
  } catch (error: unknown) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runItemRequest(): Promise<void> {
  clearError();
  setBusy(true);
  const startedAt = performance.now();
  try {
    syncLocation();
    const response = await fetchModel(browserFetch, modelIdInput.value);
    lastResponse = response;
    total = 1;
    renderModels([response.data]);
    renderPagination(1);
    renderDetail(response.data);
    renderRawResponse();
    renderCoverage(response.meta.coverage, response.meta.researched_at);
    setStatus("success", `200 OK · 1 model · ${Math.round(performance.now() - startedAt)} ms`);
  } catch (error: unknown) {
    total = 0;
    renderModels([]);
    renderPagination(0);
    clearDetail();
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runIdentifierRequest(): Promise<void> {
  clearError();
  setBusy(true);
  const startedAt = performance.now();
  try {
    syncLocation();
    const response = await fetchIdentifier(
      browserFetch,
      identifierNamespaceInput.value,
      upstreamIdentifierInput.value,
    );
    lastResponse = response;
    total = 1;
    renderModels([response.data]);
    renderPagination(1);
    renderDetail(response.data);
    renderRawResponse();
    renderCoverage(response.meta.coverage, response.meta.researched_at);
    setStatus("success", `200 OK · identifier resolved · ${Math.round(performance.now() - startedAt)} ms`);
  } catch (error: unknown) {
    total = 0;
    renderModels([]);
    renderPagination(0);
    clearDetail();
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function inspectModel(modelId: string): Promise<void> {
  clearError();
  selectedModelId = modelId;
  for (const row of resultsBody.querySelectorAll<HTMLTableRowElement>("tr")) {
    row.classList.toggle("is-selected", row.dataset["model"] === modelId);
  }
  setStatus("loading", "Loading model");
  const startedAt = performance.now();
  try {
    const response = await fetchModel(browserFetch, modelId);
    lastResponse = response;
    renderDetail(response.data);
    renderRawResponse();
    renderCoverage(response.meta.coverage, response.meta.researched_at);
    setStatus("success", `200 OK · item endpoint · ${Math.round(performance.now() - startedAt)} ms`);
  } catch (error: unknown) {
    showError(error);
  }
}

function setMode(nextMode: RequestMode): void {
  mode = nextMode;
  offset = 0;
  listFields.hidden = mode !== "list";
  itemFields.hidden = mode !== "item";
  identifierFields.hidden = mode !== "identifier";
  for (const button of modeButtons) {
    const active = button.dataset["mode"] === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  updateRequestPreview();
}

function resetListControls(): void {
  queryInput.value = "";
  providerInput.value = "";
  availabilityInput.value = "";
  availabilityStageInput.value = "";
  lifecycleStatusInput.value = "";
  identifierInput.value = "";
  fromInput.value = "";
  toInput.value = "";
  sortInput.value = "release_date";
  orderInput.value = "asc";
  limitInput.value = "50";
  offset = 0;
}

function applyPreset(preset: string): void {
  setMode("list");
  resetListControls();
  if (preset === "recent-openai") {
    providerInput.value = "openai";
    fromInput.value = "2025-01-01";
    orderInput.value = "desc";
  } else if (preset === "weights") {
    availabilityInput.value = "weights";
  } else if (preset === "timeline-2025") {
    fromInput.value = "2025-01-01";
    toInput.value = "2025-12-31";
  }
  updateRequestPreview();
  void runListRequest();
}

function hydrateFromLocation(): RequestMode {
  const parameters = new URLSearchParams(location.search);
  if (parameters.get("mode") === "item") {
    const modelId = parameters.get("model");
    if (modelId !== null) {
      modelIdInput.value = modelId;
    }
    setMode("item");
    return "item";
  }
  if (parameters.get("mode") === "identifier") {
    identifierNamespaceInput.value = parameters.get("namespace") ?? "deepseek-api";
    upstreamIdentifierInput.value = parameters.get("identifier") ?? "deepseek-reasoner";
    setMode("identifier");
    return "identifier";
  }

  queryInput.value = parameters.get("q") ?? "";
  providerInput.value = parameters.get("provider") ?? "";
  availabilityInput.value = parameters.get("availability") ?? "";
  availabilityStageInput.value = parameters.get("availability_stage") ?? "";
  lifecycleStatusInput.value = parameters.get("lifecycle_status") ?? "";
  identifierInput.value = parameters.get("identifier_type") ?? "";
  fromInput.value = parameters.get("from") ?? "";
  toInput.value = parameters.get("to") ?? "";
  sortInput.value = parameters.get("sort") === "model" ? "model" : "release_date";
  orderInput.value = parameters.get("order") === "desc" ? "desc" : "asc";
  const requestedLimit = parameters.get("limit");
  if (requestedLimit === "10" || requestedLimit === "25" || requestedLimit === "50") {
    limitInput.value = requestedLimit;
  }
  const requestedOffset = Number(parameters.get("offset") ?? "0");
  offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  setMode("list");
  return "list";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (mode === "item") {
    void runItemRequest();
  } else if (mode === "identifier") {
    void runIdentifierRequest();
  } else {
    offset = 0;
    void runListRequest();
  }
});

form.addEventListener("input", () => {
  offset = 0;
  updateRequestPreview();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const requestedMode = button.dataset["mode"];
    setMode(requestedMode === "item" || requestedMode === "identifier" ? requestedMode : "list");
  });
}

for (const button of detailTabs) {
  button.addEventListener("click", () => {
    showDetailTab(button.dataset["detailTab"] === "json" ? "json" : "overview");
  });
}

for (const button of presetButtons) {
  button.addEventListener("click", () => applyPreset(button.dataset["preset"] ?? ""));
}

previousPage.addEventListener("click", () => {
  offset = Math.max(0, offset - Number(limitInput.value));
  updateRequestPreview();
  void runListRequest();
});

nextPage.addEventListener("click", () => {
  offset += Number(limitInput.value);
  updateRequestPreview();
  void runListRequest();
});

copyRequestButton.addEventListener("click", async () => {
  try {
    const command = `curl '${new URL(activePath(), location.origin).toString()}'`;
    await navigator.clipboard.writeText(command);
    copyRequestButton.textContent = "Copied";
  } catch {
    copyRequestButton.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    copyRequestButton.textContent = "Copy cURL";
  }, 1400);
});

const initialMode = hydrateFromLocation();
updateRequestPreview();
setStatus("ready", "Ready");
if (initialMode === "item") {
  void runItemRequest();
} else if (initialMode === "identifier") {
  void runIdentifierRequest();
} else {
  void runListRequest();
}
