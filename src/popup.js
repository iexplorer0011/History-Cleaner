// 설정을 저장할 key 이름입니다.
const STORAGE_KEY = "cleanupSettings";

// 확장 프로그램을 처음 설치했을 때 사용할 기본 설정입니다.
const DEFAULT_SETTINGS = {
  deleteHistory: true,
  deleteFormData: true,
  deleteTypedUrls: true,
  deleteCache: true,
  deleteCookies: true,
  deleteDownloads: true,
  timeRange: "all"
};

const checkboxIds = [
  "deleteHistory",
  "deleteFormData",
  "deleteTypedUrls",
  "deleteCache",
  "deleteCookies",
  "deleteDownloads"
];

const statusMessageEl = document.getElementById("statusMessage");
const checkboxElements = checkboxIds.reduce((acc, id) => {
  acc[id] = document.getElementById(id);
  return acc;
}, {});

/**
 * 상태 문구를 표시합니다.
 * @param {string} message 사용자에게 보여줄 문장
 * @param {"success"|"error"} type 표시 타입
 */
function setStatus(message, type = "success") {
  statusMessageEl.textContent = message;
  statusMessageEl.className = `status ${type}`;
}

/**
 * 설정 객체를 가져오되, 누락값이 있으면 기본값으로 채웁니다.
 * @returns {Promise<object>}
 */
async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEY] || {})
  };
}

/**
 * 현재 체크박스 상태를 객체로 변환합니다.
 * @returns {object}
 */
function readSettingsFromUI() {
  const settings = { timeRange: "all" };

  for (const id of checkboxIds) {
    settings[id] = checkboxElements[id].checked;
  }

  return settings;
}

/**
 * 방문 기록/typed URLs 제약 사항을 UI에 반영합니다.
 * - 방문 기록을 삭제하면 typed URLs는 기술적으로 항상 함께 삭제됩니다.
 * - 그래서 방문 기록 ON일 때 typed URLs는 자동 ON + 비활성 처리합니다.
 */
function applyHistoryTypedDependency() {
  const historyCheckbox = checkboxElements.deleteHistory;
  const typedUrlsCheckbox = checkboxElements.deleteTypedUrls;

  if (historyCheckbox.checked) {
    typedUrlsCheckbox.checked = true;
    typedUrlsCheckbox.disabled = true;
    typedUrlsCheckbox.title =
      "방문 기록 삭제가 켜져 있으면 주소창 입력 기록은 함께 삭제됩니다.";
    return;
  }

  typedUrlsCheckbox.disabled = false;
  typedUrlsCheckbox.title = "";
}

/**
 * 저장된 설정을 체크박스에 반영합니다.
 * @param {object} settings
 */
function writeSettingsToUI(settings) {
  for (const id of checkboxIds) {
    checkboxElements[id].checked = Boolean(settings[id]);
  }

  applyHistoryTypedDependency();
}

/**
 * 현재 UI 상태를 저장합니다.
 */
async function saveCurrentSettings() {
  try {
    const settings = readSettingsFromUI();
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    setStatus("설정이 저장되었습니다.", "success");
  } catch (error) {
    console.error("설정 저장 실패:", error);
    setStatus("설정 저장 중 오류가 발생했습니다.", "error");
  }
}

/**
 * 이벤트를 연결합니다.
 */
function attachEvents() {
  for (const id of checkboxIds) {
    checkboxElements[id].addEventListener("change", async () => {
      // 사용자가 방문 기록을 ON/OFF 했을 때 typed URLs 상태를 즉시 맞춥니다.
      applyHistoryTypedDependency();
      await saveCurrentSettings();
    });
  }
}

/**
 * 팝업 초기화:
 * 1) 저장값 읽기
 * 2) UI 반영
 * 3) 이벤트 연결
 */
async function initializePopup() {
  try {
    const settings = await loadSettings();
    writeSettingsToUI(settings);
    attachEvents();
    setStatus("현재 설정을 불러왔습니다.", "success");
  } catch (error) {
    console.error("팝업 초기화 실패:", error);
    setStatus("설정을 불러오지 못했습니다.", "error");
  }
}

document.addEventListener("DOMContentLoaded", initializePopup);
