import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

/** ===================== 디자인 & 유틸 ===================== **/
const LEVELS = ["여유", "보통", "약간 붐빔", "혼잡", "매우 혼잡", "매우 붐빔"];
const levelColor = (lvl) => {
  switch (lvl) {
    case "여유":
      return "#2e7d32";
    case "보통":
      return "#1976d2";
    case "약간 붐빔":
      return "#f57c00";
    case "매우 붐빔":
    case "혼잡":
    case "매우 혼잡":
      return "#d32f2f";
    default:
      return "#6b7280"; // gray-500
  }
};

const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "https://crowdservice-seoul.onrender.com";
const KAKAO_APP_KEY = "4be286df1e9ff528c5bc9a5cdbf1303e"; // 필요하면 .env로 이동

function chip(lvl) {
  const c = levelColor(lvl);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${c}20`,
        color: c,
        background: `${c}10`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: c,
          display: "inline-block",
        }}
      />
      {lvl}
    </span>
  );
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const mm = `${d.getMonth() + 1}`.padStart(2, "0");
    const dd = `${d.getDate()}`.padStart(2, "0");
    const hh = `${d.getHours()}`.padStart(2, "0");
    const m = `${d.getMinutes()}`.padStart(2, "0");
    return `${mm}/${dd} ${hh}:${m}`;
  } catch {
    return "";
  }
}

/** SVG 데이터 URL 마커 */
function markerImageForLevel(lvl) {
  const fill = levelColor(lvl);
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="9" fill="${fill}" />
    <circle cx="14" cy="14" r="10.5" fill="none" stroke="white" stroke-width="3"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return new window.kakao.maps.MarkerImage(
    url,
    new window.kakao.maps.Size(28, 28),
    { offset: new window.kakao.maps.Point(14, 14) }
  );
}

/** ===================== 메인 컴포넌트 ===================== **/
export default function MapPage() {
  const markersRef = useRef([]);
  const mapRef = useRef(null);
  const infoRef = useRef(null);
  const [items, setItems] = useState([]);
  const [statusMsg, setStatusMsg] = useState("혼잡도 불러오는 중…");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [showList, setShowList] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const matchQ = q === "" || String(it.name || "").toLowerCase().includes(q);
      const matchL = !levelFilter || it.area_congest_lvl === levelFilter;
      return matchQ && matchL;
    });
  }, [items, search, levelFilter]);

  /** Kakao SDK 로드 & 지도 초기화 */
  useEffect(() => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false`;
    document.head.appendChild(script);

    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById("map");
        if (!container) return;

        const SW = new window.kakao.maps.LatLng(37.413294, 126.734086);
        const NE = new window.kakao.maps.LatLng(37.715133, 127.269311);
        const SEOUL_BOUNDS = new window.kakao.maps.LatLngBounds(SW, NE);

        const map = new window.kakao.maps.Map(container, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 6,
        });
        map.setBounds(SEOUL_BOUNDS);
        map.setMinLevel(5);
        map.setMaxLevel(9);
        mapRef.current = map;

        const zoomControl = new window.kakao.maps.ZoomControl();
        map.addControl(zoomControl, window.kakao.maps.ControlPosition.RIGHT);

        infoRef.current = new window.kakao.maps.InfoWindow({ zIndex: 3 });
        window.kakao.maps.event.addListener(map, "click", () => infoRef.current.close());

        // 첫 데이터 로드
        fetchData();

        // 리사이즈 시 지도 relayout
        const onResize = () => map.relayout();
        window.addEventListener("resize", onResize);

        // 정리
        return () => {
          window.removeEventListener("resize", onResize);
        };
      });
    };

    return () => {
      markersRef.current.forEach((m) => m.setMap && m.setMap(null));
      markersRef.current = [];
      if (script.parentNode) document.head.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 데이터 가져오기 */
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await axios.get(`${API_BASE}/congestion?include_fcst=true`, {
        timeout: 15000,
      });
      const data = res.data;
      if (!data?.ok || !Array.isArray(data.items)) {
        throw new Error("데이터 형식 오류");
      }
      setItems(data.items);

      // 마지막 업데이트(아이템 중 가장 최신)
      const latest = data.items
        .map((x) => new Date(x.updated_at || 0).getTime())
        .filter((t) => !Number.isNaN(t))
        .sort((a, b) => b - a)[0];
      setLastUpdated(latest ? fmtTime(latest) : "");

      setStatusMsg(`✅ 혼잡도 ${data.items.length}개 불러오기 성공`);
    } catch (e) {
      const msg =
        e?.response?.status
          ? `서버 응답 ${e.response.status}`
          : e?.request
          ? "네트워크 문제 또는 CORS"
          : e?.message || "오류";
      setErrorMsg(`혼잡도 불러오기 실패: ${msg}`);
      setStatusMsg("❌ 혼잡도 불러오기 실패");
    } finally {
      setLoading(false);
      // 새 데이터 기준으로 마커 갱신
      setTimeout(renderMarkers, 0);
    }
  };

  /** 마커 그리기(필터 반영) */
  useEffect(() => {
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.setMap && m.setMap(null));
    markersRef.current = [];
  };

  const renderMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    clearMarkers();

    const info = infoRef.current;

    filtered.forEach((spot) => {
      const lat = Number(spot.lat);
      const lng = Number(spot.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      const pos = new window.kakao.maps.LatLng(lat, lng);
      const marker = new window.kakao.maps.Marker({
        position: pos,
        map,
        title: spot.name,
        image: markerImageForLevel(spot.area_congest_lvl),
      });

      // fcst 블록
      let fcstHtml = "";
      if (Array.isArray(spot.fcst) && spot.fcst.length > 0) {
        fcstHtml = `
          <div style="font-size:11px;color:#555;margin-top:8px;">
            <div style="font-weight:700;margin-bottom:4px">예측 혼잡도</div>
            <ul style="margin:0;padding:0;list-style:none;max-height:140px;overflow-y:auto;">
              ${spot.fcst
                .map(
                  (f) => `
                <li style="margin:0 0 2px 0;">
                  ${new Date(f.fcst_time).getHours()}시 :
                  <span style="color:${levelColor(f.fcst_congest_lvl)};font-weight:700">
                    ${escapeHtml(f.fcst_congest_lvl)}
                  </span>
                  (${Number(f.fcst_ppltn_min).toLocaleString()} ~ ${Number(
                    f.fcst_ppltn_max
                  ).toLocaleString()})
                </li>`
                )
                .join("")}
            </ul>
          </div>
        `;
      }

      const html = `
        <div style="min-width:240px;padding:10px;font-family:-apple-system,Segoe UI,Roboto,'Noto Sans KR',sans-serif">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:800;font-size:14px">${escapeHtml(spot.name || "")}</div>
            <div style="font-size:12px">${chipHtml(spot.area_congest_lvl)}</div>
          </div>
          <div style="font-size:12px;color:#444;margin-bottom:2px">
            추정 인원:
            <strong>${Number(spot.area_ppltn_min || 0).toLocaleString()} ~ ${Number(
        spot.area_ppltn_max || 0
      ).toLocaleString()}</strong>
          </div>
          <div style="font-size:11px;color:#888">업데이트: ${escapeHtml(
            spot.updated_at || ""
          )}</div>
          ${fcstHtml}
        </div>
      `;

      window.kakao.maps.event.addListener(marker, "click", () => {
        info.setContent(html);
        info.open(map, marker);
      });

      markersRef.current.push(marker);
    });
  };

  /** chip() JSX를 InfoWindow 안에서 쓰기 위한 간단한 HTML 버전 */
  const chipHtml = (lvl) => {
    const c = levelColor(lvl);
    return `
      <span style="
        display:inline-flex;align-items:center;gap:6px;
        border:1px solid ${c}20;color:${c};background:${c}10;
        border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;">
        <span style="width:8px;height:8px;border-radius:999px;background:${c};display:inline-block"></span>
        ${escapeHtml(lvl || "")}
      </span>`;
  };

  /** 조작 버튼 */
  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    const SW = new window.kakao.maps.LatLng(37.413294, 126.734086);
    const NE = new window.kakao.maps.LatLng(37.715133, 127.269311);
    map.setBounds(new window.kakao.maps.LatLngBounds(SW, NE));
  };

  const gotoMyLocation = () => {
    if (!navigator.geolocation) return alert("브라우저가 위치 정보를 지원하지 않아요.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = mapRef.current;
        if (!map) return;
        const center = new window.kakao.maps.LatLng(latitude, longitude);
        map.setCenter(center);
        map.setLevel(5);
      },
      () => alert("현재 위치를 가져오지 못했어요.")
    );
  };

  /** ===================== 렌더 ===================== **/
  const css = `
  .app-root{height:100dvh;display:flex;flex-direction:column;background:#fafafa;color:#111;}
  .appbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#ffffffcc;backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}
  .brand{font-weight:900;font-size:18px;letter-spacing:.3px}
  .subtle{color:#6b7280;font-size:12px}
  .controls{display:flex;gap:8px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid #f0f0f0;background:#fff}
  .input{flex:1 1 260px;min-width:220px;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:14px;outline:none}
  .select{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:14px;background:#fff}
  .btn{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-size:14px;background:#fff;cursor:pointer}
  .btn:hover{background:#f8fafc}
  .map-wrap{flex:1 1 auto;min-height:0;position:relative}
  #map{position:absolute;inset:0}
  .legend{position:absolute;left:12px;bottom:12px;background:#fff;border:1px solid #eee;border-radius:12px;padding:10px 12px;box-shadow:0 3px 12px rgba(0,0,0,.06);z-index:2}
  .legend h4{margin:0 0 6px 0;font-size:12px;color:#6b7280}
  .chips{display:flex;gap:6px;flex-wrap:wrap;max-width:240px}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#111;color:#fff;padding:10px 14px;border-radius:999px;font-size:13px;opacity:.92;z-index:10;box-shadow:0 6px 24px rgba(0,0,0,.25)}
  .panel{position:absolute;right:12px;top:12px;bottom:12px;width:320px;max-width:85vw;background:#fff;border:1px solid #eee;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:10px;display:flex;flex-direction:column;z-index:2}
  .panel-header{display:flex;justify-content:space-between;align-items:center;padding:4px 4px 8px 4px;border-bottom:1px solid #f3f4f6}
  .panel-list{padding:8px 4px;overflow:auto}
  .list-item{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px dashed #f1f5f9;padding:10px 2px;cursor:pointer}
  .list-item:hover{background:#f9fafb}
  .small{font-size:12px;color:#6b7280}
  .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.6);z-index:3}
  `;

  const maxItemsText =
    filtered.length !== items.length
      ? `${filtered.length}/${items.length}`
      : `${items.length}`;

  return (
    <div className="app-root">
      <style>{css}</style>

      {/* AppBar */}
      <div className="appbar">
        <div className="brand">서울 관광지 혼잡도 지도</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="subtle">
            {lastUpdated ? `업데이트 ${lastUpdated}` : "업데이트 시간 없음"}
          </span>
          <button className="btn" onClick={fetchData}>새로고침</button>
          <button className="btn" onClick={gotoMyLocation}>현재 위치</button>
          <button className="btn" onClick={resetView}>지도 리셋</button>
          <button className="btn" onClick={() => setShowList((s) => !s)}>
            {showList ? "목록 닫기" : "목록 열기"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <input
          className="input"
          placeholder="장소 검색 (예: 광장시장, 남산타워)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
        >
          <option value="">전체 혼잡도</option>
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="small">표시 수: {maxItemsText}</span>
        </div>
      </div>

      {/* Map */}
      <div className="map-wrap">
        <div id="map" />
        {loading && (
          <div className="loading">
            <div style={{ fontSize: 14, color: "#111", background: "#fff", padding: "10px 14px", borderRadius: 999, border: "1px solid #eee" }}>
              지도를 준비하는 중…
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="legend">
          <h4>범례</h4>
          <div className="chips">
            {["여유", "보통", "약간 붐빔", "혼잡"].map((lv) => (
              <span key={lv}>{chip(lv)}</span>
            ))}
          </div>
        </div>

        {/* Side Panel */}
        {showList && (
          <div className="panel">
            <div className="panel-header">
              <strong>장소 목록</strong>
              <span className="small">{maxItemsText}개</span>
            </div>
            <div className="panel-list">
              {filtered.map((it) => (
                <div
                  key={`${it.area_cd || it.name}-${it.lat}-${it.lon}`}
                  className="list-item"
                  onClick={() => {
                    const map = mapRef.current;
                    if (!map) return;
                    const lat = Number(it.lat);
                    const lng = Number(it.lon);
                    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
                    const pos = new window.kakao.maps.LatLng(lat, lng);
                    map.setCenter(pos);
                    map.setLevel(5);

                    // 마커 클릭과 동일하게 인포윈도우 오픈
                    const html = `
                      <div style="min-width:240px;padding:10px;font-family:-apple-system,Segoe UI,Roboto,'Noto Sans KR',sans-serif">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                          <div style="font-weight:800;font-size:14px">${escapeHtml(it.name || "")}</div>
                          <div style="font-size:12px">${chipHtml(it.area_congest_lvl)}</div>
                        </div>
                        <div style="font-size:12px;color:#444;margin-bottom:2px">
                          추정 인원:
                          <strong>${Number(it.area_ppltn_min || 0).toLocaleString()} ~ ${Number(
                      it.area_ppltn_max || 0
                    ).toLocaleString()}</strong>
                        </div>
                        <div style="font-size:11px;color:#888">업데이트: ${escapeHtml(
                          it.updated_at || ""
                        )}</div>
                      </div>`;
                    infoRef.current.setContent(html);
                    infoRef.current.open(map, null);
                  }}
                >
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it.name}
                    </div>
                    <div className="small">{fmtTime(it.updated_at)}</div>
                  </div>
                  <div>{chip(it.area_congest_lvl)}</div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="small" style={{ padding: 12 }}>
                  조건에 맞는 장소가 없어요.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      <div className="toast">{errorMsg ? errorMsg : statusMsg}</div>
    </div>
  );
}
