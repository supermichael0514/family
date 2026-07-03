const AUTH_STORAGE_KEY = "family-site-authenticated";
const CLIENT_SITE_PASSWORD = "150921";
const data = window.familyData || null;

let gallery = [];
let currentImageIndex = 0;
let selectedMapPlace = null;
let activeMapDrag = null;
let suppressMapClick = false;
let calendarCursor = data ? { ...data.family.currentCalendar } : { year: 2026, month: 6 };
let activePositionPickerDrag = null;
let suppressPositionPickerClick = false;

const mapViews = {
  world: { zoom: 1, panX: 0, panY: 0 },
  china: { zoom: 1, panX: 0, panY: 0 },
};

const positionPickerViews = {
  world: { zoom: 1, panX: 0, panY: 0 },
  china: { zoom: 1, panX: 0, panY: 0 },
};

const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const archiveCards = [
  {
    id: "documents",
    title: "证件与纪念资料",
    note: "家庭成员证件、纪念文件和重要影像资料集中查看。",
    tabs: [
      { id: "cao-weiyu", label: "曹维雨", type: "photos", folder: "assets/archive/cao-weiyu" },
      { id: "tan-xingxin", label: "谭幸欣", type: "photos", folder: "assets/archive/tan-xingxin" },
      { id: "peien-muen", label: "沛恩沐恩", type: "photos", folder: "assets/archive/peien-muen" },
    ],
  },
  {
    id: "health",
    title: "健康记录",
    note: "健康资料、计划和关键信息分开保存，便于日常查找。",
    tabs: [
      { id: "health-data", label: "健康资料", type: "photos", folder: "assets/archive/health-data" },
      { id: "health-plan", label: "健康计划", type: "photos", folder: "assets/archive/health-plan" },
      { id: "health-info", label: "健康信息", type: "photos", folder: "assets/archive/health-info" },
    ],
  },
  {
    id: "assets",
    title: "家庭资产",
    note: "财务、固定资产和保险资料各自归档，方便定期复盘。",
    tabs: [
      { id: "monthly-finance", label: "月度财报", type: "photos", folder: "assets/archive/monthly-finance" },
      { id: "fixed-assets", label: "固定资产", type: "photos", folder: "assets/archive/fixed-assets" },
      { id: "insurance", label: "保险资料", type: "photos", folder: "assets/archive/insurance" },
    ],
  },
];

function addGalleryItem(item, caption = item.caption) {
  return gallery.push({ ...item, caption }) - 1;
}

function photoButton(item, caption, featured = false) {
  const index = addGalleryItem(item, caption);
  return `
    <button class="photo-button ${featured ? "featured" : ""}" type="button" data-photo-index="${index}" aria-label="查看${caption}">
      <img src="${item.src}" alt="${caption}" />
    </button>
  `;
}

function renderCreateActions() {
  const actions = [
    ["timeline", "创建时间线事件"],
    ["album", "创建月度相册"],
    ["map", "创建旅行地点"],
  ];

  actions.forEach(([viewId, label]) => {
    const intro = document.querySelector(`#${viewId} .section-intro`);
    if (!intro || intro.querySelector(".create-button")) return;
    intro.insertAdjacentHTML(
      "beforeend",
      `<button class="create-button" type="button" data-open-create="${viewId}">${label}</button>`,
    );
  });
}

function renderLatestMonth() {
  const month = data.monthlyAlbums.find((item) => item.id === data.family.latestMonthId) || data.monthlyAlbums.at(-1);
  document.querySelector("[data-latest-month]").innerHTML = month.photos
    .map((item, index) => photoButton(item, month.month, index === 0))
    .join("");
}

function renderReminders() {
  document.querySelector("[data-reminders]").innerHTML = data.calendarEvents
    .slice(0, 4)
    .map(
      (item) => `
        <article class="reminder-item">
          <strong>${item.title}</strong>
          <div class="meta-line">
            <span>${formatDate(item.date)}</span>
            <span>${item.allDay ? "全天" : item.time || "待定"}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderTimeline() {
  const years = groupByYear(data.timelineEvents, "date");
  document.querySelector("[data-timeline]").innerHTML = years
    .map(([year, events], yearIndex) => {
      const sortedEvents = events.slice().sort((a, b) => b.date.localeCompare(a.date));
      return `
        <section class="timeline-year ${yearIndex > 0 ? "collapsed" : ""}" data-year-section>
          <button class="timeline-year-toggle" type="button" data-toggle-year aria-expanded="${yearIndex === 0}">
            <span>${year}</span>
            <small>${sortedEvents.length} 个事件</small>
          </button>
          <div class="timeline-year-events">
            ${sortedEvents
              .map((item) => {
                const photo = item.photos[0];
                return `
                  <article class="timeline-card">
                    <div>
                      <p class="timeline-date">${formatDate(item.date)}</p>
                    </div>
                    <div class="timeline-body">
                      <h3>${item.title}</h3>
                      <div class="meta-line">
                        <span>${item.place}</span>
                      </div>
                      <p>${item.summary}</p>
                    </div>
                    <div class="timeline-media">
                      ${photo ? photoButton(photo, item.title, true) : ""}
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderAlbums() {
  const years = groupByYear(data.monthlyAlbums, "id");
  document.querySelector("[data-album]").innerHTML = years
    .map(([year, months], yearIndex) => {
      const sortedMonths = months.slice().sort((a, b) => b.id.localeCompare(a.id));
      return `
        <section class="album-year ${yearIndex > 0 ? "collapsed" : ""}" data-year-section>
          <button class="album-year-toggle" type="button" data-toggle-year aria-expanded="${yearIndex === 0}">
            <span>${year}</span>
            <small>${sortedMonths.length} 个月</small>
          </button>
          <div class="album-year-months">
            ${sortedMonths
              .map(
                (month) => `
                  <article class="album-month">
                    <div class="album-heading">
                      <div class="album-copy">
                        <p class="eyebrow">${month.month}</p>
                        <h3>${month.title}</h3>
                        <p>${month.summary}</p>
                      </div>
                      <span class="pill">${month.photos.length} 张精选</span>
                    </div>
                    <div class="photo-grid">
                      ${month.photos.map((item, index) => photoButton(item, month.month, index === 0)).join("")}
                    </div>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderMap() {
  const maps = {
    world: groupedTravelCountries(),
    china: groupedTravelPlaces(),
  };

  renderMapBoard("world", maps.world, mapImage("world"));
  renderMapBoard("china", maps.china, mapImage("china"));
  renderPlacePanel(maps);
}

function renderMapBoard(type, places, mapSvg) {
  const view = mapViews[type];
  const board = document.querySelector(`[data-map-board="${type}"]`);
  if (!board) return;
  const pins = withPinOffsets(places);

  board.innerHTML = `
    <div class="world-map-viewport" style="transform: translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})">
      ${mapSvg}
      ${pins
        .map(
          (place) => `
            <button class="map-pin pin-${place.kind} ${pinPlacementClass(place.position)} ${selectedMapPlace?.type === type && selectedMapPlace?.id === place.id ? "active" : ""}" type="button" data-map-type="${type}" data-place="${place.id}" style="left:${place.pinPosition.x}%; top:${place.pinPosition.y}%; z-index:${place.pinZ}; --pin-scale:${1 / view.zoom}">
              <span class="pin-head" aria-hidden="true"></span>
              <span class="pin-label">
                <strong>${place.name}</strong>
                <small>${type === "world" && place.name === "中国" ? "详见中国地图" : place.trips.map((trip) => `${formatDate(trip.date)} · ${trip.kindLabel}`).join(" / ")}</small>
              </span>
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="map-toolbar" aria-label="地图缩放">
      <button type="button" data-map-zoom-out="${type}" aria-label="缩小地图">-</button>
      <span>${Math.round(view.zoom * 100)}%</span>
      <button type="button" data-map-zoom-in="${type}" aria-label="放大地图">+</button>
    </div>
    <div class="map-legend">
      ${data.travelKinds.map((kind) => `<span class="legend-item legend-${kind.id}"><i></i>${kind.label}</span>`).join("")}
    </div>
  `;
}

function renderPlacePanel(maps) {
  const panel = document.querySelector("[data-place-panel]");
  const selected = selectedMapPlace ? maps[selectedMapPlace.type]?.find((item) => item.id === selectedMapPlace.id) : null;
  if (!selected) {
    panel.innerHTML = "";
    return;
  }

  const photoLimit = 10;
  const unitLabel = selectedMapPlace.type === "world" ? "国家" : "城市";
  const isChinaCountry = selectedMapPlace.type === "world" && selected.name === "中国";
  if (isChinaCountry) {
    panel.innerHTML = "";
    return;
  }
  panel.innerHTML = `
    <div class="place-panel-heading">
      <div>
        <p class="eyebrow">${unitLabel} · ${selected.country}</p>
        <h3>${selected.name}</h3>
      </div>
      <span class="place-tag pin-${selected.kind}">${selected.trips.length} 次到访</span>
    </div>
    <div class="place-content">
      <div class="place-copy">
        <p>${selected.summary}</p>
      </div>
      ${
        isChinaCountry
          ? ""
          : `<div class="trip-stack">
              ${selected.trips
                .map(
                  (trip) => `
                    <section class="trip-group">
                      <div class="trip-heading">
                        <h4>${formatDate(trip.date)}${selectedMapPlace.type === "world" ? ` · ${trip.name}` : ""}</h4>
                        <span>${trip.kindLabel}</span>
                      </div>
                      <div class="place-photos">
                        ${trip.photos.slice(0, photoLimit).map((item, index) => photoButton(item, `${trip.name} ${formatDate(trip.date)}`, index === 0)).join("")}
                      </div>
                    </section>
                  `,
                )
                .join("")}
            </div>`
      }
    </div>
  `;
}

function renderCalendar() {
  const { year, month } = calendarCursor;
  const firstDay = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - firstDay.getDay());
  const eventMap = data.calendarEvents.reduce((map, item) => {
    map.set(item.date, [...(map.get(item.date) || []), item]);
    return map;
  }, new Map());

  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const iso = toISO(day);
    const events = (eventMap.get(iso) || []).sort(sortCalendarEvents).slice(0, 3);
    const total = eventMap.get(iso)?.length || 0;
    return `
      <button class="calendar-day ${day.getMonth() === month - 1 ? "" : "muted"}" type="button" data-calendar-day="${iso}">
        <div class="day-number">${day.getDate()}</div>
        <div class="day-events">
          ${events.map((event) => `<span class="day-event">${event.allDay ? "全天" : event.time} ${event.title}</span>`).join("")}
          ${total > 3 ? `<span class="day-more">还有 ${total - 3} 项</span>` : ""}
        </div>
      </button>
    `;
  }).join("");

  document.querySelector("[data-calendar-shell]").innerHTML = `
    <div class="calendar-toolbar">
      <button class="calendar-nav-button" type="button" data-calendar-prev aria-label="上个月">&lt;</button>
      <div class="calendar-title-block">
        <p class="eyebrow">Family Calendar</p>
        <h2 id="calendar-title">${year} 年 ${month} 月</h2>
      </div>
      <button class="calendar-nav-button" type="button" data-calendar-next aria-label="下个月">&gt;</button>
      <button class="calendar-create-button" type="button" data-open-create="calendar">创建事件</button>
    </div>
    <div class="calendar-weekdays">
      ${weekDays.map((day) => `<div>${day}</div>`).join("")}
    </div>
    <div class="calendar-grid">
      ${cells}
    </div>
  `;
}

function renderArchive() {
  document.querySelector("[data-archive]").innerHTML = archiveCards
    .map(
      (group) => `
        <article class="archive-card">
          <div>
            <p class="eyebrow">Archive</p>
            <h3>${group.title}</h3>
            <p>${group.note}</p>
          </div>
          <div class="archive-tabs">
          ${group.tabs
            .map(
              (tab) => `
                <button class="archive-tab" type="button" data-archive-card="${group.id}" data-archive-tab="${tab.id}">
                  <strong>${tab.label}</strong>
                  <span>照片浏览</span>
                </button>
              `,
            )
            .join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function openArchiveItem(cardId, tabId) {
  const card = archiveCards.find((item) => item.id === cardId);
  const tab = card?.tabs.find((item) => item.id === tabId);
  if (!card || !tab) return;
  openArchivePhotoBrowser(tab);
}

function openArchivePhotoBrowser(tab) {
  const photos = Array.from({ length: 5 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return { src: `${tab.folder}/${number}.bmp`, caption: tab.label };
  });
  const startIndex = gallery.length;
  photos.forEach((photo) => addGalleryItem(photo, tab.label));
  openLightbox(startIndex);
}

function openCreateModal(kind) {
  const modal = document.querySelector(".event-modal");
  const content = modal.querySelector("[data-event-modal-content]");
  content.innerHTML = createForm(kind);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function createForm(kind) {
  const configs = {
    timeline: {
      title: "创建时间线事件",
      fields: `
        ${input("date", "日期", "date", todayISO(), true)}
        ${input("title", "事件标题", "text", "", true)}
        ${input("type", "类型", "text", "夫妻 / 婚礼 / 孩子 / 旅行", true)}
        ${input("place", "地点", "text", "", true)}
        ${textarea("summary", "事件说明", true)}
      `,
      hint: "会创建 timeline/YYYY-MM-DD-事件名 文件夹，并预留 5 张照片路径。",
    },
    album: {
      title: "创建月度相册",
      fields: `
        ${input("month", "月份", "month", data.family.latestMonthId, true)}
        ${input("title", "月度标题", "text", "", true)}
        ${textarea("summary", "这个月的说明", true)}
      `,
      hint: "会创建 monthly/YYYY-MM 文件夹，并预留 5 张照片路径。",
    },
    map: {
      title: "创建旅行地点",
      fields: `
        ${input("date", "旅行月份", "month", data.family.latestMonthId, true)}
        ${input("name", "地点名称", "text", "", true)}
        ${input("country", "国家 / 地区", "text", "中国", true)}
        ${select("kind", "旅行类型", data.travelKinds)}
        ${input("years", "显示年份", "text", String(new Date().getFullYear()), true)}
        <input name="x" type="hidden" value="76" />
        <input name="y" type="hidden" value="43" />
        <input name="chinaX" type="hidden" value="50" />
        <input name="chinaY" type="hidden" value="50" />
        <div class="position-picker-stack">
          ${positionPicker("world", "世界地图位置", "用于世界地图上的国家图钉。点击地图取点。")}
          ${positionPicker("china", "中国地图位置", "国家 / 地区为中国时使用。点击地图取点。")}
        </div>
        ${textarea("summary", "旅行说明", true)}
      `,
      hint: "会创建 travel/YYYY-MM-地点名 文件夹，并预留 20 张照片路径。世界地图和中国地图都显示前 10 张。",
    },
    calendar: {
      title: "创建日历事件",
      fields: `
        ${input("date", "日期", "date", todayISO(), true)}
        ${input("title", "内容", "text", "", true)}
        ${input("time", "时间", "time", "", false)}
        <label class="all-day-row">
          <input name="allDay" type="checkbox" value="true" />
          <span>全天</span>
        </label>
      `,
      hint: "会把事项保存到家庭日历。全天事件可以不填时间。",
    },
  };
  const config = configs[kind];
  return `
    <form class="create-form" data-create-form="${kind}">
      <p class="eyebrow">Local Editor</p>
      <h3>${config.title}</h3>
      <p>${config.hint}</p>
      ${config.fields}
      <div class="form-actions">
        <button class="create-submit" type="submit">创建</button>
        <button class="create-cancel" type="button" data-close-create>取消</button>
      </div>
      <p class="form-status" data-form-status></p>
    </form>
  `;
}

function input(name, label, type, value = "", required = false) {
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeAttr(value)}" ${required ? "required" : ""} />
    </label>
  `;
}

function textarea(name, label, required = false) {
  return `
    <label>
      <span>${label}</span>
      <textarea name="${name}" rows="4" ${required ? "required" : ""}></textarea>
    </label>
  `;
}

function select(name, label, options) {
  return `
    <label>
      <span>${label}</span>
      <select name="${name}">
        ${options.map((option) => `<option value="${option.id}">${option.label}</option>`).join("")}
      </select>
    </label>
  `;
}

function positionPicker(type, title, hint) {
  const xName = type === "world" ? "x" : "chinaX";
  const yName = type === "world" ? "y" : "chinaY";
  const xValue = type === "world" ? 76 : 50;
  const yValue = type === "world" ? 43 : 50;
  return `
    <div class="position-picker" data-position-picker="${type}" data-x-name="${xName}" data-y-name="${yName}">
      <div>
        <strong>${title}</strong>
        <span>${hint}</span>
      </div>
      <button class="position-picker-map" type="button" aria-label="${title}">
        <span class="position-picker-viewport" style="transform: translate(0px, 0px) scale(1)">
          ${mapImage(type)}
          <i style="left:${xValue}%; top:${yValue}%"></i>
        </span>
      </button>
      <div class="position-picker-controls">
        <button type="button" data-picker-zoom-out="${type}" aria-label="缩小${title}">-</button>
        <span data-picker-zoom-label="${type}">100%</span>
        <button type="button" data-picker-zoom-in="${type}" aria-label="放大${title}">+</button>
      </div>
      <p><span data-position-readout="${type}">${xValue}, ${yValue}</span></p>
    </div>
  `;
}

async function submitCreateForm(form) {
  const status = form.querySelector("[data-form-status]");
  const kind = form.dataset.createForm;
  const payload = Object.fromEntries(new FormData(form).entries());
  status.textContent = "正在创建...";

  try {
    const response = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, payload }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "创建失败");
    Object.assign(data, result.data);
    window.familyData = data;
    if (result.created?.id) {
      const createdPlace = data.travelPlaces.find((item) => item.id === result.created.id);
      if (createdPlace) selectedMapPlace = { type: "china", id: placeKey(createdPlace) };
    }
    if (kind === "calendar") {
      const [year, month] = payload.date.split("-").map(Number);
      calendarCursor = { year, month };
    }
    closeCreateModal();
    renderAll();
    alert(result.created.folder ? "已创建。现在可以把照片拖进新文件夹。" : "已创建日历事件。");
  } catch (error) {
    status.textContent = `创建失败：${error.message}。请确认使用 node server.mjs 启动本地服务。`;
  }
}

function openDayModal(date) {
  const modal = document.querySelector(".event-modal");
  const content = modal.querySelector("[data-event-modal-content]");
  const events = data.calendarEvents.filter((item) => item.date === date).sort(sortCalendarEvents);
  content.innerHTML = `
    <div class="event-modal-heading">
      <p class="eyebrow">Calendar Day</p>
      <h3>${formatDate(date)}</h3>
    </div>
    <div class="event-detail-list">
      ${
        events.length
          ? events
              .map(
                (item) => `
                  <article class="event-detail-item">
                    <strong>${item.title}</strong>
                    <span>${item.allDay ? "全天" : item.time || "待定"}</span>
                  </article>
                `,
              )
              .join("")
          : `<p class="empty-day">这一天还没有事项。</p>`
      }
      <button class="calendar-create-button wide" type="button" data-open-create="calendar" data-date="${date}">创建这一天的事件</button>
    </div>
  `;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeCreateModal() {
  const modal = document.querySelector(".event-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function showView() {
  const id = window.location.hash.slice(1) || "home";
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".top-nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${id}`));
  window.scrollTo({ top: 0, behavior: "instant" });
}

function openLightbox(index) {
  currentImageIndex = index;
  const item = gallery[currentImageIndex];
  const lightbox = document.querySelector(".lightbox");
  const image = lightbox.querySelector("img");
  image.src = item.src;
  image.alt = item.caption;
  lightbox.querySelector("figcaption").textContent = item.caption;
  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  const lightbox = document.querySelector(".lightbox");
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");
}

function moveLightbox(direction) {
  openLightbox((currentImageIndex + direction + gallery.length) % gallery.length);
}

function renderAll() {
  if (!data) return;
  gallery = [];
  renderCreateActions();
  renderLatestMonth();
  renderReminders();
  renderTimeline();
  renderAlbums();
  renderMap();
  renderCalendar();
  renderArchive();
  showView();
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${year} 年 ${Number(month)} 月${day ? ` ${Number(day)} 日` : ""}`;
}

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function groupByYear(items, key) {
  const groups = items.reduce((map, item) => {
    const year = String(item[key]).slice(0, 4);
    map.set(year, [...(map.get(year) || []), item]);
    return map;
  }, new Map());
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function groupedTravelCountries() {
  const groups = data.travelPlaces.reduce((map, place) => {
    const id = place.country;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: place.country,
        country: place.country,
        kind: place.kind,
        position: countryPosition(place),
        summary: "",
        trips: [],
      });
    }
    map.get(id).trips.push(place);
    return map;
  }, new Map());

  return [...groups.values()].map((group) => normalizeTravelGroup(group, true));
}

function groupedTravelPlaces() {
  const groups = data.travelPlaces.filter((place) => place.country === "中国").reduce((map, place) => {
    const id = placeKey(place);
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: place.name,
        country: place.country,
        kind: place.kind,
        position: cityPosition(place),
        summary: place.summary,
        trips: [],
      });
    }
    map.get(id).trips.push(place);
    return map;
  }, new Map());
  return [...groups.values()].map((group) => normalizeTravelGroup(group, false));
}

function withPinOffsets(places) {
  return places.map((place, index) => {
    return {
      ...place,
      pinPosition: {
        x: clamp(place.position.x, 0, 100),
        y: clamp(place.position.y, 0, 100),
      },
      pinZ: 20 + index,
    };
  });
}

function pinPlacementClass(position) {
  const classes = [];
  if (position.y < 30) classes.push("label-below");
  if (position.x < 24) classes.push("label-right");
  if (position.x > 76) classes.push("label-left");
  return classes.join(" ");
}

function normalizeTravelGroup(group, isCountryGroup) {
  const trips = group.trips.slice().sort((a, b) => b.date.localeCompare(a.date));
  const latestTrip = trips[0];
  const names = [...new Set(trips.map((trip) => trip.name))];
  return {
    ...group,
    kind: latestTrip?.kind || group.kind,
    position: isCountryGroup ? countryPosition(latestTrip) : group.position,
    summary: isCountryGroup ? `${names.join("、")}留下了 ${trips.length} 次旅行记录。` : group.summary,
    trips,
  };
}

function placeKey(place) {
  if (!place) return "";
  return `${place.country}-${place.name}`.replace(/\s+/g, "-").toLowerCase();
}

function countryPosition(placeOrCountry) {
  const country = typeof placeOrCountry === "string" ? placeOrCountry : placeOrCountry.country;
  if (typeof placeOrCountry !== "string" && placeOrCountry?.worldPosition) return placeOrCountry.worldPosition;
  const positions = {
    中国: { x: 76, y: 43 },
    日本: { x: 82, y: 41 },
    韩国: { x: 79, y: 40 },
    美国: { x: 19, y: 39 },
    法国: { x: 48, y: 36 },
    英国: { x: 47, y: 32 },
    澳大利亚: { x: 84, y: 74 },
  };
  if (positions[country]) return positions[country];
  return placeOrCountry.worldPosition || placeOrCountry.position || { x: 50, y: 45 };
}

function cityPosition(place) {
  const positions = {
    杭州: { x: 74, y: 61 },
    湖州: { x: 72, y: 58 },
    三亚: { x: 57, y: 87 },
    成都: { x: 42, y: 58 },
  };
  if (place.country === "中国" && place.chinaPosition) return place.chinaPosition;
  if (positions[place.name]) return positions[place.name];
  return {
    x: clamp((Number(place.position?.x) - 60) * 2.2 + 44, 12, 88),
    y: clamp((Number(place.position?.y) - 35) * 2.2 + 44, 12, 88),
  };
}

function moveCalendar(monthOffset) {
  const date = new Date(calendarCursor.year, calendarCursor.month - 1 + monthOffset, 1);
  calendarCursor = { year: date.getFullYear(), month: date.getMonth() + 1 };
  renderCalendar();
}

function zoomMap(type, delta) {
  const view = mapViews[type];
  if (!view) return;
  view.zoom = clamp(view.zoom + delta, 1, 2.6);
  if (view.zoom === 1) {
    view.panX = 0;
    view.panY = 0;
  }
  renderMap();
}

function updateMapViewport(type) {
  const view = mapViews[type];
  const viewport = document.querySelector(`[data-map-board="${type}"] .world-map-viewport`);
  if (!view || !viewport) return;
  viewport.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
}

function updatePositionPicker(button, event) {
  const picker = button.closest("[data-position-picker]");
  const form = button.closest("form");
  if (!picker || !form) return;

  const rect = button.getBoundingClientRect();
  const view = positionPickerViews[picker.dataset.positionPicker];
  const x = clamp((((event.clientX - rect.left) - view.panX) / view.zoom / rect.width) * 100, 0, 100);
  const y = clamp((((event.clientY - rect.top) - view.panY) / view.zoom / rect.height) * 100, 0, 100);
  const roundedX = Math.round(x * 10) / 10;
  const roundedY = Math.round(y * 10) / 10;
  setPositionPickerValue(form, picker.dataset.positionPicker, roundedX, roundedY);
}

function setPositionPickerValue(form, type, x, y) {
  const picker = form.querySelector(`[data-position-picker="${type}"]`);
  if (!picker) return;
  form.elements[picker.dataset.xName].value = x;
  form.elements[picker.dataset.yName].value = y;
  picker.querySelector("i").style.left = `${x}%`;
  picker.querySelector("i").style.top = `${y}%`;
  picker.querySelector(`[data-position-readout="${type}"]`).textContent = `${x}, ${y}`;
}

function zoomPositionPicker(type, delta) {
  const view = positionPickerViews[type];
  if (!view) return;
  view.zoom = clamp(view.zoom + delta, 1, 3);
  if (view.zoom === 1) {
    view.panX = 0;
    view.panY = 0;
  }
  updatePositionPickerViewport(type);
}

function updatePositionPickerViewport(type) {
  const view = positionPickerViews[type];
  const picker = document.querySelector(`[data-position-picker="${type}"]`);
  if (!view || !picker) return;
  const viewport = picker.querySelector(".position-picker-viewport");
  viewport.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  picker.querySelector(`[data-picker-zoom-label="${type}"]`).textContent = `${Math.round(view.zoom * 100)}%`;
}

function syncExistingTravelPosition(form) {
  if (!form?.matches('[data-create-form="map"]')) return;
  const country = form.elements.country.value.trim();
  const name = form.elements.name.value.trim();
  if (!country || !name) return;

  const existing = data.travelPlaces
    .slice()
    .reverse()
    .find((place) => place.country === country && place.name === name);
  if (!existing) return;

  const world = existing.worldPosition || existing.position;
  const china = existing.chinaPosition || existing.position;
  if (world) setPositionPickerValue(form, "world", Number(world.x), Number(world.y));
  if (china) setPositionPickerValue(form, "china", Number(china.x), Number(china.y));
}

function sortCalendarEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.time || "99:99").localeCompare(b.time || "99:99");
}

function worldMapSvg() {
  return mapImage("world");
}

function chinaMapSvg() {
  return mapImage("china");
}

function mapImage(type) {
  const src = type === "china" ? "assets/maps/china-map.png" : "assets/maps/world-map.png";
  return `<img class="world-map ${type === "china" ? "china-map" : ""}" src="${src}" alt="${type === "china" ? "中国地图占位图" : "世界地图占位图"}" draggable="false" />`;
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function initAuthGate() {
  const form = document.querySelector("[data-auth-form]");
  const input = document.querySelector("[data-auth-password]");
  if (!form) return;

  if (data && location.protocol !== "file:") {
    unlockSite();
    return;
  }

  if (data && location.protocol === "file:" && localStorage.getItem(AUTH_STORAGE_KEY) === "true") {
    unlockSite();
    return;
  }

  document.body.classList.add("auth-locked");
  window.setTimeout(() => input?.focus(), 80);
}

function unlockSite() {
  localStorage.setItem(AUTH_STORAGE_KEY, "true");
  document.body.classList.remove("auth-locked");
  renderAll();
}

async function submitAuthForm(form) {
  const error = form.querySelector("[data-auth-error]");
  const password = form.elements.password.value.trim();
  error.textContent = "";

  if (location.protocol === "file:") {
    if (password === CLIENT_SITE_PASSWORD) {
      unlockSite();
      return;
    }
    error.textContent = "密码不正确，请再试一次。";
    return;
  }

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new Error("login failed");
    localStorage.setItem(AUTH_STORAGE_KEY, "true");
    window.location.reload();
  } catch (error) {
    form.elements.password.select();
    error.textContent = "密码不正确，请再试一次。";
  }
}

initAuthGate();

window.addEventListener("hashchange", showView);

document.addEventListener("click", (event) => {
  const photoTrigger = event.target.closest("[data-photo-index]");
  if (photoTrigger) openLightbox(Number(photoTrigger.dataset.photoIndex));

  const filter = event.target.closest("[data-filter]");
  if (filter) return;

  const yearToggle = event.target.closest("[data-toggle-year]");
  if (yearToggle) {
    const section = yearToggle.closest("[data-year-section]");
    section.classList.toggle("collapsed");
    yearToggle.setAttribute("aria-expanded", String(!section.classList.contains("collapsed")));
  }

  const place = event.target.closest("[data-place]");
  if (place) {
    selectedMapPlace = { type: place.dataset.mapType, id: place.dataset.place };
    renderMap();
  }

  const zoomOut = event.target.closest("[data-map-zoom-out]");
  if (zoomOut) zoomMap(zoomOut.dataset.mapZoomOut, -0.2);

  const zoomIn = event.target.closest("[data-map-zoom-in]");
  if (zoomIn) zoomMap(zoomIn.dataset.mapZoomIn, 0.2);

  const mapBoard = event.target.closest("[data-map-board]");
  if (mapBoard && !place && !event.target.closest(".map-toolbar") && !suppressMapClick) {
    selectedMapPlace = null;
    renderMap();
  }

  const create = event.target.closest("[data-open-create]");
  if (create) {
    openCreateModal(create.dataset.openCreate);
    const dateInput = document.querySelector('[data-create-form="calendar"] input[name="date"]');
    if (dateInput && create.dataset.date) dateInput.value = create.dataset.date;
  }

  const positionMap = event.target.closest(".position-picker-map");
  if (positionMap && !suppressPositionPickerClick) updatePositionPicker(positionMap, event);

  const pickerZoomOut = event.target.closest("[data-picker-zoom-out]");
  if (pickerZoomOut) zoomPositionPicker(pickerZoomOut.dataset.pickerZoomOut, -0.25);

  const pickerZoomIn = event.target.closest("[data-picker-zoom-in]");
  if (pickerZoomIn) zoomPositionPicker(pickerZoomIn.dataset.pickerZoomIn, 0.25);

  const day = event.target.closest("[data-calendar-day]");
  if (day) openDayModal(day.dataset.calendarDay);

  const archiveTab = event.target.closest("[data-archive-tab]");
  if (archiveTab) openArchiveItem(archiveTab.dataset.archiveCard, archiveTab.dataset.archiveTab);

  if (event.target.closest("[data-calendar-prev]")) moveCalendar(-1);
  if (event.target.closest("[data-calendar-next]")) moveCalendar(1);

  if (event.target.closest("[data-close-create]") || event.target.matches(".event-modal-close")) closeCreateModal();
  if (event.target.matches(".event-modal")) closeCreateModal();
  if (event.target.matches(".close-button")) closeLightbox();
  if (event.target.matches(".prev-button")) moveLightbox(-1);
  if (event.target.matches(".next-button")) moveLightbox(1);
  if (event.target.matches(".lightbox")) closeLightbox();
});

document.addEventListener("submit", (event) => {
  const authForm = event.target.closest("[data-auth-form]");
  if (authForm) {
    event.preventDefault();
    submitAuthForm(authForm);
    return;
  }

  const form = event.target.closest("[data-create-form]");
  if (!form) return;
  event.preventDefault();
  submitCreateForm(form);
});

document.addEventListener("input", (event) => {
  if (event.target.matches('[data-create-form="map"] input[name="name"], [data-create-form="map"] input[name="country"]')) {
    syncExistingTravelPosition(event.target.closest("form"));
  }
});

document.addEventListener("pointerdown", (event) => {
  const pickerMap = event.target.closest(".position-picker-map");
  if (pickerMap && !event.target.closest(".position-picker-controls")) {
    const picker = pickerMap.closest("[data-position-picker]");
    const type = picker?.dataset.positionPicker;
    const view = positionPickerViews[type];
    if (view?.zoom > 1) {
      activePositionPickerDrag = {
        type,
        map: pickerMap,
        startX: event.clientX,
        startY: event.clientY,
        panX: view.panX,
        panY: view.panY,
        moved: false,
      };
      pickerMap.setPointerCapture?.(event.pointerId);
      return;
    }
  }

  const board = event.target.closest("[data-map-board]");
  if (!board || event.target.closest("[data-place]") || event.target.closest(".map-toolbar")) return;

  const type = board.dataset.mapBoard;
  const view = mapViews[type];
  if (!view || view.zoom <= 1) return;

  activeMapDrag = {
    type,
    board,
    startX: event.clientX,
    startY: event.clientY,
    panX: view.panX,
    panY: view.panY,
    moved: false,
  };
  board.classList.add("dragging");
  board.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (activePositionPickerDrag) {
    const view = positionPickerViews[activePositionPickerDrag.type];
    const deltaX = event.clientX - activePositionPickerDrag.startX;
    const deltaY = event.clientY - activePositionPickerDrag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) activePositionPickerDrag.moved = true;
    view.panX = activePositionPickerDrag.panX + deltaX;
    view.panY = activePositionPickerDrag.panY + deltaY;
    updatePositionPickerViewport(activePositionPickerDrag.type);
    return;
  }

  if (!activeMapDrag) return;
  const view = mapViews[activeMapDrag.type];
  const deltaX = event.clientX - activeMapDrag.startX;
  const deltaY = event.clientY - activeMapDrag.startY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 4) activeMapDrag.moved = true;
  view.panX = activeMapDrag.panX + deltaX;
  view.panY = activeMapDrag.panY + deltaY;
  updateMapViewport(activeMapDrag.type);
});

document.addEventListener("pointerup", () => {
  if (activePositionPickerDrag) {
    suppressPositionPickerClick = activePositionPickerDrag.moved;
    activePositionPickerDrag = null;
    window.setTimeout(() => {
      suppressPositionPickerClick = false;
    }, 0);
    return;
  }

  if (!activeMapDrag) return;
  activeMapDrag.board.classList.remove("dragging");
  suppressMapClick = activeMapDrag.moved;
  activeMapDrag = null;
  window.setTimeout(() => {
    suppressMapClick = false;
  }, 0);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
    closeCreateModal();
  }
  if (!document.querySelector(".lightbox.open")) return;
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});
