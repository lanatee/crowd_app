import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

/** ======== 공통 ======== */
const LEVELS = ["여유", "보통", "약간 붐빔", "혼잡", "매우 혼잡", "매우 붐빔"];
const API_BASE = process.env.REACT_APP_API_BASE_URL || "https://crowdservice-seoul.onrender.com";
const KAKAO_APP_KEY = "4be286df1e9ff528c5bc9a5cdbf1303e";

const levelColor = (lvl) => {
  switch (lvl) {
    case "여유": return "#2e7d32";
    case "보통": return "#1976d2";
    case "약간 붐빔": return "#f57c00";
    case "매우 붐빔":
    case "혼잡":
    case "매우 혼잡": return "#d32f2f";
    default: return "#6b7280";
  }
};
const fmtTime = (ts) => {
  const d = new Date(ts); if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const m  = String(d.getMinutes()).padStart(2,"0");
  return `${mm}/${dd} ${hh}:${m}`;
};
const escapeHtml = (s) =>
  String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

/** ======== 최적화 포인트: 레벨별 마커 아이콘 캐시 ======== */
function getMarkerImageCached(kakao, cacheRef, lvl){
  const key = lvl || "_";
  if (!cacheRef.current[key]) {
    const fill = levelColor(lvl);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <circle cx="14" cy="14" r="9" fill="${fill}"/>
        <circle cx="14" cy="14" r="10.5" fill="none" stroke="white" stroke-width="3"/>
      </svg>`;
    const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    cacheRef.current[key] = new kakao.maps.MarkerImage(
      url,
      new kakao.maps.Size(28, 28),
      { offset: new kakao.maps.Point(14,14) }
    );
  }
  return cacheRef.current[key];
}

/** ======== 메인 ======== */
export default function MapPage() {
  const [items, setItems] = useState([]);
  const [statusMsg, setStatusMsg] = useState("혼잡도 불러오는 중…");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [showList, setShowList] = useState(false);
  const [listLimit, setListLimit] = useState(200);

  const mapRef = useRef(null);
  const infoRef = useRef(null);
  const clustererRef = useRef(null);
  const markerCacheRef = useRef({});     // 레벨별 아이콘 캐시
  const markerByIdRef = useRef(new Map()); // id → kakao Marker
  const itemByIdRef = useRef(new Map());   // id → item (최신 데이터)

  /** --- 검색 디바운스(250ms) --- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);

  /** --- Kakao SDK 로드 & 지도/클러스터러 초기화 --- */
  useEffect(() => {
    const script = document.createElement("script");
    script.async = true;
    // clusterer 라이브러리 추가!
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&autoload=false&libraries=clusterer`;
    document.head.appendChild(script);

    script.onload = () => {
      window.kakao.maps.load(() => {
        const { kakao } = window;
        const container = document.getElementById("map");
        if (!container) return;

        const SW = new kakao.maps.LatLng(37.413294, 126.734086);
        const NE = new kakao.maps.LatLng(37.715133, 127.269311);
        const map = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(37.5665, 126.9780),
          level: 6,
        });
        map.setBounds(new kakao.maps.LatLngBounds(SW, NE));
        map.setMinLevel(5); map.setMaxLevel(9);
        mapRef.current = map;

        const zoomControl = new kakao.maps.ZoomControl();
        map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

        infoRef.current = new kakao.maps.InfoWindow({ zIndex: 3 });
        kakao.maps.event.addListener(map, "click", () => infoRef.current.close());

        // 클러스터러
        clustererRef.current = new kakao.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 7,      // 이 줌 이하에서 클러스터
          gridSize: 60,
          disableClickZoom: false,
        });

        // 첫 데이터 로드
        fetchData();
        // 리사이즈 과도 호출 방지(raf)
        let rafId = 0;
        const onResize = () => {
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => map.relayout());
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      });
    };

    return () => {
      // 정리
      if (script.parentNode) document.head.removeChild(script);
      clustererRef.current?.clear();
      markerByIdRef.current.forEach((m) => m.setMap && m.setMap(null));
      markerByIdRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** --- 서버 데이터 로드 --- */
  const fetchData = async () => {
    setLoading(true); setErrorMsg("");
    try {
      const res = await axios.get(`${API_BASE}/congestion?include_fcst=true`, { timeout: 15000 });
      if (!res.data?.ok || !Array.isArray(res.data.items)) throw new Error("데이터 형식 오류");
      const arr = res.data.items;
      setItems(arr);

      // 최신 업데이트 시각
      const latest = arr.map(x => +new Date(x.updated_at||0)).filter(n=>!Number.isNaN(n)).sort((a,b)=>b-a)[0];
      setLastUpdated(latest ? fmtTime(latest) : "");

      // 마커 생성/업데이트(재사용)
      ensureMarkers(arr);
      // 필터 반영하여 클러스터러 업데이트
      updateClusterer();

      setStatusMsg(`✅ 혼잡도 ${arr.length}개 불러오기 성공`);
    } catch (e) {
      const msg = e?.response?.status ? `서버 응답 ${e.response.status}` :
                  e?.request ? "네트워크 문제 또는 CORS" :
                  e?.message || "오류";
      setErrorMsg(`혼잡도 불러오기 실패: ${msg}`);
      setStatusMsg("❌ 혼잡도 불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  /** --- 아이템 id 규칙 --- */
  const spotId = (s) => s.area_cd || `${s.name}-${s.lat}-${s.lon}`;

  /** --- 마커 1회 생성 & 재사용 --- */
  function ensureMarkers(arr){
    const { kakao } = window;
    if (!kakao || !mapRef.current) return;

    arr.forEach((s) => {
      const id = spotId(s);
      itemByIdRef.current.set(id, s);
      const lat = Number(s.lat), lng = Number(s.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      let marker = markerByIdRef.current.get(id);
      if (!marker) {
        marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(lat, lng),
          title: s.name,
          image: getMarkerImageCached(kakao, markerCacheRef, s.area_congest_lvl),
        });
        marker.__lastLevel = s.area_congest_lvl;

        // 클릭 시에만 InfoWindow HTML 생성 (지연 렌더)
        kakao.maps.event.addListener(marker, "click", () => {
          const data = itemByIdRef.current.get(id);
          if (!data) return;
          const html = buildInfoHtml(data);
          infoRef.current.setContent(html);
          infoRef.current.open(mapRef.current, marker);
        });
        markerByIdRef.current.set(id, marker);
      } else {
        // 위치 변경 또는 레벨 변경 시만 갱신
        const pos = marker.getPosition();
        if (pos.getLat() !== lat || pos.getLng() !== lng) {
          marker.setPosition(new kakao.maps.LatLng(lat, lng));
        }
        if (marker.__lastLevel !== s.area_congest_lvl) {
          marker.setImage(getMarkerImageCached(kakao, markerCacheRef, s.area_congest_lvl));
          marker.__lastLevel = s.area_congest_lvl;
        }
      }
    });
  }

  /** --- 필터링 결과 → 클러스터러에 반영 (clear/addMarkers) --- */
  function updateClusterer(){
    const c = clustererRef.current;
    if (!c) return;
    c.clear();

    const q = debouncedSearch;
    const filteredIds = [];
    for (const s of items) {
      const matchQ = !q || String(s.name||"").toLowerCase().includes(q);
      const matchL = !levelFilter || s.area_congest_lvl === levelFilter;
      if (matchQ && matchL) filteredIds.push(spotId(s));
    }
    const markers = filteredIds
      .map((id) => markerByIdRef.current.get(id))
      .filter(Boolean);

    // 지도에 보이게 추가(클러스터러가 알아서 렌더링)
    c.addMarkers(markers);
  }

  /** --- 필터 변경 시 마커 재생성 없이 클러스터러만 갱신 --- */
  useEffect(() => { updateClusterer(); /* eslint-disable-next-line */ }, [debouncedSearch, levelFilter, items]);

  /** --- InfoWindow HTML (클릭 시 동적 생성) --- */
  function buildInfoHtml(spot){
    const fcstHtml = Array.isArray(spot.fcst) && spot.fcst.length
      ? `
        <div style="font-size:11px;color:#555;margin-top:8px;">
          <div style="font-weight:700;margin-bottom:4px">예측 혼잡도</div>
          <ul style="margin:0;padding:0;list-style:none;max-height:140px;overflow:auto;">
            ${spot.fcst.map(f => `
              <li style="margin-bottom:2px;">
                ${new Date(f.fcst_time).getHours()}시 :
                <span style="color:${levelColor(f.fcst_congest_lvl)};font-weight:700">
                  ${escapeHtml(f.fcst_congest_lvl)}
                </span>
                (${Number(f.fcst_ppltn_min).toLocaleString()} ~ ${Number(f.fcst_ppltn_max).toLocaleString()})
              </li>`).join("")}
          </ul>
        </div>` : "";

    const lvl = spot.area_congest_lvl || "";
    const c = levelColor(lvl);

    return `
      <div style="min-width:240px;padding:10px;font-family:-apple-system,Segoe UI,Roboto,'Noto Sans KR',sans-serif">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:800;font-size:14px">${escapeHtml(spot.name||"")}</div>
          <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid ${c}20;color:${c};background:${c}10;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700">
            <span style="width:8px;height:8px;border-radius:999px;background:${c};display:inline-block"></span>${escapeHtml(lvl)}
          </span>
        </div>
        <div style="font-size:12px;color:#444;margin-bottom:2px">
          추정 인원: <strong>${Number(spot.area_ppltn_min||0).toLocaleString()} ~ ${Number(spot.area_ppltn_max||0).toLocaleString()}</strong>
        </div>
        <div style="font-size:11px;color:#888">업데이트: ${escapeHtml(spot.updated_at||"")}</div>
        ${fcstHtml}
      </div>`;
  }

  /** --- 조작 버튼 --- */
  const resetView = () => {
    const { kakao } = window; if (!kakao || !mapRef.current) return;
    const SW = new kakao.maps.LatLng(37.413294, 126.734086);
    const NE = new kakao.maps.LatLng(37.715133, 127.269311);
    mapRef.current.setBounds(new kakao.maps.LatLngBounds(SW, NE));
  };
  const gotoMyLocation = () => {
    if (!navigator.geolocation) return alert("브라우저가 위치를 지원하지 않아요.");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { kakao } = window; if (!kakao || !mapRef.current) return;
        const center = new kakao.maps.LatLng(coords.latitude, coords.longitude);
        mapRef.current.setCenter(center); mapRef.current.setLevel(5);
      },
      () => alert("현재 위치를 가져오지 못했어요.")
    );
  };

  /** ======== UI ======== */
  const css = `
  .app-root{height:100dvh;display:flex;flex-direction:column;background:#fafafa;color:#111;}
  .appbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#ffffffcc;backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid #eee;position:sticky;top:0;z-index:5}
  .brand{font-weight:900;font-size:18px}
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

  // 목록 표시(간단 가상화: 상위 N개만)
  const q = debouncedSearch;
  const filtered = useMemo(() => {
    return items.filter((s) => {
      const matchQ = !q || String(s.name||"").toLowerCase().includes(q);
      const matchL = !levelFilter || s.area_congest_lvl === levelFilter;
      return matchQ && matchL;
    });
  }, [items, q, levelFilter]);

  const maxText = filtered.length !== items.length ? `${filtered.length}/${items.length}` : `${items.length}`;

  return (
    <div className="app-root">
      <style>{css}</style>

      <div className="appbar">
        <div className="brand">서울 관광지 혼잡도 지도</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span className="subtle">{lastUpdated ? `업데이트 ${lastUpdated}` : "업데이트 정보 없음"}</span>
          <button className="btn" onClick={fetchData}>새로고침</button>
          <button className="btn" onClick={gotoMyLocation}>현재 위치</button>
          <button className="btn" onClick={resetView}>지도 리셋</button>
          <button className="btn" onClick={() => setShowList(v => !v)}>{showList ? "목록 닫기" : "목록 열기"}</button>
        </div>
      </div>

      <div className="controls">
        <input className="input" placeholder="장소 검색 (예: 광장시장, 남산타워)"
               value={search} onChange={(e)=>setSearch(e.target.value)} />
        <select className="select" value={levelFilter} onChange={(e)=>setLevelFilter(e.target.value)}>
          <option value="">전체 혼잡도</option>
          {LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
        </select>
        <div className="small" style={{alignSelf:"center"}}>표시 수: {maxText}</div>
      </div>

      <div className="map-wrap">
        <div id="map" />
        {loading && (
          <div className="loading">
            <div style={{ fontSize:14, color:"#111", background:"#fff", padding:"10px 14px",
                          borderRadius:999, border:"1px solid #eee" }}>
              지도를 준비하는 중…
            </div>
          </div>
        )}

        <div className="legend">
          <h4>범례</h4>
          <div className="chips">
            {["여유","보통","약간 붐빔","혼잡"].map(l => (
              <span key={l} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                border:`1px solid ${levelColor(l)}20`, color:levelColor(l),
                background:`${levelColor(l)}10`, borderRadius:999, padding:"2px 8px", fontSize:12, fontWeight:700
              }}>
                <span style={{width:8,height:8,borderRadius:999,background:levelColor(l),display:"inline-block"}}/>
                {l}
              </span>
            ))}
          </div>
        </div>

        {showList && (
          <div className="panel">
            <div className="panel-header">
              <strong>장소 목록</strong>
              <span className="small">{maxText}개</span>
            </div>
            <div className="panel-list">
              {filtered.slice(0, listLimit).map((it) => (
                <div key={(it.area_cd||it.name)+"-"+it.lat}
                     className="list-item"
                     onClick={()=>{
                       const id = spotId(it);
                       const m = markerByIdRef.current.get(id);
                       if (!m || !mapRef.current) return;
                       mapRef.current.setCenter(m.getPosition());
                       mapRef.current.setLevel(5);
                       infoRef.current.setContent(buildInfoHtml(itemByIdRef.current.get(id)));
                       infoRef.current.open(mapRef.current, m);
                     }}>
                  <div style={{ flex:"1 1 auto", minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14, marginBottom:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {it.name}
                    </div>
                    <div className="small">{fmtTime(it.updated_at)}</div>
                  </div>
                  <div style={{ whiteSpace:"nowrap", fontSize:12, color:levelColor(it.area_congest_lvl) }}>
                    {it.area_congest_lvl}
                  </div>
                </div>
              ))}
              {filtered.length > listLimit && (
                <div style={{ display:"flex", justifyContent:"center", padding:12 }}>
                  <button className="btn" onClick={()=>setListLimit(n=>n+200)}>더 보기 +200</button>
                </div>
              )}
              {filtered.length === 0 && <div className="small" style={{padding:12}}>조건에 맞는 장소가 없어요.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="toast">{errorMsg ? errorMsg : statusMsg}</div>
    </div>
  );
}
