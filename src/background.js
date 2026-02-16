const STORAGE_KEY = "cleanupSettings";
const STARTUP_RETRY_ALARM_NAME = "historyCleanerStartupRetry";
const STARTUP_RETRY_DELAY_MINUTES = 1;
const MAX_HISTORY_RESULTS = 1000000;
const MAX_VISIT_SCAN_ITEMS = 5000;
const VISIT_SCAN_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 200;

// 주소창 입력/생성 기반 방문 전이 타입입니다.
// 참고: Chrome history API 문서의 VisitItem.transition 타입
const ADDRESS_BAR_TRANSITIONS = new Set([
  "typed",
  "generated",
  "keyword",
  "keyword_generated"
]);

let cleanupInProgress = false;

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
    maxResults: MAX_HISTORY_RESULTS
  });

  // 1) typedCount로 바로 식별되는 URL 수집
  const typedUrlSet = new Set(
    historyItems
      .filter((item) => item.typedCount && item.typedCount > 0 && item.url)
      .map((item) => item.url)
  );

  // 2) typedCount로 잡히지 않는 주소창 기록을 보완하기 위해 visit transition 검사
  //    (성능 보호를 위해 최근 항목 일부만 검사)
  const visitScanTargets = historyItems
    .filter((item) => item.url && !(item.typedCount && item.typedCount > 0))
    .slice(0, MAX_VISIT_SCAN_ITEMS);

  const visitBatches = chunkArray(visitScanTargets, VISIT_SCAN_BATCH_SIZE);

  for (const batch of visitBatches) {
    const visitResults = await Promise.allSettled(
      batch.map((item) => chrome.history.getVisits({ url: item.url }))
    );

    for (let index = 0; index < visitResults.length; index += 1) {
      const result = visitResults[index];
      if (result.status !== "fulfilled") {
        continue;
      }

      const visits = result.value || [];
      const hasAddressBarTransition = visits.some((visit) =>
        ADDRESS_BAR_TRANSITIONS.has(visit.transition)
      );

      if (hasAddressBarTransition) {
        typedUrlSet.add(batch[index].url);
      }
    }
  }

  const typedUrls = Array.from(typedUrlSet);

  if (typedUrls.length === 0) {
    return;
  }

  const batches = chunkArray(typedUrls, DELETE_BATCH_SIZE);

  for (const batch of batches) {
    const tasks = batch.map((url) => chrome.history.deleteUrl({ url }));
    await Promise.allSettled(tasks);
  }
}

/**
 * 브라우저 시작 시 실행되는 핵심 정리 함수입니다.
 */
async function runCleanupOnStartup(reason = "startup") {
  if (cleanupInProgress) {
    console.log(`History Cleaner: cleanup skipped (${reason}) because another cleanup is running`);
    return;
  }

  cleanupInProgress = true;

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

    // 일부 환경에서는 browsingData.remove({history:true}) 후에도
    // 주소창 제안이 남는 케이스가 있어 history API로 한 번 더 강제 정리합니다.
    if (settings.deleteHistory) {
      await chrome.history.deleteAll();
    }

    // 방문 기록을 직접 삭제하지 않을 때만 typed URLs 분리 삭제가 필요합니다.
    if (!settings.deleteHistory && settings.deleteTypedUrls) {
      await clearTypedUrlsOnly();
    }

    // 디버깅용 probe: 실제 히스토리 저장소가 비었는지 확인합니다.
    const historyProbe = await chrome.history.search({
      text: "",
      startTime: 0,
      maxResults: 1
    });
    console.log(
      `History Cleaner: history probe after cleanup (${reason}) => ${
        historyProbe.length === 0 ? "empty" : "not-empty"
      }`
    );

    console.log(`History Cleaner: cleanup completed (${reason})`);
  } catch (error) {
    // 서비스 워커는 조용히 종료될 수 있으므로 오류를 명확히 남깁니다.
    console.error(`History Cleaner: cleanup failed (${reason})`, error);
  } finally {
    cleanupInProgress = false;
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

/**
 * Chrome 시작 직후에는 동기화된 기록이 나중에 다시 들어오는 경우가 있어
 * 1분 뒤 한 번 더 정리 작업을 수행합니다.
 */
async function scheduleStartupRetryCleanup() {
  await chrome.alarms.clear(STARTUP_RETRY_ALARM_NAME);
  chrome.alarms.create(STARTUP_RETRY_ALARM_NAME, {
    delayInMinutes: STARTUP_RETRY_DELAY_MINUTES
  });
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
  await runCleanupOnStartup("startup");
  await scheduleStartupRetryCleanup();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== STARTUP_RETRY_ALARM_NAME) {
    return;
  }

  await runCleanupOnStartup("startup-retry");
});
