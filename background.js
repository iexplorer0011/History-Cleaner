const STORAGE_KEY = "cleanupSettings";

const DEFAULT_SETTINGS = {
  deleteHistory: true,
  deleteFormData: true,
  deleteTypedUrls: true,
  deleteCache: true,
  deleteCookies: true,
  timeRange: "all"
};

/**
 * chrome.storage.local에서 설정을 읽어옵니다.
 * 저장값이 없거나 일부만 있으면 기본값으로 채워서 반환합니다.
 * @returns {Promise<object>}
 */
async function getCleanupSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEY] || {})
  };
}

/**
 * browsingData.remove에 전달할 삭제 옵션 객체를 구성합니다.
 * @param {object} settings
 * @returns {object}
 */
function buildRemovalDataTypes(settings) {
  return {
    history: settings.deleteHistory,
    formData: settings.deleteFormData,
    cache: settings.deleteCache,
    cookies: settings.deleteCookies
  };
}

/**
 * 배열을 지정 크기로 나눕니다.
 * typed URL 삭제를 너무 큰 병렬 요청으로 보내지 않기 위해 사용합니다.
 * @param {Array<any>} list
 * @param {number} size
 * @returns {Array<Array<any>>}
 */
function chunkArray(list, size) {
  const chunks = [];

  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }

  return chunks;
}

/**
 * 주소창 입력 기록(typed URLs)만 별도로 삭제합니다.
 * 조건:
 * - 방문 기록 삭제가 꺼져 있고
 * - typed URLs 삭제가 켜져 있을 때만 실행
 *
 * 구현 방법:
 * 1) 전체 방문 기록을 조회
 * 2) typedCount > 0 인 URL만 추림
 * 3) URL 단위로 삭제
 */
async function clearTypedUrlsOnly() {
  const historyItems = await chrome.history.search({
    text: "",
    startTime: 0,
    maxResults: 1000000
  });

  const typedUrls = historyItems
    .filter((item) => item.typedCount && item.typedCount > 0 && item.url)
    .map((item) => item.url);

  if (typedUrls.length === 0) {
    return;
  }

  const batches = chunkArray(typedUrls, 200);

  for (const batch of batches) {
    const tasks = batch.map((url) => chrome.history.deleteUrl({ url }));
    await Promise.allSettled(tasks);
  }
}

/**
 * 브라우저 시작 시 실행되는 핵심 정리 함수입니다.
 */
async function runCleanupOnStartup() {
  try {
    const settings = await getCleanupSettings();
    const dataToRemove = buildRemovalDataTypes(settings);

    const shouldRunBrowsingDataRemove = Object.values(dataToRemove).some(Boolean);

    if (shouldRunBrowsingDataRemove) {
      await chrome.browsingData.remove(
        {
          // 전체 기간 삭제: 요구사항에 따라 since 0 사용
          since: 0
        },
        dataToRemove
      );
    }

    // 방문 기록을 직접 삭제하지 않을 때만 typed URLs 분리 삭제가 필요합니다.
    if (!settings.deleteHistory && settings.deleteTypedUrls) {
      await clearTypedUrlsOnly();
    }

    console.log("History Cleaner: startup cleanup completed");
  } catch (error) {
    // 서비스 워커는 조용히 종료될 수 있으므로 오류를 명확히 남깁니다.
    console.error("History Cleaner: startup cleanup failed", error);
  }
}

/**
 * 최초 설치/업데이트 시 저장값이 없으면 기본 설정을 저장합니다.
 */
async function ensureDefaultSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await ensureDefaultSettings();
  } catch (error) {
    console.error("History Cleaner: failed to initialize default settings", error);
  }
});

// 안정성이 높은 시작 시점 자동 정리 이벤트
chrome.runtime.onStartup.addListener(async () => {
  await runCleanupOnStartup();
});
